import type { JsonValue } from "@hejbro/core";
import {
	decodeExprNode,
	hejbroError,
	qualifyName,
	renderExpr,
} from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import { z } from "zod";
import type { Catalog } from "./catalog";
import type { Finding } from "./compare";
import { differsFinding } from "./compare";

/**
 * `exprTexts` is `null` for a failure before either side was ever
 * assembled (the `conbin` lookup itself errored -- there is no catalog
 * text yet to show); otherwise both the declared and catalog expression
 * text are named, because the server's own error message usually points
 * at a column or function, not at which of the two declarations to go
 * read (tasks.md 3.1, review round 2).
 */
const notComparedFinding = (
	identity: string,
	reason: string,
	exprTexts: { readonly declared: string; readonly catalog: string } | null,
): Finding => {
	if (exprTexts === null) {
		return {
			identity,
			error: hejbroError(
				"check-not-compared",
				`declared check constraint "${identity}" could not be compared: ${reason}. Next: confirm the connected role can run EXPLAIN against this table, then rerun \`hejbro check\`.`,
			),
		};
	}
	return {
		identity,
		error: hejbroError(
			"check-not-compared",
			`declared check constraint "${identity}" could not be compared: ${reason}. Declared expression: "${exprTexts.declared}". Catalog expression: "${exprTexts.catalog}". Next: confirm the connected role can run EXPLAIN against this table, then rerun \`hejbro check\`.`,
		),
	};
};

const notEnforcedFinding = (identity: string, name: string): Finding => ({
	identity,
	error: hejbroError(
		"check-constraint-not-enforced",
		`declared check constraint "${identity}" matches the database's own expression, but the database is not enforcing it on existing rows (it is NOT VALID). Next: after confirming existing rows satisfy it, run \`alter table ... validate constraint "${name}"\`.`,
	),
});

const constraintMetadataRow = z.object({
	expression: z.string(),
	convalidated: z.boolean(),
});

type ConstraintMetadataOutcome =
	| {
			readonly kind: "found";
			readonly expression: string;
			readonly convalidated: boolean;
	  }
	| { readonly kind: "not-found" }
	| { readonly kind: "error"; readonly reason: string };

const messageOf = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

/**
 * The catalog side of a check constraint, from `pg_constraint.conbin`
 * through `pg_get_expr` (task 3.4) -- `conbin` yields the bare expression,
 * with no `CHECK (...)` wrapper and no `NOT VALID`/`NO INHERIT` suffix, so
 * there is nothing for a regex to be defeated by. Bind-parameterized
 * (`$1`/`$2`/`$3`), never interpolated -- the same discipline group 1's
 * catalog reads use, applied to a targeted lookup instead of a bulk one.
 * A separate statement from the rendering probe below is fine: this one
 * fetches the catalog's own *source text*, not a rendering, so it carries
 * no same-statement requirement of its own.
 */
const fetchConstraintMetadata = async (
	session: DriverSession,
	schema: string,
	table: string,
	name: string,
): Promise<ConstraintMetadataOutcome> => {
	try {
		const rows = await session.execute({
			sql: `
				select pg_get_expr(con.conbin, con.conrelid) as expression,
					con.convalidated as "convalidated"
				from pg_constraint con
				join pg_class c on c.oid = con.conrelid
				join pg_namespace n on n.oid = c.relnamespace
				where n.nspname = $1 and c.relname = $2 and con.conname = $3
					and con.contype = 'c'
			`,
			params: [schema, table, name],
			kind: "sql",
		});
		const [row] = rows;
		if (row === undefined) {
			return { kind: "not-found" };
		}
		const parsed = constraintMetadataRow.parse(row);
		return {
			kind: "found",
			expression: parsed.expression,
			convalidated: parsed.convalidated,
		};
	} catch (error) {
		return { kind: "error", reason: messageOf(error) };
	}
};

// "QUERY PLAN"/Plan/Output are Postgres's own EXPLAIN (FORMAT JSON) field
// names, not identifiers this codebase chose -- their casing isn't ours to
// change (same reasoning as the DATABASE_URL/TZ precedent elsewhere).
const explainPlanRow = z.object({
	"QUERY PLAN": z
		.array(
			z.object({
				// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
				Plan: z
					.object({
						// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
						Output: z.array(z.string()).optional(),
					})
					.optional(),
			}),
		)
		.min(1),
});

type BothProbeOutcome =
	| {
			readonly ok: true;
			readonly declaredText: string;
			readonly catalogText: string;
	  }
	| { readonly ok: false; readonly reason: string };

/**
 * Renders both sides the way the server itself would, from **one
 * statement** -- `SELECT (<declared>), (<catalog>) FROM <table>` -- read
 * from the plan's own `Output` (task 3.1, settled after review round 2:
 * "same session" is unenforceable from outside the driver, since a
 * pooling driver checks out a connection per `execute()` call and two
 * separate statements can land on two connections whose `search_path`
 * differs; one statement makes "same session" true by construction
 * instead, and costs a round trip less). The select list, never a
 * `WHERE` predicate: a qual is subject to the planner and to
 * row-security rewriting, an output expression is neither. No `SET`, no
 * transaction: this command depends on no driver capability beyond the
 * parameterless reads every driver must already support.
 *
 * Measured directly (docker postgres:17-alpine, tasks.md 3.1's own
 * demand -- "measure it before trusting the fixture"): Postgres does
 * NOT fold two identical target-list entries into one. `SELECT (x), (x)
 * FROM t` still returns a two-element `Output`, both agreeing and
 * genuinely-differing constraints alike, so `Output[1]` is always the
 * catalog side even when it renders identically to `Output[0]`.
 */
const probeBothExpressions = async (
	session: DriverSession,
	schema: string,
	table: string,
	declaredSql: string,
	catalogSql: string,
): Promise<BothProbeOutcome> => {
	try {
		const rows = await session.execute({
			sql: `explain (format json, costs off, verbose) select (${declaredSql}), (${catalogSql}) from ${qualifyName(schema, table)}`,
			params: [],
			kind: "sql",
		});
		const [row] = rows;
		if (row === undefined) {
			return {
				ok: false,
				reason: "the database returned no plan for the probe",
			};
		}
		const parsed = explainPlanRow.safeParse(row);
		if (!parsed.success) {
			return { ok: false, reason: "the plan did not have the expected shape" };
		}
		const [plan] = parsed.data["QUERY PLAN"];
		const declaredText = plan?.Plan?.Output?.[0];
		const catalogText = plan?.Plan?.Output?.[1];
		if (declaredText === undefined || catalogText === undefined) {
			return {
				ok: false,
				reason: "the plan's Output did not include both probed expressions",
			};
		}
		return { ok: true, declaredText, catalogText };
	} catch (error) {
		// Neither side was rendered -- the server's own error message is the
		// reason, never split into a "which side failed" guess (Postgres's
		// message usually names the offending column/function itself).
		return { ok: false, reason: messageOf(error) };
	}
};

/**
 * Compares one declared check constraint's expression against the
 * database's own, through the server's own rendering of both (proposal.md:
 * "An expression is compared through the server's own rendering"), and
 * separately whether the database enforces it on existing rows (task
 * 3.4) -- both checked independently and both reported when both are
 * true (review m3: a declaration/database mismatch and a database that
 * doesn't enforce what it does have are two independent facts with two
 * different fixes; reporting only one drip-feeds the other, same
 * principle as compare.ts's own C7).
 *
 * Priority (2.1's precedence rule): a table that does not exist in
 * `catalog` is *missing*, already reported by compare.ts's own existence
 * check (2.5) -- this returns no finding rather than piling a second,
 * uncomparable one onto the same absence. Likewise when the constraint
 * itself has no catalog row: existence is 2.5's job, not this function's.
 */
export const compareCheckConstraint = async (
	session: DriverSession,
	catalog: Catalog,
	schema: string,
	table: string,
	name: string,
	declaredExpression: JsonValue,
): Promise<ReadonlyArray<Finding>> => {
	const identity = `${schema}.${table}.${name}`;
	const tableExists = catalog.tables.some(
		(row) => row.schema === schema && row.table === table,
	);
	if (!tableExists) {
		return [];
	}
	const metadata = await fetchConstraintMetadata(session, schema, table, name);
	if (metadata.kind === "not-found") {
		return [];
	}
	if (metadata.kind === "error") {
		return [notComparedFinding(identity, metadata.reason, null)];
	}
	const declaredSql = renderExpr(decodeExprNode(declaredExpression));
	const probe = await probeBothExpressions(
		session,
		schema,
		table,
		declaredSql,
		metadata.expression,
	);
	if (!probe.ok) {
		return [
			notComparedFinding(identity, probe.reason, {
				declared: declaredSql,
				catalog: metadata.expression,
			}),
		];
	}
	const findings: Finding[] = [];
	if (probe.declaredText !== probe.catalogText) {
		findings.push(
			differsFinding(
				identity,
				`declared check constraint "${identity}" renders as "${probe.declaredText}", but the database's own constraint renders as "${probe.catalogText}".`,
				"change the declaration to match the database, or write a migration that alters the constraint to the declared expression.",
			),
		);
	}
	if (!metadata.convalidated) {
		findings.push(notEnforcedFinding(identity, name));
	}
	return findings;
};

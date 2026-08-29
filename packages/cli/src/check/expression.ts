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

const differsFinding = (
	identity: string,
	expected: string,
	actual: string,
): Finding => ({
	identity,
	error: hejbroError(
		"check-object-differs",
		`declared check constraint "${identity}" renders as "${expected}", but the database's own constraint renders as "${actual}". Next: change the declaration to match the database, or write a migration that alters the constraint to the declared expression.`,
	),
});

const notComparedFinding = (identity: string, reason: string): Finding => ({
	identity,
	error: hejbroError(
		"check-not-compared",
		`declared check constraint "${identity}" could not be compared: ${reason}. Next: confirm the connected role can run EXPLAIN against this table, then rerun \`hejbro check\`.`,
	),
});

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

type ProbeOutcome =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly reason: string };

/**
 * Renders `exprSql` the way the server itself would, by asking it to plan
 * `SELECT (<exprSql>) FROM <schema>.<table>` (task 3.1, settled: the select
 * list, never a `WHERE` predicate -- a qual is subject to the planner and
 * to row-security rewriting, an output expression is neither) and reading
 * the plan's own `Output`. No `SET`, no transaction: every statement this
 * module issues is a plain read a driver must already support, so this
 * command depends on no driver capability.
 */
const probeExpressionOutput = async (
	session: DriverSession,
	schema: string,
	table: string,
	exprSql: string,
): Promise<ProbeOutcome> => {
	try {
		const rows = await session.execute({
			sql: `explain (format json, costs off, verbose) select (${exprSql}) from ${qualifyName(schema, table)}`,
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
		const text = plan?.Plan?.Output?.[0];
		if (text === undefined) {
			return {
				ok: false,
				reason: "the plan's Output did not include the probed expression",
			};
		}
		return { ok: true, text };
	} catch (error) {
		return { ok: false, reason: messageOf(error) };
	}
};

/**
 * Compares one declared check constraint's expression against the
 * database's own, through the server's own rendering of both (proposal.md:
 * "An expression is compared through the server's own rendering"). Both
 * probes go through `session`, the same already-open connection group 1's
 * `readCatalog` used -- two connections can differ in `search_path` or any
 * GUC that affects rendering, which would compare two things that were
 * never comparable.
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
		return [notComparedFinding(identity, metadata.reason)];
	}
	const declaredSql = renderExpr(decodeExprNode(declaredExpression));
	const [declaredProbe, catalogProbe] = await Promise.all([
		probeExpressionOutput(session, schema, table, declaredSql),
		probeExpressionOutput(session, schema, table, metadata.expression),
	]);
	if (!declaredProbe.ok) {
		return [notComparedFinding(identity, declaredProbe.reason)];
	}
	if (!catalogProbe.ok) {
		return [notComparedFinding(identity, catalogProbe.reason)];
	}
	if (declaredProbe.text !== catalogProbe.text) {
		return [differsFinding(identity, declaredProbe.text, catalogProbe.text)];
	}
	if (!metadata.convalidated) {
		return [notEnforcedFinding(identity, name)];
	}
	return [];
};

import type { JsonValue } from "@hejbro/core";
import {
	decodeExprNode,
	hejbroError,
	qualifyName,
	renderExpr,
	renderTableBoundExpr,
} from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import { z } from "zod";
import type { Catalog } from "./catalog";
import type { Finding } from "./compare";
import { differsFinding } from "./compare";
import { describeDriverError } from "./error-message";

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

/**
 * `check-not-compared` for the text-comparison fallback (fix-nile-findings,
 * #755, task 2.2) -- distinct from {@link notComparedFinding} above (whose
 * `Next:` asks for `EXPLAIN`, which the spec forbids here: "The `Next:`
 * line SHALL NOT ask the user to run or be granted EXPLAIN on such a
 * platform"). A textual difference is never evidence of a different
 * meaning (cli-commands spec), so this is never a `differsFinding` --
 * always `check-not-compared`, carrying both texts and a restatement
 * pointer in the catalog's own spelling.
 */
const notComparedByTextFinding = (
	identity: string,
	declaredText: string,
	catalogText: string,
): Finding => ({
	identity,
	error: hejbroError(
		"check-not-compared",
		`declared check constraint "${identity}" could not be compared: the registered preset declares this platform cannot plan a statement, and the declared and catalog texts still differ after normalization. Declared expression: "${declaredText}". Catalog expression: "${catalogText}". Next: restate the declaration to match the catalog's own spelling: ${catalogText}`,
	),
});

/**
 * The catalog read itself failed under a preset that declares no
 * planning (D106 round 1, N1): the remedy is the catalog read, and the
 * `Next:` must not ask for `EXPLAIN` -- no role could satisfy that here.
 */
const notComparedCatalogReadFinding = (
	identity: string,
	reason: string,
): Finding => ({
	identity,
	error: hejbroError(
		"check-not-compared",
		`declared check constraint "${identity}" could not be compared: ${reason}. Next: confirm the connected role can read this table's constraint from pg_constraint (pg_get_constraintdef), then rerun \`hejbro check\`.`,
	),
});

/** A single-quoted string literal — `''` is the SQL escape for an embedded quote, never a literal boundary. */
const STRING_LITERAL = /'(?:[^']|'')*'/g;

/** A double-quoted identifier — `""` is the SQL escape for an embedded quote, never an identifier boundary. */
const QUOTED_IDENTIFIER = /"(?:[^"]|"")*"/g;

/** Either a string literal or a quoted identifier — the one pattern every "outside quotes" step (whitespace, letter case) shares, so the two rules can never drift apart from scanning content differently. */
const PROTECTED_SPAN = new RegExp(
	`${STRING_LITERAL.source}|${QUOTED_IDENTIFIER.source}`,
	"g",
);

/**
 * Applies `transform` to every run of `text` that falls outside a match of
 * `spanPattern`, leaving matched spans themselves untouched -- the shared
 * scanner behind every "outside quotes" normalization step, so a literal's
 * or an identifier's own quoted content is never rewritten by a step that
 * isn't specifically about quoting itself (design.md's own "outside
 * string literals" wording, generalized to also cover quoted
 * identifiers where a step needs that).
 */
const transformOutsideSpans = (
	text: string,
	spanPattern: RegExp,
	transform: (segment: string) => string,
): string => {
	const spans = Array.from(text.matchAll(spanPattern));
	const { result, consumedTo } = spans.reduce(
		(state, match) => {
			const start = match.index ?? 0;
			const before = transform(text.slice(state.consumedTo, start));
			return {
				result: state.result + before + match[0],
				consumedTo: start + match[0].length,
			};
		},
		{ result: "", consumedTo: 0 },
	);
	return result + transform(text.slice(consumedTo));
};

/**
 * Collapses whitespace to a single space, run outside every string literal
 * only (design.md, normalization step 1) -- a literal's own internal
 * spacing is content, not layout, so `'a  b'` and `'a b'` must stay
 * distinguishable.
 */
const collapseWhitespaceOutsideLiterals = (text: string): string =>
	transformOutsideSpans(text, STRING_LITERAL, (segment) =>
		segment.replace(/\s+/g, " "),
	).trim();

/** String-literal contents replaced with same-length filler, so a paren inside a literal never perturbs the balance scan below (indices stay aligned with the original text). */
const maskStringLiterals = (text: string): string =>
	text.replace(STRING_LITERAL, (literal) => "x".repeat(literal.length));

/** One character's effect on the running paren depth -- `(` opens, `)` closes, anything else leaves it alone. */
const depthDelta = (char: string): number => {
	if (char === "(") {
		return 1;
	}
	if (char === ")") {
		return -1;
	}
	return 0;
};

/** `true` only when `text` is a single parenthesized group wrapping the whole string -- depth returns to zero exactly once, at the final character, never earlier (which would mean two side-by-side groups, not one enclosing pair). */
const isSingleEnclosingGroup = (text: string): boolean => {
	if (!text.startsWith("(") || !text.endsWith(")")) {
		return false;
	}
	const masked = Array.from(maskStringLiterals(text));
	const lastIndex = masked.length - 1;
	const { depth, closedEarly } = masked.reduce(
		(state, char, index) => {
			if (state.closedEarly) {
				return state;
			}
			const depth = state.depth + depthDelta(char);
			return { depth, closedEarly: depth === 0 && index < lastIndex };
		},
		{ depth: 0, closedEarly: false },
	);
	return !closedEarly && depth === 0;
};

/** Strips exactly one enclosing parenthesis pair when it wraps the whole text (design.md, normalization step 2) -- never a repeated strip, and never one of two side-by-side groups. */
const stripEnclosingParens = (text: string): string => {
	if (isSingleEnclosingGroup(text)) {
		return text.slice(1, -1);
	}
	return text;
};

/** Escapes a literal string for use inside a `RegExp` (the table/schema name is user data, not a pattern). */
const escapeForRegExp = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Strips the declaring table's own qualifier from a column reference, both
 * the two-part (`"table"."column"`) and three-part
 * (`"schema"."table"."column"`) quoted forms (design.md, normalization
 * step 3) -- and only that table's: a same-bare-name reference to a
 * different table is left alone, so it stays distinguishable from the
 * declaring table's own bare column. The three-part pattern runs first,
 * so a three-part match is consumed before the two-part pattern could
 * otherwise match its own trailing `"table"."column"` segment.
 */
const stripTableQualifier = (
	text: string,
	schema: string,
	table: string,
): string => {
	const threePart = new RegExp(
		`"${escapeForRegExp(schema)}"\\."${escapeForRegExp(table)}"\\."([^"]+)"`,
		"g",
	);
	const twoPart = new RegExp(`"${escapeForRegExp(table)}"\\."([^"]+)"`, "g");
	return text.replace(threePart, '"$1"').replace(twoPart, '"$1"');
};

/** A quoted identifier Postgres would render unquoted anyway: a plain lower-case name, no digits-first, no special characters -- and not a reserved keyword, which `pg_get_expr` keeps quoted (D106 round 1, N4). */
const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Postgres's reserved keywords (`pg_get_keywords()` category R): the server quotes these when it renders an identifier, so unquoting them would not be meaning-preserving. */
const RESERVED_KEYWORDS = new Set([
	"all",
	"analyse",
	"analyze",
	"and",
	"any",
	"array",
	"as",
	"asc",
	"asymmetric",
	"both",
	"case",
	"cast",
	"check",
	"collate",
	"column",
	"constraint",
	"create",
	"current_catalog",
	"current_date",
	"current_role",
	"current_time",
	"current_timestamp",
	"current_user",
	"default",
	"deferrable",
	"desc",
	"distinct",
	"do",
	"else",
	"end",
	"except",
	"false",
	"fetch",
	"for",
	"foreign",
	"from",
	"grant",
	"group",
	"having",
	"in",
	"initially",
	"intersect",
	"into",
	"lateral",
	"leading",
	"limit",
	"localtime",
	"localtimestamp",
	"not",
	"null",
	"offset",
	"on",
	"only",
	"or",
	"order",
	"placing",
	"primary",
	"references",
	"returning",
	"select",
	"session_user",
	"some",
	"symmetric",
	"system_user",
	"table",
	"then",
	"to",
	"trailing",
	"true",
	"union",
	"unique",
	"user",
	"using",
	"variadic",
	"when",
	"where",
	"window",
	"with",
]);

const unquoteIfPlain = (whole: string, inner: string): string => {
	if (PLAIN_IDENTIFIER.test(inner) && !RESERVED_KEYWORDS.has(inner)) {
		return inner;
	}
	return whole;
};

/** Unquotes a quoted identifier only when it is a plain lower-case identifier the server would render unquoted (design.md, normalization step 4) -- a mixed-case or reserved identifier stays quoted, so a genuine case difference (`"Name"` vs `"name"`) stays visible. Runs outside string literals only: a quoted word inside a literal is content (D106 round 1, B1). */
const unquotePlainIdentifiers = (text: string): string =>
	transformOutsideSpans(text, STRING_LITERAL, (segment) =>
		segment.replace(/"([^"]+)"/g, unquoteIfPlain),
	);

/** Strips a `::type` cast the server appended directly to a string literal (design.md, normalization step 5) -- `'x'::text` and `'x'` compare equal, nothing else does. */
const stripStringLiteralCast = (text: string): string =>
	text.replace(/('(?:[^']|'')*')::[a-zA-Z_][a-zA-Z0-9_]*/g, "$1");

/**
 * Folds letter case to lower-case outside both quoted identifiers and
 * string literals (design.md, normalization step 6, lead ruling R80) --
 * the one addition to the original five steps, and the only one proven
 * meaning-preserving: SQL keywords and unquoted identifiers are already
 * case-insensitive (the server folds an unquoted identifier to
 * lower-case itself), so the two spellings were always the same
 * statement. A quoted identifier's or a string literal's own case is
 * content, never folded -- `"Name"` stays distinguishable from `"name"`,
 * and `'Done'` from `'done'`. Runs last: step 4 already unquoted every
 * identifier this step could otherwise have needed to skip, so there is
 * no ordering conflict between the two.
 */
const foldCaseOutsideQuotes = (text: string): string =>
	transformOutsideSpans(text, PROTECTED_SPAN, (segment) =>
		segment.toLowerCase(),
	);

/**
 * The fixed six-step normalization (design.md, "check without EXPLAIN";
 * step 6 added by lead ruling R80) — whitespace outside string literals;
 * one enclosing parenthesis pair; the declaring table's own qualifier on
 * a column reference; identifier quoting where the identifier would
 * render unquoted anyway; a type cast the server appended to a string
 * literal; letter case outside quoted identifiers and string literals —
 * and nothing else, applied in this fixed order.
 */
export const normalizeCheckText = (
	text: string,
	schema: string,
	table: string,
): string =>
	foldCaseOutsideQuotes(
		stripStringLiteralCast(
			unquotePlainIdentifiers(
				transformOutsideSpans(
					stripEnclosingParens(collapseWhitespaceOutsideLiterals(text)),
					STRING_LITERAL,
					(segment) => stripTableQualifier(segment, schema, table),
				),
			),
		),
	);

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
		return { kind: "error", reason: describeDriverError(error) };
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
		return { ok: false, reason: describeDriverError(error) };
	}
};

/**
 * `"server"` obtains both renderings from the database itself (unchanged,
 * byte-for-byte, from before this mode existed). `"text"` is the fallback
 * for a registered preset that declares its platform cannot plan a
 * statement (fix-nile-findings, #755): no `explain` is ever issued, and
 * the declared and catalog texts are compared after the fixed
 * normalization instead.
 */
export type CheckComparisonMode = "server" | "text";

/**
 * The `"text"` mode's own comparison (fix-nile-findings, #755, task 2.2):
 * no rendering is obtained from the server at all, so this never throws
 * and never returns a `check-not-compared` for a *failed* rendering --
 * the only outcome besides agreement is `check-not-compared` for texts
 * that still differ after normalization (never `check-constraint-differs`
 * -- a textual difference is not evidence of a different meaning). The
 * declared side renders table-bound, two-part (`renderTableBoundExpr`,
 * fix-nile-findings task 1.1) -- the same form the constraint's own
 * migration SQL uses, so the comparison is against what was actually
 * applied.
 */
const compareByText = (
	identity: string,
	schema: string,
	table: string,
	name: string,
	declaredExpression: JsonValue,
	metadata: { readonly expression: string; readonly convalidated: boolean },
): ReadonlyArray<Finding> => {
	const declaredSql = renderTableBoundExpr(decodeExprNode(declaredExpression));
	const normalizedDeclared = normalizeCheckText(declaredSql, schema, table);
	const normalizedCatalog = normalizeCheckText(
		metadata.expression,
		schema,
		table,
	);
	const findings: Finding[] = [];
	if (normalizedDeclared !== normalizedCatalog) {
		findings.push(
			notComparedByTextFinding(identity, declaredSql, metadata.expression),
		);
	}
	if (!metadata.convalidated) {
		findings.push(notEnforcedFinding(identity, name));
	}
	return findings;
};

/**
 * Compares one declared check constraint's expression against the
 * database's own, through the server's own rendering of both (proposal.md:
 * "An expression is compared through the server's own rendering") when
 * `mode` is `"server"`, or by normalized text (fix-nile-findings, #755)
 * when `mode` is `"text"` -- and separately whether the database enforces
 * it on existing rows (task 3.4), independently of which comparison mode
 * ran -- both checked independently and both reported when both are true
 * (review m3: a declaration/database mismatch and a database that
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
	mode: CheckComparisonMode,
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
		if (mode === "text") {
			return [notComparedCatalogReadFinding(identity, metadata.reason)];
		}
		return [notComparedFinding(identity, metadata.reason, null)];
	}
	if (mode === "text") {
		return compareByText(
			identity,
			schema,
			table,
			name,
			declaredExpression,
			metadata,
		);
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

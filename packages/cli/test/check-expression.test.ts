import type { HejbroInput, JsonValue, Snapshot } from "@hejbro/core";
import {
	between,
	check,
	columnRef,
	emptySnapshot,
	eq,
	generateMigration,
	inArray,
	index,
	isNotNull,
	ne,
	numeric,
	schema,
	sql,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import {
	compareCheckConstraint,
	compareGeneratedColumn,
	compareIndexExpressions,
	normalizeCheckText,
} from "../src/check/expression";

const app = schema("app");

const buildTestSnapshot = (
	declarations: ReadonlyArray<HejbroInput>,
): Snapshot =>
	generateMigration({ declarations, previousSnapshot: emptySnapshot }).snapshot;

const emptyCatalog = (): Catalog => ({
	schemas: [],
	tables: [],
	columns: [],
	constraints: [],
	indexes: [],
	enums: [],
	sequences: [],
	functions: [],
	views: [],
	policies: [],
	triggers: [],
	tableGrants: [],
	schemaUsageGrants: [],
	defaultTableGrants: [],
	extensions: [],
});

const withPostsTable = (): Catalog => ({
	...emptyCatalog(),
	tables: [{ schema: "app", table: "posts", rls: false }],
});

type LocalTableNode = {
	readonly checks: ReadonlyArray<{
		readonly name: string;
		readonly expression: JsonValue;
	}>;
};

/** The declared check constraint's own encoded expression node, read off a real snapshot built through the DSL + generateMigration (never hand-encoded -- encodeExprNode isn't part of core's public surface, and this is the exact path the real `check` command walks). */
const declaredCheckExpression = (
	snapshot: Snapshot,
	tableIdentity: string,
	checkName: string,
): JsonValue => {
	const node = snapshot.objects[`table:${tableIdentity}`] as LocalTableNode;
	const found = node.checks.find((entry) => entry.name === checkName);
	if (found === undefined) {
		throw new Error(
			`expected a check constraint named "${checkName}" in the built snapshot`,
		);
	}
	return found.expression;
};

/** One row of `EXPLAIN (FORMAT JSON, COSTS OFF, VERBOSE)` output, shaped exactly as a real postgres:17 returns it (verified directly, docker `postgres:17-alpine`) -- `output` is the probed plan node's own `Output` array (task 3.1's single statement: index 0 is the declared side's rendering, index 1 the catalog side's). */
const explainRow = (output: ReadonlyArray<string>): DriverRow => ({
	"QUERY PLAN": [
		{
			// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
			Plan: {
				"Node Type": "Seq Scan",
				"Parallel Aware": false,
				"Async Capable": false,
				"Relation Name": "posts",
				// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
				Schema: "app",
				// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
				Alias: "posts",
				// biome-ignore lint/style/useNamingConvention: Postgres's own EXPLAIN (FORMAT JSON) field name
				Output: output,
			},
		},
	],
});

type ConstraintMetadata = {
	readonly expression: string;
	readonly convalidated: boolean;
};

type FakeSessionOptions = {
	readonly metadata?: ConstraintMetadata;
	/** The single combined EXPLAIN statement's own `Output` -- `[declaredText, catalogText]` -- or `null`/omitted to simulate a plan with no usable Output (elided). */
	readonly explainOutput?: ReadonlyArray<string> | null;
	readonly explainError?: Error;
	readonly metadataError?: Error;
};

/**
 * The regression guard 3.2/3.3 exist for: since a fake session can't tell
 * a `WHERE`-based probe from a select-list one by its *behavior* (it just
 * answers whatever `explainOutput` says), only asserting on the actual
 * SQL text sent catches someone quietly switching the probe form back to
 * `WHERE` -- the switch this whole design exists to reject (spec: "An
 * expression compared as a query predicate fails both" [RLS/planner
 * hazards]). Also asserts exactly one EXPLAIN call (task 3.1, settled
 * after review round 2): two statements can land on two pooled
 * connections whose `search_path` differs, so "one statement" is the
 * enforceable claim, not "one session object was passed".
 *
 * The `), (` check pins the statement to *two* parenthesized expressions
 * in the select list, not one -- a syntactic guard only; whether
 * Postgres itself keeps two agreeing entries as two `Output` elements
 * rather than folding them is a server fact this fake-session unit test
 * cannot establish (measured directly instead, see this file's own
 * comments; the real proof is 6.2's live witness).
 */
const expectOneSelectListProbe = (
	calls: ReadonlyArray<CompileResult>,
): void => {
	const explainCalls = calls.filter((call) =>
		call.sql.trim().toLowerCase().startsWith("explain"),
	);
	expect(explainCalls).toHaveLength(1);
	const [explainCall] = explainCalls;
	const sql = explainCall?.sql.toLowerCase() ?? "";
	expect(sql).toContain("select (");
	expect(sql).toContain("), (");
	expect(sql).not.toMatch(/\bwhere\b/);
};

const makeFakeSession = (
	options: FakeSessionOptions,
): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			if (compiled.sql.includes("pg_constraint")) {
				if (options.metadataError !== undefined) {
					throw options.metadataError;
				}
				if (options.metadata === undefined) {
					return [];
				}
				return [
					{
						expression: options.metadata.expression,
						convalidated: options.metadata.convalidated,
					},
				];
			}
			if (options.explainError !== undefined) {
				throw options.explainError;
			}
			if (
				options.explainOutput === undefined ||
				options.explainOutput === null
			) {
				return [explainRow([])];
			}
			return [explainRow(options.explainOutput)];
		},
	};
	return { session, calls };
};

describe("compareCheckConstraint / 3.1 probe form and single statement", () => {
	it("renders both sides through the server and reports no difference for a rewritten `in (...)`", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		// Measured directly (docker postgres:17-alpine): `status in ('a','b','c')`
		// and the catalog's own `status = ANY ('{a,b,c}'::text[])` both probe
		// to the identical Output text once run through EXPLAIN in the same
		// statement -- Postgres's own rewrite cancels.
		const canonicalText = "(status = ANY ('{a,b,c}'::text[]))";
		const { session } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutput: [canonicalText, canonicalText],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toEqual([]);
	});

	it("reports a constraint whose bound differs", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), amount: numeric() },
			(t) => ({
				checks: [check("posts_amount_valid", between(t.amount, 1, 200))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_amount_valid",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: "(amount >= 1) AND (amount <= 199)",
				convalidated: true,
			},
			explainOutput: [
				"((amount >= '1'::numeric) AND (amount <= '200'::numeric))",
				"((amount >= '1'::numeric) AND (amount <= '199'::numeric))",
			],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_amount_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts.posts_amount_valid");
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
	});

	it("obtains both renderings from a single statement", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		const probedText = "(status = ANY ('{a,b,c}'::text[]))";
		const { session, calls } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutput: [probedText, probedText],
		});

		await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		// One metadata lookup plus exactly one EXPLAIN statement carrying
		// both renderings -- never two separate EXPLAIN calls, which a
		// pooling driver could split across two connections.
		expect(calls).toHaveLength(2);
		expectOneSelectListProbe(calls);
	});
});

describe("compareCheckConstraint / 3.2 index robustness", () => {
	it("compares identically with and without an index on the probed column", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		// Measured directly: the select-list probe's Output is byte-identical
		// whether or not an index exists on the probed column (unlike a WHERE
		// probe, which the planner may rewrite into BitmapHeapScan/IndexCond).
		const probedText = "(status = ANY ('{a,b,c}'::text[]))";

		const withoutIndex = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutput: [probedText, probedText],
		});
		const withIndex = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutput: [probedText, probedText],
		});

		const [findingsWithoutIndex, findingsWithIndex] = await Promise.all([
			compareCheckConstraint(
				withoutIndex.session,
				withPostsTable(),
				"app",
				"posts",
				"posts_status_valid",
				declaredExpression,
				"server",
			),
			compareCheckConstraint(
				withIndex.session,
				withPostsTable(),
				"app",
				"posts",
				"posts_status_valid",
				declaredExpression,
				"server",
			),
		]);

		expect(findingsWithoutIndex).toEqual([]);
		expect(findingsWithIndex).toEqual([]);
		// The regression guard itself: an index existing or not never changes
		// *which query shape* gets sent -- it is always one select-list
		// statement, never two, never a WHERE.
		expectOneSelectListProbe(withoutIndex.calls);
		expectOneSelectListProbe(withIndex.calls);
	});
});

describe("compareCheckConstraint / 3.3 uncomparable classification", () => {
	it("reports not-compared with a reason when no rendering can be obtained", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainError: Object.assign(
				new Error("permission denied for table posts"),
				{
					code: "42501",
				},
			),
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts.posts_status_valid");
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).toContain("permission denied");
		// The server's own error message usually names a column or function,
		// not which of the two declarations to go read -- both expression
		// texts are named explicitly (tasks.md 3.1, review round 2).
		expect(findings[0]?.error.message).toContain("in ('a', 'b', 'c')");
		expect(findings[0]?.error.message).toContain(
			"status = ANY ('{a,b,c}'::text[])",
		);
	});

	it("still reports a real difference under a role with no policy on the table", async () => {
		// The WHERE-predicate form this design rejects collapses both probes
		// to `One-Time Filter: false` under a role with no policy on the
		// table (measured), reporting agreement for two genuinely different
		// expressions -- a false negative. The select-list form never issues
		// a WHERE at all, so RLS has nothing to rewrite: this pins that the
		// comparison still tells two different Outputs apart regardless.
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), amount: numeric() },
			(t) => ({
				checks: [check("posts_amount_valid", between(t.amount, 1, 200))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_amount_valid",
		);
		const { session, calls } = makeFakeSession({
			metadata: {
				expression: "(amount >= 1) AND (amount <= 4)",
				convalidated: true,
			},
			explainOutput: [
				"((amount >= '1'::numeric) AND (amount <= '200'::numeric))",
				"((amount >= '1'::numeric) AND (amount <= '4'::numeric))",
			],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_amount_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		// The regression guard itself: this comparison never sends a WHERE
		// probe, so it never has a role/RLS predicate for the planner to
		// rewrite or elide in the first place.
		expectOneSelectListProbe(calls);
	});

	it("reports a declared table's absence once, not again as not-compared", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		const { session, calls } = makeFakeSession({});

		const findings = await compareCheckConstraint(
			session,
			// No "posts" row in this catalog at all -- compare.ts's own 2.5
			// already reported the table itself as missing; this must not
			// pile a second, uncomparable finding onto the same absence.
			emptyCatalog(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

describe("compareCheckConstraint / 3.4 catalog side via conbin, enforcement", () => {
	it("compares a NOT VALID constraint by its expression, and reports both facts independently", async () => {
		// pg_get_expr(conbin, ...) never carries "NOT VALID" -- conbin is the
		// bare expression, no wrapper to strip -- so a genuine mismatch is
		// still caught on a NOT VALID constraint. A mismatch and "not
		// enforced" are two independent facts (review m3, same principle as
		// compare.ts's C7): both are reported, not just the first one found.
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b}'::text[])",
				convalidated: false,
			},
			explainOutput: [
				"(status = ANY ('{a,b,c}'::text[]))",
				"(status = ANY ('{a,b}'::text[]))",
			],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toHaveLength(2);
		const codes = findings.map((finding) => finding.error.code).sort();
		expect(codes).toEqual([
			"check-constraint-not-enforced",
			"check-object-differs",
		]);
	});

	it("reports a matching constraint the database does not enforce", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		const matchingText = "(status = ANY ('{a,b,c}'::text[]))";
		const { session } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				// Not enforced (NOT VALID), even though the expression matches --
				// this is the case the code guards, and review round 2 found it
				// untested (M1): the test previously asserted the opposite
				// (`convalidated: true`, expecting no finding).
				convalidated: false,
			},
			explainOutput: [matchingText, matchingText],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts.posts_status_valid");
		expect(findings[0]?.error).toMatchObject({
			code: "check-constraint-not-enforced",
		});
	});

	it("does not report a matching, validated constraint at all", async () => {
		// The positive control for the M1 fix above: enforced and matching is
		// the only case that produces no finding.
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		const matchingText = "(status = ANY ('{a,b,c}'::text[]))";
		const { session } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutput: [matchingText, matchingText],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toEqual([]);
	});

	it("does not report a missing constraint a second time when 2.5 already found it absent", async () => {
		// Existence is compare.ts's 2.5, not this function's: a check
		// constraint that does not exist gets exactly one "missing" finding,
		// from 2.5's own catalog.constraints walk. This function's own
		// metadata lookup found nothing either (same underlying pg_constraint,
		// read independently) -- it must defer silently, not pile a second
		// finding onto the same absence.
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [
					check("posts_status_valid", inArray(t.status, ["a", "b", "c"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_valid",
		);
		const { session, calls } = makeFakeSession({});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
			"server",
		);

		expect(findings).toEqual([]);
		// No EXPLAIN probe was even attempted -- the metadata lookup alone
		// (which found nothing) is enough to defer.
		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(0);
	});
});

/**
 * fix-nile-findings, #755, task 2.2: `mode: "text"` compares the declared
 * and catalog texts after the fixed five-step normalization (cli-commands
 * spec, "An expression is compared through the server's own rendering")
 * -- and nothing else. Every `it` below issues no `explain` statement (a
 * text-mode metadata-only lookup): asserted once per case via
 * `explainCallCount`, not repeated per assertion.
 */
describe("compareCheckConstraint / 3.5 text comparison", () => {
	const explainCallCount = (calls: ReadonlyArray<CompileResult>): number =>
		calls.filter((call) => call.sql.trim().toLowerCase().startsWith("explain"))
			.length;

	it("agrees after whitespace normalization alone", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		const { session, calls } = makeFakeSession({
			metadata: {
				expression: '"posts"."name"    is  not   null',
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
		expect(explainCallCount(calls)).toBe(0);
	});

	// fix-nile-findings, #755, lead ruling R80: the sixth normalization
	// step, added after review measured that a real catalog folds a
	// keyword back to upper-case (`is not null` -> `IS NOT NULL`) -- without
	// it, this ordinary declaration would report not-compared on Nile.
	it("agrees after folding a keyword's letter case alone", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		const { session } = makeFakeSession({
			metadata: { expression: "(name IS NOT NULL)", convalidated: true },
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
	});

	it("is not compared when only a string literal's letter case differs (never folded)", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [check("posts_status_check", eq(t.status, "Done"))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_check",
		);
		const { session } = makeFakeSession({
			metadata: { expression: `"posts"."status" = 'done'`, convalidated: true },
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_check",
			declaredExpression,
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
	});

	it("agrees after stripping one enclosing parenthesis pair alone", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: '("posts"."name" is not null)',
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
	});

	it("agrees after stripping a two-part table qualifier alone (catalog carries no qualifier at all)", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		// The declared side renders table-bound, two-part: "posts"."name" is
		// not null. Stripping that qualifier alone (leaving it quoted) already
		// matches this catalog fixture -- no unquoting needed to reach equality.
		const { session } = makeFakeSession({
			metadata: { expression: '"name" is not null', convalidated: true },
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
	});

	it("agrees after stripping a three-part table qualifier alone (catalog carries schema.table.column)", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: '"app"."posts"."name" is not null',
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
	});

	it("agrees after unquoting a plain lower-case identifier alone (catalog carries no quotes at all)", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		// Qualifier-stripping alone leaves the declared side as `"name" is
		// not null` -- still quoted; this fixture is already bare, so only
		// the unquote step (not the qualifier strip) closes the remaining gap.
		const { session } = makeFakeSession({
			metadata: { expression: "name is not null", convalidated: true },
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
	});

	it("agrees after stripping a cast the server appended to a string literal alone", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [check("posts_status_check", eq(t.status, "draft"))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_status_check",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: `"posts"."status" = 'draft'::text`,
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_check",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
	});

	it("agrees after all five normalizations together (the spec scenario's own text, verbatim)", async () => {
		const projects = table(
			app,
			"projects",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("name_not_empty", sql`length(btrim(${t.name})) > 0`)],
			}),
		);
		const snapshot = buildTestSnapshot([projects]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.projects",
			"name_not_empty",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: "(length(btrim(name)) > 0)",
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			{
				...emptyCatalog(),
				tables: [{ schema: "app", table: "projects", rls: false }],
			},
			"app",
			"projects",
			"name_not_empty",
			declaredExpression,
			"text",
		);

		expect(findings).toEqual([]);
	});

	it("is not compared when an inner parenthesis difference changes the expression's meaning", async () => {
		const nums = table(
			app,
			"nums",
			{ id: uuid().primaryKey(), a: numeric(), b: numeric(), c: numeric() },
			(t) => ({
				checks: [check("assoc_check", sql`${t.a} + (${t.b} * ${t.c})`)],
			}),
		);
		const snapshot = buildTestSnapshot([nums]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.nums",
			"assoc_check",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: '("nums"."a" + "nums"."b") * "nums"."c"',
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			{
				...emptyCatalog(),
				tables: [{ schema: "app", table: "nums", rls: false }],
			},
			"app",
			"nums",
			"assoc_check",
			declaredExpression,
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).not.toMatch(/EXPLAIN/i);
	});

	it('is not compared when a quoted identifier\'s case genuinely differs ("Name" vs "name")', async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		const { session } = makeFakeSession({
			metadata: { expression: '"Name" is not null', convalidated: true },
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
	});

	it("is not compared for an `in (...)` vs `= ANY (ARRAY[...])` rewrite, names the restatement, and never mentions EXPLAIN", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), role: text() },
			(t) => ({
				checks: [
					check("posts_role_check", inArray(t.role, ["owner", "admin"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_role_check",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: `role = ANY (ARRAY['owner'::text, 'admin'::text])`,
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_role_check",
			declaredExpression,
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).toContain("Next:");
		expect(findings[0]?.error.message).not.toMatch(/EXPLAIN/i);
	});

	it("is not compared when only a string literal's internal whitespace differs (never collapsed)", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), label: text() },
			(t) => ({
				checks: [check("posts_label_check", eq(t.label, "a  b"))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_label_check",
		);
		const { session } = makeFakeSession({
			metadata: {
				expression: `"posts"."label" = 'a b'`,
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_label_check",
			declaredExpression,
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
	});

	it("strips only the enclosing table's own qualifier, leaving a different table's reference untouched", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({
				checks: [check("posts_name_check", isNotNull(t.name))],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_name_check",
		);
		// A genuinely different table's column, coincidentally named the same
		// -- must not be conflated with the declaring table's own bare column.
		const { session } = makeFakeSession({
			metadata: {
				expression: '"other"."name" is not null',
				convalidated: true,
			},
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declaredExpression,
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
	});

	it("never issues an explain statement in text mode, even when the texts differ", async () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), role: text() },
			(t) => ({
				checks: [
					check("posts_role_check", inArray(t.role, ["owner", "admin"])),
				],
			}),
		);
		const snapshot = buildTestSnapshot([posts]);
		const declaredExpression = declaredCheckExpression(
			snapshot,
			"app.posts",
			"posts_role_check",
		);
		const { session, calls } = makeFakeSession({
			metadata: {
				expression: `role = ANY (ARRAY['owner'::text, 'admin'::text])`,
				convalidated: true,
			},
		});

		await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_role_check",
			declaredExpression,
			"text",
		);

		expect(explainCallCount(calls)).toBe(0);
	});
});

// fix-nile-findings, D106 round 1 (R1-B1, R1-N4, R1-N1): the corrections
// below are each a shipped-behavior-contradicts-delta finding turned into
// the row that would have caught it.
describe("compareCheckConstraint / 3.6 literal content is never normalized", () => {
	const declared = (value: string) => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), format: text() },
			(t) => ({ checks: [check("posts_format", eq(t.format, value))] }),
		);
		const snapshot = buildTestSnapshot([posts]);
		return declaredCheckExpression(snapshot, "app.posts", "posts_format");
	};
	const run = async (value: string, catalog: string) => {
		const { session } = makeFakeSession({
			metadata: { expression: catalog, convalidated: true },
		});
		return compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_format",
			declared(value),
			"text",
		);
	};

	it.each([
		{
			label:
				"a quoted word inside a literal is content, not an identifier (step 4)",
			value: '"json"',
			catalog: "format = 'json'",
			agrees: false,
		},
		{
			label: "the same literal on both sides agrees",
			value: '"json"',
			catalog: "format = '\"json\"'",
			agrees: true,
		},
		{
			label:
				"a table qualifier inside a literal is content, not a reference (step 3)",
			value: 'see "posts"."name"',
			catalog: "format = 'see name'",
			agrees: false,
		},
		{
			label: "outside a literal the qualifier still normalizes away",
			value: "plain",
			catalog: "(format = 'plain'::text)",
			agrees: true,
		},
	])("$label", async ({ value, catalog, agrees }) => {
		const findings = await run(value, catalog);
		if (agrees) {
			expect(findings).toEqual([]);
			return;
		}
		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
	});
});

describe("normalizeCheckText / step 4 unquotes only what the server would render unquoted", () => {
	it.each([
		{ input: '"name" is not null', expected: "name is not null" },
		{ input: '"order" is not null', expected: '"order" is not null' },
		{ input: "\"user\" <> 'x'", expected: "\"user\" <> 'x'" },
		{ input: '"select" > 0', expected: '"select" > 0' },
		{ input: '"Name" is not null', expected: '"Name" is not null' },
	])("$input → $expected", ({ input, expected }) => {
		expect(normalizeCheckText(input, "app", "posts")).toBe(expected);
	});
});

describe("normalizeCheckText / step 5 strips the whole cast the server appends to a literal", () => {
	it.each([
		{ input: "tags <> '{}'::text[]", expected: "tags <> '{}'" },
		{ input: "name <> 'x'::character varying", expected: "name <> 'x'" },
		{ input: "name <> 'x'::character varying(20)", expected: "name <> 'x'" },
		{
			input: "at > '2020-01-01'::timestamp with time zone",
			expected: "at > '2020-01-01'",
		},
		{
			input: "at > '2020-01-01'::timestamp(3) without time zone",
			expected: "at > '2020-01-01'",
		},
		{ input: "price > '1'::numeric(10,2)", expected: "price > '1'" },
		{ input: "ratio > '1'::double precision", expected: "ratio > '1'" },
		{ input: "state = 'a'::app.status", expected: "state = 'a'" },
		{ input: "state = 'a'::\"MyType\"", expected: "state = 'a'" },
		{ input: "kind = 'a'::text and b", expected: "kind = 'a' and b" },
		{ input: "s = 'x'::text || 'y'::text[]", expected: "s = 'x' || 'y'" },
		{ input: "tags <> null::text[]", expected: "tags <> null::text[]" },
	])("$input → $expected", ({ input, expected }) => {
		expect(normalizeCheckText(input, "app", "posts")).toBe(expected);
	});
});

/**
 * #779: the not-compared and differs messages used to wrap each expression
 * text in the same double quote SQL uses for identifiers, so a table-bound
 * declared expression (which always begins `"schema"."table"."column"`
 * under server mode, or `"table"."column"` under text mode) collided with
 * its own delimiter. Every case below pins the replacement delimiter
 * (backticks) at the three message sites, with the `code` and the `Next:`
 * substring asserted unchanged against the pre-change strings (tasks.md
 * 1.1).
 */
describe("compareCheckConstraint / 3.8 expression texts are delimited by backticks", () => {
	const declaredRoleCheckExpression = (): JsonValue => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), role: text() },
			(t) => ({ checks: [check("posts_role_check", eq(t.role, "owner"))] }),
		);
		const snapshot = buildTestSnapshot([posts]);
		return declaredCheckExpression(snapshot, "app.posts", "posts_role_check");
	};

	describe("server-mode not-compared, carrying both texts", () => {
		it.each([
			{
				label: "catalog text begins with a quoted identifier",
				catalogText: `"posts"."role" = 'owner'`,
			},
			{
				label: "catalog text carries a double quote inside a literal",
				catalogText: `format = '"json"'`,
			},
			{
				label: "catalog text carries a cast",
				catalogText: `role = 'owner'::text`,
			},
		])("$label", async ({ catalogText }) => {
			const { session } = makeFakeSession({
				metadata: { expression: catalogText, convalidated: true },
				explainError: Object.assign(
					new Error("permission denied for table posts"),
					{ code: "42501" },
				),
			});

			const findings = await compareCheckConstraint(
				session,
				withPostsTable(),
				"app",
				"posts",
				"posts_role_check",
				declaredRoleCheckExpression(),
				"server",
			);

			expect(findings).toHaveLength(1);
			const message = findings[0]?.error.message ?? "";
			expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
			// The declared side always renders `"app"."posts"."role" = ...` under
			// server mode -- itself a quoted-identifier-starting text -- so its
			// own delimiter is asserted generically here.
			expect(message).toMatch(/Declared expression: `.*`\./);
			expect(message).not.toMatch(/Declared expression: ".*"\./);
			expect(message).toContain(`Catalog expression: \`${catalogText}\`.`);
			expect(message).not.toContain(`Catalog expression: "${catalogText}"`);
			expect(message).toContain(
				"Next: confirm the connected role can run EXPLAIN against this table, then rerun `hejbro check`.",
			);
		});
	});

	describe("text-mode not-compared", () => {
		it.each([
			{
				label: "catalog text begins with a quoted identifier",
				catalogText: `"other"."role" = 'owner'`,
			},
			{
				label: "catalog text carries a double quote inside a literal",
				catalogText: `format = '"json"'`,
			},
			{
				label: "catalog text carries a cast",
				catalogText: `(role = 'owner'::text) and false`,
			},
		])("$label", async ({ catalogText }) => {
			const { session } = makeFakeSession({
				metadata: { expression: catalogText, convalidated: true },
			});

			const findings = await compareCheckConstraint(
				session,
				withPostsTable(),
				"app",
				"posts",
				"posts_role_check",
				declaredRoleCheckExpression(),
				"text",
			);

			expect(findings).toHaveLength(1);
			const message = findings[0]?.error.message ?? "";
			expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
			// The declared side always renders `"posts"."role" = ...` under text
			// mode -- itself quoted-identifier-starting -- asserted generically.
			expect(message).toMatch(/Declared expression: `.*`\./);
			expect(message).not.toMatch(/Declared expression: ".*"\./);
			expect(message).toContain(`Catalog expression: \`${catalogText}\`.`);
			expect(message).not.toContain(`Catalog expression: "${catalogText}"`);
			// The restatement pointer is not itself a delimited site -- unchanged.
			expect(message).toContain(
				`Next: restate the declaration to match the catalog's own spelling: ${catalogText}`,
			);
		});
	});

	describe("differs, carrying both renderings", () => {
		it.each([
			{
				label: "both renderings begin with a quoted identifier",
				declaredText: `"posts"."role" = 'owner'`,
				catalogText: `"posts"."role" = 'admin'`,
			},
			{
				label: "a rendering carries a double quote inside a literal",
				declaredText: `format = '"json"'`,
				catalogText: `format = '"xml"'`,
			},
			{
				label: "a rendering carries a cast",
				declaredText: `role = 'owner'::text`,
				catalogText: `role = 'admin'::text`,
			},
		])("$label", async ({ declaredText, catalogText }) => {
			const { session } = makeFakeSession({
				metadata: {
					expression: "irrelevant, differs regardless",
					convalidated: true,
				},
				explainOutput: [declaredText, catalogText],
			});

			const findings = await compareCheckConstraint(
				session,
				withPostsTable(),
				"app",
				"posts",
				"posts_role_check",
				declaredRoleCheckExpression(),
				"server",
			);

			expect(findings).toHaveLength(1);
			const message = findings[0]?.error.message ?? "";
			expect(findings[0]?.error).toMatchObject({
				code: "check-object-differs",
			});
			expect(message).toContain(`renders as \`${declaredText}\`,`);
			expect(message).toContain(`renders as \`${catalogText}\`.`);
			expect(message).not.toContain(`renders as "${declaredText}"`);
			expect(message).not.toContain(`renders as "${catalogText}"`);
			expect(message).toContain(
				"Next: change the declaration to match the database, or write a migration that alters the constraint to the declared expression.",
			);
		});
	});
});

/**
 * #778/#781, task 1.4: `compareGeneratedColumn`'s own axis is the
 * expression only -- whether each side is generated at all is
 * `compare.ts`'s synchronous `compareColumnGenerated` (1.3). Real
 * `columnRef`s (not a bare `sql` template) so the declared side renders
 * table-bound, qualified columns the way an actual generated column
 * declaration does (matching design.md's own measured examples) -- the
 * same primitive `table()` uses to build its own `t` proxy, per
 * `column-builder.ts`'s tsdoc on why a sibling can't be read off `t`
 * inside `generatedAlwaysAs()` itself.
 */
describe("compareGeneratedColumn / 4.1 a generated column's expression", () => {
	const priceRef = () =>
		columnRef("app", "widgets", "price", numeric().columnState.typeNode);
	const qtyRef = () =>
		columnRef("app", "widgets", "qty", numeric().columnState.typeNode);

	const declaredTotalExpression = (): JsonValue => {
		const widgets = table(app, "widgets", {
			price: numeric(),
			qty: numeric(),
			total: numeric().generatedAlwaysAs(sql`${priceRef()} * ${qtyRef()}`),
		});
		const snapshot = buildTestSnapshot([widgets]);
		const node = snapshot.objects["table:app.widgets"] as {
			readonly columns: ReadonlyArray<{
				readonly name: string;
				readonly generated?: JsonValue;
			}>;
		};
		const column = node.columns.find((entry) => entry.name === "total");
		if (column?.generated === undefined) {
			throw new Error(
				'expected column "total" to carry a generated expression',
			);
		}
		return column.generated;
	};

	const catalogWithTotal = (catalogGenerated: string | null): Catalog => ({
		...emptyCatalog(),
		tables: [{ schema: "app", table: "widgets", rls: false }],
		columns: [
			{
				schema: "app",
				table: "widgets",
				name: "total",
				notNull: false,
				catalogType: "numeric",
				baseTypeKind: null,
				baseTypeSchema: null,
				baseTypeName: null,
				catalogDefault: null,
				catalogGenerated,
			},
		],
	});

	type GeneratedFakeSessionOptions = {
		readonly explainOutput?: ReadonlyArray<string> | null;
		readonly explainError?: Error;
	};

	/** No `pg_constraint` lookup exists for a generated column (unlike a check constraint) -- every call is the single `explain` probe, or none at all in text mode. */
	const makeGeneratedFakeSession = (
		options: GeneratedFakeSessionOptions,
	): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
		const calls: CompileResult[] = [];
		const session: DriverSession = {
			execute: async (compiled) => {
				calls.push(compiled);
				if (options.explainError !== undefined) {
					throw options.explainError;
				}
				if (
					options.explainOutput === undefined ||
					options.explainOutput === null
				) {
					return [explainRow([])];
				}
				return [explainRow(options.explainOutput)];
			},
		};
		return { session, calls };
	};

	it("reports no finding when the server renders both sides identically", async () => {
		const matching = "(price * (qty)::numeric)";
		const { session, calls } = makeGeneratedFakeSession({
			explainOutput: [matching, matching],
		});

		const findings = await compareGeneratedColumn(
			session,
			catalogWithTotal("(price * (qty)::numeric)"),
			"app",
			"widgets",
			"total",
			declaredTotalExpression(),
			"server",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("reports a differing generation expression, naming the generated column", async () => {
		const { session } = makeGeneratedFakeSession({
			explainOutput: ["(price * (qty)::numeric)", "(price + (qty)::numeric)"],
		});

		const findings = await compareGeneratedColumn(
			session,
			catalogWithTotal("(price + (qty)::numeric)"),
			"app",
			"widgets",
			"total",
			declaredTotalExpression(),
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.widgets.total");
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		expect(findings[0]?.error.message).toContain("generated column");
		expect(findings[0]?.error.message).toContain(
			"renders as `(price * (qty)::numeric)`,",
		);
		expect(findings[0]?.error.message).toContain(
			"renders as `(price + (qty)::numeric)`.",
		);
	});

	it("reports not-compared with backticked texts and an EXPLAIN Next: when the probe fails", async () => {
		const { session } = makeGeneratedFakeSession({
			explainError: Object.assign(
				new Error("permission denied for table widgets"),
				{ code: "42501" },
			),
		});

		const findings = await compareGeneratedColumn(
			session,
			catalogWithTotal("(price * (qty)::numeric)"),
			"app",
			"widgets",
			"total",
			declaredTotalExpression(),
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).toContain("permission denied");
		expect(findings[0]?.error.message).toMatch(/Declared expression: `.*`\./);
		expect(findings[0]?.error.message).toMatch(/Catalog expression: `.*`\./);
		expect(findings[0]?.error.message).toContain("EXPLAIN");
	});

	it("agrees under text mode after the declaring table's qualifier normalizes away", async () => {
		const { session, calls } = makeGeneratedFakeSession({});

		const findings = await compareGeneratedColumn(
			session,
			catalogWithTotal("(price * qty)"),
			"app",
			"widgets",
			"total",
			declaredTotalExpression(),
			"text",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("is not compared under text mode when the catalog carries a column cast normalization never strips", async () => {
		const { session } = makeGeneratedFakeSession({});

		const findings = await compareGeneratedColumn(
			session,
			catalogWithTotal("(price * (qty)::numeric)"),
			"app",
			"widgets",
			"total",
			declaredTotalExpression(),
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).not.toMatch(/EXPLAIN/i);
	});

	it("reports nothing and issues zero statements when the catalog column is not generated", async () => {
		const { session, calls } = makeGeneratedFakeSession({});

		const findings = await compareGeneratedColumn(
			session,
			catalogWithTotal(null),
			"app",
			"widgets",
			"total",
			declaredTotalExpression(),
			"server",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("reports nothing and issues zero statements when the column is absent from the catalog", async () => {
		const { session, calls } = makeGeneratedFakeSession({});

		const findings = await compareGeneratedColumn(
			session,
			emptyCatalog(),
			"app",
			"widgets",
			"total",
			declaredTotalExpression(),
			"server",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

/**
 * #778, task 1.5: `compareIndexExpressions`' own axes are the predicate's
 * and each expression column's *presence* (count, then presence, both
 * before any probe) and, once both sides agree on shape, the rendered
 * text itself -- one statement per index, predicate pair first then one
 * pair per expression column (design.md's "pair layout"). An index's
 * plain columns, uniqueness and access method are untouched here
 * (`compare.ts`'s `compareIndexes`, existence-only, unchanged).
 */
describe("compareIndexExpressions / 4.2 an index's predicate and expression columns", () => {
	type LocalIndexNode = {
		readonly name: string;
		readonly columns: ReadonlyArray<
			{ readonly name: string } | { readonly expression: JsonValue }
		>;
		readonly where?: JsonValue;
	};

	/** Reads one declared index node off a real snapshot, the same "never hand-encoded" discipline `declaredCheckExpression` uses. */
	const declaredIndexNode = (
		snapshot: Snapshot,
		tableIdentity: string,
		indexName: string,
	): LocalIndexNode => {
		const node = snapshot.objects[`table:${tableIdentity}`] as {
			readonly indexes: ReadonlyArray<LocalIndexNode>;
		};
		const found = node.indexes.find((entry) => entry.name === indexName);
		if (found === undefined) {
			throw new Error(
				`expected an index named "${indexName}" in the built snapshot`,
			);
		}
		return found;
	};

	const catalogWithIndex = (row: {
		readonly name: string;
		readonly predicate: string | null;
		readonly expressions: string[];
	}): Catalog => ({
		...emptyCatalog(),
		tables: [{ schema: "app", table: "widgets", rls: false }],
		indexes: [{ schema: "app", table: "widgets", ...row }],
	});

	type IndexFakeSessionOptions = {
		readonly explainOutput?: ReadonlyArray<string> | null;
		readonly explainError?: Error;
	};

	/** No `pg_constraint` lookup exists for an index either -- every call is the single combined `explain` probe, or none at all in text mode / before the probe is reached. */
	const makeIndexFakeSession = (
		options: IndexFakeSessionOptions,
	): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
		const calls: CompileResult[] = [];
		const session: DriverSession = {
			execute: async (compiled) => {
				calls.push(compiled);
				if (options.explainError !== undefined) {
					throw options.explainError;
				}
				if (
					options.explainOutput === undefined ||
					options.explainOutput === null
				) {
					return [explainRow([])];
				}
				return [explainRow(options.explainOutput)];
			},
		};
		return { session, calls };
	};

	it("agrees on a partial predicate that differs only by Postgres's rewriting", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				indexes: [
					index("widgets_status_idx").on(t.status).where(ne(t.status, "done")),
				],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const rewritten = "(status <> 'done'::text)";
		const { session, calls } = makeIndexFakeSession({
			explainOutput: [rewritten, rewritten],
		});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_status_idx",
				predicate: rewritten,
				expressions: [],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_status_idx"),
			"server",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("reports a partial predicate that genuinely differs", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), archivedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("widgets_active_idx").on(t.id).where(isNotNull(t.archivedAt)),
				],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session } = makeIndexFakeSession({
			explainOutput: ["(archived_at IS NULL)", "(archived_at IS NOT NULL)"],
		});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_active_idx",
				predicate: "(archived_at IS NOT NULL)",
				expressions: [],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_active_idx"),
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.widgets.widgets_active_idx");
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
	});

	it("agrees on an expression column that renders identically", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), email: text() },
			(t) => ({
				indexes: [index("widgets_email_idx").on(sql`lower(${t.email})`)],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session } = makeIndexFakeSession({
			explainOutput: ["lower(email)", "lower(email)"],
		});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_email_idx",
				predicate: null,
				expressions: ["lower(email)"],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_email_idx"),
			"server",
		);

		expect(findings).toEqual([]);
	});

	it("reports an expression column that genuinely differs, naming the column position", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), email: text() },
			(t) => ({
				indexes: [index("widgets_email_idx").on(sql`lower(${t.email})`)],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session } = makeIndexFakeSession({
			explainOutput: ["lower(email)", "upper(email)"],
		});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_email_idx",
				predicate: null,
				expressions: ["upper(email)"],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_email_idx"),
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		expect(findings[0]?.error.message).toContain("index expression column 1");
	});

	it("reports a differing expression-column count, naming both counts, probing nothing", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), email: text() },
			(t) => ({
				indexes: [index("widgets_email_idx").on(sql`lower(${t.email})`)],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session, calls } = makeIndexFakeSession({});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_email_idx",
				predicate: null,
				expressions: [],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_email_idx"),
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		expect(findings[0]?.error.message).toContain("has 1 expression column(s)");
		expect(findings[0]?.error.message).toContain("has 0");
		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(0);
	});

	it("reports a predicate declared on only one side, probing nothing", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), archivedAt: timestamptz() },
			(t) => ({
				indexes: [index("widgets_active_idx").on(t.id)],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session, calls } = makeIndexFakeSession({});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_active_idx",
				predicate: "(archived_at IS NOT NULL)",
				expressions: [],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_active_idx"),
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(0);
	});

	it("probes a predicate and two expression columns in one statement, six Output entries, one finding per differing pair", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), email: text(), archivedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("widgets_multi_idx")
						.on(sql`lower(${t.email})`, sql`upper(${t.email})`)
						.where(isNotNull(t.archivedAt)),
				],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session, calls } = makeIndexFakeSession({
			explainOutput: [
				"(archived_at IS NOT NULL)",
				"(archived_at IS NOT NULL)",
				"lower(email)",
				"lower(email)",
				"upper(email)",
				"UPPER(email)",
			],
		});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_multi_idx",
				predicate: "(archived_at IS NOT NULL)",
				expressions: ["lower(email)", "UPPER(email)"],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_multi_idx"),
			"server",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error.message).toContain("index expression column 2");
		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(1);
		const [explainCall] = explainCalls;
		const occurrences = (explainCall?.sql.match(/\(/g) ?? []).length;
		expect(occurrences).toBeGreaterThanOrEqual(6);
	});

	it("agrees under text mode for a predicate after the declaring table's qualifier normalizes away", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), archivedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("widgets_active_idx").on(t.id).where(isNotNull(t.archivedAt)),
				],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session, calls } = makeIndexFakeSession({});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_active_idx",
				predicate: "(archived_at IS NOT NULL)",
				expressions: [],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_active_idx"),
			"text",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("is not compared under text mode for an expression column carrying a cast normalization never strips", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), price: numeric(), qty: numeric() },
			(t) => ({
				indexes: [index("widgets_total_idx").on(sql`${t.price} * ${t.qty}`)],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session } = makeIndexFakeSession({});

		const findings = await compareIndexExpressions(
			session,
			catalogWithIndex({
				name: "widgets_total_idx",
				predicate: null,
				expressions: ["(price * (qty)::numeric)"],
			}),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_total_idx"),
			"text",
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).not.toMatch(/EXPLAIN/i);
	});

	it("reports nothing and issues zero statements when the index is absent from the catalog", async () => {
		const widgets = table(
			app,
			"widgets",
			{ id: uuid().primaryKey(), email: text() },
			(t) => ({
				indexes: [index("widgets_email_idx").on(sql`lower(${t.email})`)],
			}),
		);
		const snapshot = buildTestSnapshot([widgets]);
		const { session, calls } = makeIndexFakeSession({});

		const findings = await compareIndexExpressions(
			session,
			emptyCatalog(),
			"app",
			"widgets",
			declaredIndexNode(snapshot, "app.widgets", "widgets_email_idx"),
			"server",
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

describe("compareCheckConstraint / 3.7 a failed catalog read under text mode", () => {
	const declared = () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), name: text() },
			(t) => ({ checks: [check("posts_name_check", isNotNull(t.name))] }),
		);
		const snapshot = buildTestSnapshot([posts]);
		return declaredCheckExpression(snapshot, "app.posts", "posts_name_check");
	};
	const failing = () =>
		makeFakeSession({
			metadataError: Object.assign(
				new Error("permission denied for function pg_get_expr"),
				{ code: "42501" },
			),
		}).session;

	it("names the catalog read, never EXPLAIN, when the preset declares no planning", async () => {
		const findings = await compareCheckConstraint(
			failing(),
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declared(),
			"text",
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).toContain(
			"permission denied for function pg_get_expr",
		);
		expect(findings[0]?.error.message).not.toMatch(/explain/i);
		expect(findings[0]?.error.message).toMatch(/Next: .*pg_constraint/);
		expect(findings[0]?.error.message).toMatch(/Next: .*pg_get_expr/);
		expect(findings[0]?.error.message).not.toContain("pg_get_constraintdef");
	});

	it("keeps asking for EXPLAIN under server mode, where it is the remedy", async () => {
		const findings = await compareCheckConstraint(
			failing(),
			withPostsTable(),
			"app",
			"posts",
			"posts_name_check",
			declared(),
			"server",
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.error.message).toContain("EXPLAIN");
	});
});

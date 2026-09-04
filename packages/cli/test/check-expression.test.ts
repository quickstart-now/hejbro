import type { HejbroInput, JsonValue, Snapshot } from "@hejbro/core";
import {
	between,
	check,
	emptySnapshot,
	eq,
	generateMigration,
	inArray,
	isNotNull,
	numeric,
	schema,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import {
	compareCheckConstraint,
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

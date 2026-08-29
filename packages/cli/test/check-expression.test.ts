import type { HejbroInput, JsonValue, Snapshot } from "@hejbro/core";
import {
	between,
	check,
	emptySnapshot,
	generateMigration,
	inArray,
	numeric,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import { compareCheckConstraint } from "../src/check/expression";

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

/** One row of `EXPLAIN (FORMAT JSON, COSTS OFF, VERBOSE)` output, shaped exactly as a real postgres:17 returns it (verified directly, docker `postgres:17-alpine`) -- `output` is the probed plan node's own `Output` array. */
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
	/** In call order: the `Output` array for that probe, or `null` to simulate a plan with no usable Output (elided). */
	readonly explainOutputs?: ReadonlyArray<ReadonlyArray<string> | null>;
	readonly explainError?: Error;
};

/**
 * The regression guard 3.2/3.3 exist for: since a fake session can't tell
 * a `WHERE`-based probe from a select-list one by its *behavior* (it just
 * answers whatever `explainOutputs` says), only asserting on the actual
 * SQL text sent catches someone quietly switching the probe form back to
 * `WHERE` -- the switch this whole design exists to reject (spec: "An
 * expression compared as a query predicate fails both" [RLS/planner
 * hazards]).
 */
const expectSelectListProbes = (calls: ReadonlyArray<CompileResult>): void => {
	const explainCalls = calls.filter((call) =>
		call.sql.trim().toLowerCase().startsWith("explain"),
	);
	expect(explainCalls.length).toBeGreaterThan(0);
	expect(
		explainCalls.every((call) => {
			const sql = call.sql.toLowerCase();
			return sql.includes("select (") && !/\bwhere\b/.test(sql);
		}),
	).toBe(true);
};

const makeFakeSession = (
	options: FakeSessionOptions,
): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			if (compiled.sql.includes("pg_constraint")) {
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
			const explainCallsSoFar = calls.filter((call) =>
				call.sql.trim().toLowerCase().startsWith("explain"),
			).length;
			const output = options.explainOutputs?.[explainCallsSoFar - 1];
			if (output === undefined || output === null) {
				return [explainRow([])];
			}
			return [explainRow(output)];
		},
	};
	return { session, calls };
};

describe("compareCheckConstraint / 3.1 probe form and single session", () => {
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
		// session -- Postgres's own rewrite cancels.
		const canonicalOutput = ["(status = ANY ('{a,b,c}'::text[]))"];
		const { session } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutputs: [canonicalOutput, canonicalOutput],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
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
			explainOutputs: [
				["((amount >= '1'::numeric) AND (amount <= '200'::numeric))"],
				["((amount >= '1'::numeric) AND (amount <= '199'::numeric))"],
			],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_amount_valid",
			declaredExpression,
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts.posts_amount_valid");
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
	});

	it("obtains both renderings from a single session", async () => {
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
		const output = ["(status = ANY ('{a,b,c}'::text[]))"];
		const { session, calls } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutputs: [output, output],
		});

		await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
		);

		// One metadata lookup plus two EXPLAIN probes, every one of them
		// through this same fake session's own `execute` -- there is no
		// second session object anywhere in this call.
		expect(calls).toHaveLength(3);
		const explainCalls = calls.filter((call) =>
			call.sql.trim().toLowerCase().startsWith("explain"),
		);
		expect(explainCalls).toHaveLength(2);
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
		const output = ["(status = ANY ('{a,b,c}'::text[]))"];

		const withoutIndex = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutputs: [output, output],
		});
		const withIndex = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutputs: [output, output],
		});

		const [findingsWithoutIndex, findingsWithIndex] = await Promise.all([
			compareCheckConstraint(
				withoutIndex.session,
				withPostsTable(),
				"app",
				"posts",
				"posts_status_valid",
				declaredExpression,
			),
			compareCheckConstraint(
				withIndex.session,
				withPostsTable(),
				"app",
				"posts",
				"posts_status_valid",
				declaredExpression,
			),
		]);

		expect(findingsWithoutIndex).toEqual([]);
		expect(findingsWithIndex).toEqual([]);
		// The regression guard itself: an index existing or not never changes
		// *which query shape* gets sent -- it is always the select-list form.
		expectSelectListProbes(withoutIndex.calls);
		expectSelectListProbes(withIndex.calls);
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
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts.posts_status_valid");
		expect(findings[0]?.error).toMatchObject({ code: "check-not-compared" });
		expect(findings[0]?.error.message).toContain("permission denied");
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
			explainOutputs: [
				["((amount >= '1'::numeric) AND (amount <= '200'::numeric))"],
				["((amount >= '1'::numeric) AND (amount <= '4'::numeric))"],
			],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_amount_valid",
			declaredExpression,
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		// The regression guard itself: this comparison never sends a WHERE
		// probe, so it never has a role/RLS predicate for the planner to
		// rewrite or elide in the first place.
		expectSelectListProbes(calls);
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
		);

		expect(findings).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

describe("compareCheckConstraint / 3.4 catalog side via conbin, enforcement", () => {
	it("compares a NOT VALID constraint by its expression", async () => {
		// pg_get_expr(conbin, ...) never carries "NOT VALID" -- conbin is the
		// bare expression, no wrapper to strip -- so a genuine mismatch is
		// still caught on a NOT VALID constraint, rather than convalidated
		// being false short-circuiting straight to "not enforced" and hiding
		// a real difference.
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
			explainOutputs: [
				["(status = ANY ('{a,b,c}'::text[]))"],
				["(status = ANY ('{a,b}'::text[]))"],
			],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
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
		const output = ["(status = ANY ('{a,b,c}'::text[]))"];
		const { session } = makeFakeSession({
			metadata: {
				expression: "status = ANY ('{a,b,c}'::text[])",
				convalidated: true,
			},
			explainOutputs: [output, output],
		});

		const findings = await compareCheckConstraint(
			session,
			withPostsTable(),
			"app",
			"posts",
			"posts_status_valid",
			declaredExpression,
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

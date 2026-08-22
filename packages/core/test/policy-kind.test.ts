import { describe, expect, it } from "vitest";
import { rls } from "../src/dsl/rls";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { encodeExprNode } from "../src/expr/codec";
import { eq } from "../src/expr/operators";
import { createDefaultRegistry } from "../src/kind/registry";
import { policyKind, policyUsing } from "../src/kinds/policy-kind";
import { exists, select } from "../src/query/select";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import { text, timestamptz, uuid } from "../src/types/column-builder-factories";

// #110: using/withCheck are now structured expression nodes (D67/D70), not
// pre-rendered SQL text -- these three helpers build the encoded node form
// for tests below that hand-construct a PolicySnapshot directly (rather
// than going through the DSL, which already produces this shape).
const notNullExpr = (
	schemaName: string,
	tableName: string,
	columnName: string,
) =>
	encodeExprNode({
		nodeKind: "nullTest",
		negated: true,
		operand: { nodeKind: "columnRef", schemaName, tableName, columnName },
	});

const columnEqualsStringExpr = (
	schemaName: string,
	tableName: string,
	columnName: string,
	value: string,
) =>
	encodeExprNode({
		nodeKind: "comparison",
		operator: "=",
		left: { nodeKind: "columnRef", schemaName, tableName, columnName },
		right: { nodeKind: "literal", literal: { literalKind: "string", value } },
	});

const booleanLiteralExpr = (value: boolean) =>
	encodeExprNode({
		nodeKind: "literal",
		literal: { literalKind: "boolean", value },
	});

const app = schema("app");
const registry = createDefaultRegistry();

describe("policyKind.emit", () => {
	it("emits drop-if-exists + create in that order for a create change", () => {
		const created = policyKind.emit({
			kind: "policy",
			operation: "create",
			identity: "app.posts.posts_read_published",
			previous: null,
			next: {
				schema: "app",
				table: "posts",
				name: "posts_read_published",
				permissive: true,
				command: "select",
				roles: ["anon"],
				using: notNullExpr("app", "posts", "published_at"),
				withCheck: null,
			},
			notes: [],
		});
		expect(created.map((s) => s.sql)).toEqual([
			`drop policy if exists "posts_read_published" on "app"."posts";`,
			`create policy "posts_read_published" on "app"."posts" for select to "anon" using ("app"."posts"."published_at" is not null);`,
		]);
	});

	it("renders restrictive, multi-role, with-check policies", () => {
		const created = policyKind.emit({
			kind: "policy",
			operation: "create",
			identity: "app.posts.insert_gate",
			previous: null,
			next: {
				schema: "app",
				table: "posts",
				name: "insert_gate",
				permissive: false,
				command: "insert",
				roles: ["anon", "authenticated"],
				using: null,
				withCheck: columnEqualsStringExpr("app", "posts", "status", "draft"),
			},
			notes: [],
		});
		expect(created.map((s) => s.sql)).toEqual([
			`drop policy if exists "insert_gate" on "app"."posts";`,
			`create policy "insert_gate" on "app"."posts" as restrictive for insert to "anon", "authenticated" with check ("app"."posts"."status" = 'draft');`,
		]);
	});

	it("renders the public role bare, not quoted", () => {
		const created = policyKind.emit({
			kind: "policy",
			operation: "create",
			identity: "app.posts.everyone",
			previous: null,
			next: {
				schema: "app",
				table: "posts",
				name: "everyone",
				permissive: true,
				command: "select",
				roles: ["public"],
				using: booleanLiteralExpr(true),
				withCheck: null,
			},
			notes: [],
		});
		expect(created.map((s) => s.sql)).toEqual([
			`drop policy if exists "everyone" on "app"."posts";`,
			`create policy "everyone" on "app"."posts" for select to public using (true);`,
		]);
	});

	it("emits only the drop statement for a drop change", () => {
		const statements = policyKind.emit({
			kind: "policy",
			operation: "drop",
			identity: "app.posts.posts_read_published",
			previous: {
				schema: "app",
				table: "posts",
				name: "posts_read_published",
				permissive: true,
				command: "select",
				roles: ["anon"],
				using: `"app"."posts"."published_at" is not null`,
				withCheck: null,
			},
			next: null,
			notes: [],
		});
		// D75: a real drop is bare -- an out-of-band removal fails loudly
		// at the next change instead of `if exists` silently tolerating it.
		expect(statements.map((s) => s.sql)).toEqual([
			`drop policy "posts_read_published" on "app"."posts";`,
		]);
	});
});

describe("policyKind.serialize", () => {
	it("renders a correlated exists() with the policed table as outer scope", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			status: text().notNull(),
		});
		const comments = table(
			app,
			"comments",
			{
				id: uuid().primaryKey().defaultRandom(),
				postId: uuid().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("comments_read_visible")
						.for("select")
						.to("anon")
						.using(exists(select(posts).where(eq(posts.id, t.postId)))),
				}),
			}),
		);

		const meta = getTableMeta(comments);
		if (meta.rls === null) {
			throw new Error("expected rls declaration");
		}
		const [policy] = meta.rls.policies;
		if (policy === undefined) {
			throw new Error("expected one policy");
		}
		const snapshot = policyKind.serialize(policy);
		// using is a structured node (D67/D70); decode+render via the same
		// accessor emit uses, so this keeps asserting final SQL text
		// rather than the node's internal shape.
		expect(policyUsing(snapshot as Parameters<typeof policyUsing>[0])).toBe(
			`exists (select 1 from "app"."posts" where "app"."posts"."id" = "app"."comments"."post_id")`,
		);
	});

	// #110 item 22: pins the validating side effect of the renderExpr call
	// encodeClauseExpr keeps for its result-discarding call (see the doc
	// comment on encodeClauseExpr, policy-kind.ts). assertOwnColumnsOnly
	// (dsl/rls.ts) doesn't descend into exists(), so a bad ref buried
	// inside a correlated subquery reaches declaration time unrejected --
	// this is the ONLY thing that catches it, and only because encoding
	// still renders (and discards) the expression first. If that call is
	// ever deleted as apparently-dead code, this test goes red.
	it("rejects a correlated exists() referencing a third table outside both the subquery's own scope and the outer policy's table, at serialize time", () => {
		const otherTable = table(app, "other_table", {
			id: uuid().primaryKey().defaultRandom(),
			flag: uuid().notNull(),
		});
		const comments = table(app, "comments3", {
			id: uuid().primaryKey().defaultRandom(),
			postId: uuid().notNull(),
		});
		const posts = table(
			app,
			"posts3",
			{ id: uuid().primaryKey().defaultRandom() },
			() => ({
				rls: rls.enabled({
					read: rls
						.policy("bad_cross_reference")
						.for("select")
						.to("anon")
						.using(
							exists(select(comments).where(eq(otherTable.flag, comments.id))),
						),
				}),
			}),
		);

		// assertOwnColumnsOnly (declaration time) doesn't descend into
		// exists(), so the declaration itself succeeds -- confirming the
		// blind spot encodeClauseExpr's renderExpr call is the only thing
		// that closes.
		const meta = getTableMeta(posts);
		if (meta.rls === null) {
			throw new Error("expected rls declaration");
		}
		const [policy] = meta.rls.policies;
		if (policy === undefined) {
			throw new Error("expected one policy");
		}

		expect(() => policyKind.serialize(policy)).toThrowError(
			expect.objectContaining({ code: "foreign-column-ref" }),
		);
	});
});

describe("policyKind.diff", () => {
	const buildPolicy = (using: string) => {
		const posts = table(
			app,
			"posts",
			{
				id: uuid().primaryKey().defaultRandom(),
				status: text().notNull(),
				publishedAt: timestamptz(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("posts_read_published")
						.for("select")
						.to("anon")
						.using(eq(t.status, using)),
				}),
			}),
		);
		const meta = getTableMeta(posts);
		if (meta.rls === null) {
			throw new Error("expected rls declaration");
		}
		const [policy] = meta.rls.policies;
		if (policy === undefined) {
			throw new Error("expected one policy");
		}
		return policy;
	};

	it("diffs create when there is no previous snapshot", () => {
		const next = policyKind.serialize(buildPolicy("published"));
		const identity = "app.posts.posts_read_published";
		expect(policyKind.diff(null, next, identity)).toEqual([
			{
				kind: "policy",
				operation: "create",
				identity,
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs no change for identical policies", () => {
		const previous = policyKind.serialize(buildPolicy("published"));
		const next = policyKind.serialize(buildPolicy("published"));
		expect(
			policyKind.diff(previous, next, "app.posts.posts_read_published"),
		).toEqual([]);
	});

	it("diffs any change as a single alter with a recreating note", () => {
		const previous = policyKind.serialize(buildPolicy("published"));
		const next = policyKind.serialize(buildPolicy("live"));
		const identity = "app.posts.posts_read_published";
		expect(policyKind.diff(previous, next, identity)).toEqual([
			{
				kind: "policy",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["policy changed; recreating"],
			},
		]);
	});

	it("diffs drop when there is no next snapshot", () => {
		const previous = policyKind.serialize(buildPolicy("published"));
		const identity = "app.posts.posts_read_published";
		expect(policyKind.diff(previous, null, identity)).toEqual([
			{
				kind: "policy",
				operation: "drop",
				identity,
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("is registered by createDefaultRegistry, depending on rls and table", () => {
		expect(registry.get("policy")).toBe(policyKind);
		expect(policyKind.dependsOn).toEqual(["rls", "table"]);
	});
});

describe("policy recreate ordering through generateMigration", () => {
	it("a policy's using change drops before it creates, exactly once", () => {
		const postsV1 = table(
			app,
			"posts",
			{
				id: uuid().primaryKey().defaultRandom(),
				status: text().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("posts_read_published")
						.for("select")
						.to("anon")
						.using(eq(t.status, "published")),
				}),
			}),
		);
		const previousSnapshot = buildSnapshot(
			[
				getTableMeta(postsV1),
				getTableMeta(postsV1).rls,
				...(getTableMeta(postsV1).rls?.policies ?? []),
			].filter((d): d is NonNullable<typeof d> => d !== null),
			registry,
		);

		const postsV2 = table(
			app,
			"posts",
			{
				id: uuid().primaryKey().defaultRandom(),
				status: text().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("posts_read_published")
						.for("select")
						.to("anon")
						.using(eq(t.status, "live")),
				}),
			}),
		);

		const result = generateMigration({
			declarations: [postsV2],
			previousSnapshot,
			registry,
		});

		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({
			kind: "policy",
			operation: "alter",
		});

		// D75: an alter's own drop half is bare, not `if exists` -- only a
		// true first-time create keeps the idempotent guard text.
		const dropIndex = result.sql.indexOf(
			'drop policy "posts_read_published" on "app"."posts";',
		);
		const createIndex = result.sql.indexOf(
			'create policy "posts_read_published"',
		);
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(dropIndex);
		expect(result.sql).not.toContain("drop policy if exists");
	});
});

// Regression (review of PR #70): PolicyBothStage's chain methods used to be
// Object.assign-ed onto the built PolicyInput under the same names as its
// clause data fields, so ending an update/all chain after only one clause
// silently replaced the other clause's null with a function — which
// renderExpr then crashed on ("unexpected value: undefined") once the
// policy reached generateMigration. Full pipeline coverage for both
// commands and both single-clause terminations.
describe("update/all policy chain termination through generateMigration (D26 regression)", () => {
	const buildSingleClausePolicy = (
		command: "update" | "all",
		clause: "using" | "withCheck",
	) =>
		table(
			app,
			"posts",
			{
				id: uuid().primaryKey().defaultRandom(),
				status: text().notNull(),
			},
			(t) => {
				const pending = rls
					.policy("posts_write_own")
					.for(command)
					.to("authenticated");
				if (clause === "using") {
					return {
						rls: rls.enabled({
							write: pending.using(eq(t.status, "draft")),
						}),
					};
				}
				return {
					rls: rls.enabled({
						write: pending.withCheck(eq(t.status, "draft")),
					}),
				};
			},
		);

	it.each([
		{ command: "update" as const, clause: "using" as const },
		{ command: "update" as const, clause: "withCheck" as const },
		{ command: "all" as const, clause: "using" as const },
		{ command: "all" as const, clause: "withCheck" as const },
	])(
		"$command policy ending on .$clause() binds a null opposite clause and emits only that clause's SQL",
		({ command, clause }) => {
			const posts = buildSingleClausePolicy(command, clause);
			const meta = getTableMeta(posts);
			if (meta.rls === null) {
				throw new Error("expected rls declaration");
			}
			const [policy] = meta.rls.policies;
			if (policy === undefined) {
				throw new Error("expected one policy");
			}

			if (clause === "using") {
				expect(policy.using).not.toBeNull();
				expect(policy.withCheck).toBeNull();
			} else {
				expect(policy.withCheck).not.toBeNull();
				expect(policy.using).toBeNull();
			}

			const result = generateMigration({
				declarations: [posts],
				previousSnapshot: emptySnapshot,
				registry,
			});

			if (clause === "using") {
				expect(result.sql).toContain("using (");
				expect(result.sql).not.toContain("with check (");
			} else {
				expect(result.sql).toContain("with check (");
				expect(result.sql).not.toContain("using (");
			}
		},
	);
});

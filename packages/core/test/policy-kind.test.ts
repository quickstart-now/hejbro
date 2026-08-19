import { describe, expect, it } from "vitest";
import { rls } from "../src/dsl/rls";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { eq } from "../src/expr/operators";
import { createDefaultRegistry } from "../src/kind/registry";
import { policyKind } from "../src/kinds/policy-kind";
import { exists, select } from "../src/query/select";
import { buildSnapshot } from "../src/snapshot/snapshot";
import { text, timestamptz, uuid } from "../src/types/column-builder-factories";

const ddland = schema("ddland");
const registry = createDefaultRegistry();

describe("policyKind.emit", () => {
	it("emits drop-if-exists + create in that order for a create change", () => {
		const created = policyKind.emit({
			kind: "policy",
			operation: "create",
			identity: "ddland.posts.posts_read_published",
			previous: null,
			next: {
				schema: "ddland",
				table: "posts",
				name: "posts_read_published",
				permissive: true,
				command: "select",
				roles: ["anon"],
				using: `"ddland"."posts"."published_at" is not null`,
				withCheck: null,
			},
			notes: [],
		});
		expect(created.map((s) => s.sql)).toEqual([
			`drop policy if exists "posts_read_published" on "ddland"."posts";`,
			`create policy "posts_read_published" on "ddland"."posts" for select to "anon" using ("ddland"."posts"."published_at" is not null);`,
		]);
	});

	it("renders restrictive, multi-role, with-check policies", () => {
		const created = policyKind.emit({
			kind: "policy",
			operation: "create",
			identity: "ddland.posts.insert_gate",
			previous: null,
			next: {
				schema: "ddland",
				table: "posts",
				name: "insert_gate",
				permissive: false,
				command: "insert",
				roles: ["anon", "authenticated"],
				using: null,
				withCheck: `"ddland"."posts"."status" = 'draft'`,
			},
			notes: [],
		});
		expect(created.map((s) => s.sql)).toEqual([
			`drop policy if exists "insert_gate" on "ddland"."posts";`,
			`create policy "insert_gate" on "ddland"."posts" as restrictive for insert to "anon", "authenticated" with check ("ddland"."posts"."status" = 'draft');`,
		]);
	});

	it("renders the public role bare, not quoted", () => {
		const created = policyKind.emit({
			kind: "policy",
			operation: "create",
			identity: "ddland.posts.everyone",
			previous: null,
			next: {
				schema: "ddland",
				table: "posts",
				name: "everyone",
				permissive: true,
				command: "select",
				roles: ["public"],
				using: "true",
				withCheck: null,
			},
			notes: [],
		});
		expect(created.map((s) => s.sql)).toEqual([
			`drop policy if exists "everyone" on "ddland"."posts";`,
			`create policy "everyone" on "ddland"."posts" for select to public using (true);`,
		]);
	});

	it("emits only the drop statement for a drop change", () => {
		const statements = policyKind.emit({
			kind: "policy",
			operation: "drop",
			identity: "ddland.posts.posts_read_published",
			previous: {
				schema: "ddland",
				table: "posts",
				name: "posts_read_published",
				permissive: true,
				command: "select",
				roles: ["anon"],
				using: `"ddland"."posts"."published_at" is not null`,
				withCheck: null,
			},
			next: null,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			`drop policy if exists "posts_read_published" on "ddland"."posts";`,
		]);
	});
});

describe("policyKind.serialize", () => {
	it("renders a correlated exists() with the policed table as outer scope", () => {
		const posts = table(ddland, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			status: text().notNull(),
		});
		const comments = table(
			ddland,
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
		const snapshot = policyKind.serialize(policy) as {
			using: string | null;
		};
		expect(snapshot.using).toBe(
			`exists (select 1 from "ddland"."posts" where "ddland"."posts"."id" = "ddland"."comments"."post_id")`,
		);
	});
});

describe("policyKind.diff", () => {
	const buildPolicy = (using: string) => {
		const posts = table(
			ddland,
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
		const identity = "ddland.posts.posts_read_published";
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
			policyKind.diff(previous, next, "ddland.posts.posts_read_published"),
		).toEqual([]);
	});

	it("diffs any change as a single alter with a recreating note", () => {
		const previous = policyKind.serialize(buildPolicy("published"));
		const next = policyKind.serialize(buildPolicy("live"));
		const identity = "ddland.posts.posts_read_published";
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
		const identity = "ddland.posts.posts_read_published";
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
			ddland,
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
			ddland,
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

		const dropIndex = result.sql.indexOf(
			'drop policy if exists "posts_read_published" on "ddland"."posts";',
		);
		const createIndex = result.sql.indexOf(
			'create policy "posts_read_published"',
		);
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(dropIndex);
		expect(result.sql.match(/drop policy if exists/g)).toHaveLength(1);
	});
});

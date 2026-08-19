import { describe, expect, it } from "vitest";
import { defineView } from "../src/dsl/define-view";
import { schema } from "../src/dsl/schema";
import { table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { eq, isNotNull } from "../src/expr/operators";
import { createDefaultRegistry } from "../src/kind/registry";
import { viewKind } from "../src/kinds/view-kind";
import { select } from "../src/query/select";
import { emptySnapshot } from "../src/snapshot/snapshot";
import { text, timestamptz, uuid } from "../src/types/column-builder-factories";

const ddland = schema("ddland");
const posts = table(ddland, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});
const registry = createDefaultRegistry();

describe("viewKind.serialize", () => {
	it("derives columns from an allColumns projection (securityInvoker omitted at its false default — compact snapshot)", () => {
		const view = defineView(
			ddland,
			"published_posts",
			select(posts).where(isNotNull(posts.publishedAt)),
		);
		const snapshot = viewKind.serialize(view) as {
			schema: string;
			name: string;
			columns: ReadonlyArray<string>;
			selectSql: string;
			securityInvoker?: true;
		};
		expect(snapshot).toEqual({
			schema: "ddland",
			name: "published_posts",
			columns: ["id", "status", "published_at"],
			selectSql:
				'select "id", "status", "published_at" from "ddland"."posts" where "ddland"."posts"."published_at" is not null',
		});
	});

	it("derives columns from an object projection, in alias order", () => {
		const view = defineView(
			ddland,
			"post_status",
			select({ postId: posts.id, postStatus: posts.status }, posts),
		);
		const snapshot = viewKind.serialize(view) as {
			columns: ReadonlyArray<string>;
		};
		expect(snapshot.columns).toEqual(["post_id", "post_status"]);
	});

	it("throws invalid-view-projection for a constantOne projection (defensive; unreachable via defineView)", () => {
		const view = defineView(ddland, "impossible", select(posts));
		const withConstantOne = {
			...view,
			query: {
				...view.query,
				projection: { projectionKind: "constantOne" as const },
			},
		};
		expect(() => viewKind.serialize(withConstantOne)).toThrowError(
			expect.objectContaining({ code: "invalid-view-projection" }),
		);
	});
});

describe("viewKind.identify", () => {
	it("identifies as schema.name", () => {
		const view = defineView(ddland, "published_posts", select(posts));
		expect(viewKind.identify(viewKind.serialize(view))).toBe(
			"ddland.published_posts",
		);
	});
});

describe("viewKind.diff", () => {
	it("diffs create when there is no previous snapshot", () => {
		const next = viewKind.serialize(
			defineView(ddland, "published_posts", select(posts)),
		);
		const identity = "ddland.published_posts";
		expect(viewKind.diff(null, next, identity)).toEqual([
			{
				kind: "view",
				operation: "create",
				identity,
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs drop when there is no next snapshot", () => {
		const previous = viewKind.serialize(
			defineView(ddland, "published_posts", select(posts)),
		);
		const identity = "ddland.published_posts";
		expect(viewKind.diff(previous, null, identity)).toEqual([
			{
				kind: "view",
				operation: "drop",
				identity,
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("diffs no change for identical views", () => {
		const previous = viewKind.serialize(
			defineView(ddland, "published_posts", select(posts)),
		);
		const next = viewKind.serialize(
			defineView(ddland, "published_posts", select(posts)),
		);
		expect(viewKind.diff(previous, next, "ddland.published_posts")).toEqual([]);
	});

	it("diffs a body-only change (same columns) as a single alter with 'view changed'", () => {
		const previous = viewKind.serialize(
			defineView(
				ddland,
				"published_posts",
				select(posts).where(isNotNull(posts.publishedAt)),
			),
		);
		const next = viewKind.serialize(
			defineView(
				ddland,
				"published_posts",
				select(posts).where(eq(posts.status, "published")),
			),
		);
		const identity = "ddland.published_posts";
		expect(viewKind.diff(previous, next, identity)).toEqual([
			{
				kind: "view",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["view changed"],
			},
		]);
	});

	it("diffs a column append (previous columns a prefix of next) as 'view changed'", () => {
		const previous = viewKind.serialize(
			defineView(ddland, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(
				ddland,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const identity = "ddland.post_titles";
		expect(viewKind.diff(previous, next, identity)).toEqual([
			{
				kind: "view",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["view changed"],
			},
		]);
	});

	it("diffs a column removal as 'view columns changed; recreating'", () => {
		const previous = viewKind.serialize(
			defineView(
				ddland,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const next = viewKind.serialize(
			defineView(ddland, "post_titles", select({ id: posts.id }, posts)),
		);
		const identity = "ddland.post_titles";
		expect(viewKind.diff(previous, next, identity)).toEqual([
			{
				kind: "view",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["view columns changed; recreating"],
			},
		]);
	});

	it("diffs a column rename as 'view columns changed; recreating'", () => {
		const previous = viewKind.serialize(
			defineView(ddland, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(ddland, "post_titles", select({ postId: posts.id }, posts)),
		);
		const identity = "ddland.post_titles";
		expect(viewKind.diff(previous, next, identity)).toEqual([
			{
				kind: "view",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["view columns changed; recreating"],
			},
		]);
	});
});

describe("viewKind.emit", () => {
	it("emits create or replace alone for a create change", () => {
		const next = viewKind.serialize(
			defineView(
				ddland,
				"published_posts",
				select(posts).where(isNotNull(posts.publishedAt)),
			),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "create",
			identity: "ddland.published_posts",
			previous: null,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'create or replace view "ddland"."published_posts" as select "id", "status", "published_at" from "ddland"."posts" where "ddland"."posts"."published_at" is not null;',
		]);
	});

	it("inserts with (security_invoker = true) before as when set", () => {
		const next = viewKind.serialize(
			defineView(ddland, "published_posts", select(posts), {
				securityInvoker: true,
			}),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "create",
			identity: "ddland.published_posts",
			previous: null,
			next,
			notes: [],
		});
		expect(statements[0]?.sql).toBe(
			'create or replace view "ddland"."published_posts" with (security_invoker = true) as select "id", "status", "published_at" from "ddland"."posts";',
		);
	});

	it("emits create or replace alone for a prefix-rule alter", () => {
		const previous = viewKind.serialize(
			defineView(ddland, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(
				ddland,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "ddland.post_titles",
			previous,
			next,
			notes: ["view changed"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'create or replace view "ddland"."post_titles" as select "ddland"."posts"."id" as "id", "ddland"."posts"."status" as "status" from "ddland"."posts";',
		]);
	});

	it("emits drop then create or replace for a recreating alter", () => {
		const previous = viewKind.serialize(
			defineView(
				ddland,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const next = viewKind.serialize(
			defineView(ddland, "post_titles", select({ id: posts.id }, posts)),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "ddland.post_titles",
			previous,
			next,
			notes: ["view columns changed; recreating"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'drop view if exists "ddland"."post_titles";',
			'create or replace view "ddland"."post_titles" as select "ddland"."posts"."id" as "id" from "ddland"."posts";',
		]);
	});

	// Regression (review of PR #71): notes are display-only banner text, not
	// a control channel — emit must recompute the prefix rule itself from
	// previous/next's columns, not branch on `change.notes`. These two cases
	// pair a snapshot-derived outcome with a note that says the opposite.
	it("recreates even with empty notes, since the prefix rule is recomputed from the snapshots", () => {
		const previous = viewKind.serialize(
			defineView(
				ddland,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const next = viewKind.serialize(
			defineView(ddland, "post_titles", select({ id: posts.id }, posts)),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "ddland.post_titles",
			previous,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'drop view if exists "ddland"."post_titles";',
			'create or replace view "ddland"."post_titles" as select "ddland"."posts"."id" as "id" from "ddland"."posts";',
		]);
	});

	it("stays a single create or replace even with a stale recreate note, when the snapshots are actually a prefix", () => {
		const previous = viewKind.serialize(
			defineView(ddland, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(
				ddland,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "ddland.post_titles",
			previous,
			next,
			notes: ["view columns changed; recreating"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'create or replace view "ddland"."post_titles" as select "ddland"."posts"."id" as "id", "ddland"."posts"."status" as "status" from "ddland"."posts";',
		]);
	});

	it("emits only drop for a drop change", () => {
		const previous = viewKind.serialize(
			defineView(ddland, "published_posts", select(posts)),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "drop",
			identity: "ddland.published_posts",
			previous,
			next: null,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'drop view if exists "ddland"."published_posts";',
		]);
	});

	it("is registered by createDefaultRegistry, depending on schema and table", () => {
		expect(registry.get("view")).toBe(viewKind);
		expect(viewKind.dependsOn).toEqual(["schema", "table"]);
	});
});

describe("view recreate ordering through generateMigration", () => {
	it("a column removal drops before it creates, exactly once", () => {
		const viewV1 = defineView(
			ddland,
			"post_titles",
			select({ id: posts.id, status: posts.status }, posts),
		);
		const result1 = generateMigration({
			declarations: [posts, viewV1],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const viewV2 = defineView(
			ddland,
			"post_titles",
			select({ id: posts.id }, posts),
		);
		const result2 = generateMigration({
			declarations: [posts, viewV2],
			previousSnapshot: result1.snapshot,
			registry,
		});

		expect(result2.changes).toHaveLength(1);
		expect(result2.changes[0]).toMatchObject({
			kind: "view",
			operation: "alter",
		});

		const dropIndex = result2.sql.indexOf(
			'drop view if exists "ddland"."post_titles";',
		);
		const createIndex = result2.sql.indexOf(
			'create or replace view "ddland"."post_titles"',
		);
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(dropIndex);
		expect(result2.sql.match(/drop view if exists/g)).toHaveLength(1);
	});
});

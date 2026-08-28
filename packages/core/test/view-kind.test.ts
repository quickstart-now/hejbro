import { describe, expect, it } from "vitest";
import { defineView } from "../src/dsl/define-view";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { eq, isNotNull } from "../src/expr/operators";
import { createDefaultRegistry } from "../src/kind/registry";
import type { ViewSnapshot } from "../src/kinds/view-kind";
import { viewKind, viewSelectSql } from "../src/kinds/view-kind";
import { select } from "../src/query/select";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import { text, timestamptz, uuid } from "../src/types/column-builder-factories";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});
const registry = createDefaultRegistry();

describe("viewKind.serialize", () => {
	it("derives columns from an allColumns projection (securityInvoker omitted at its false default — compact snapshot)", () => {
		const view = defineView(
			app,
			"published_posts",
			select(posts).where(isNotNull(posts.publishedAt)),
		);
		const snapshot = viewKind.serialize(view) as ViewSnapshot;
		expect(snapshot.schema).toBe("app");
		expect(snapshot.name).toBe("published_posts");
		expect(snapshot.columns).toEqual(["id", "status", "published_at"]);
		expect(snapshot.securityInvoker).toBeUndefined();
		// `query` is now a structured node (D67/D70/D72), not pre-rendered
		// SQL text — asserted through the accessor, same expected string
		// as before this shape change.
		expect(viewSelectSql(snapshot)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."published_at" is not null',
		);
	});

	it("derives columns from an object projection, in alias order", () => {
		const view = defineView(
			app,
			"post_status",
			select({ postId: posts.id, postStatus: posts.status }, posts),
		);
		const snapshot = viewKind.serialize(view) as {
			columns: ReadonlyArray<string>;
		};
		expect(snapshot.columns).toEqual(["post_id", "post_status"]);
	});

	// D81: the oracle, not the DSL-time projection, decides an allColumns
	// view's column order and encoded query once the snapshot is built
	// with one.
	it("serializes columns and the encoded query in the oracle's order", () => {
		const projects = table(app, "projects", {
			id: uuid(),
			description: text(),
			archivedAt: timestamptz(),
		});
		const view = defineView(app, "projects_v", select(projects));
		const snapshot = viewKind.serialize(view, {
			columnOrder: () => ["id", "archived_at", "description"],
		}) as ViewSnapshot;
		expect(snapshot.columns).toEqual(["id", "archived_at", "description"]);
		expect(viewSelectSql(snapshot)).toBe(
			'select "id", "archived_at", "description" from "app"."projects"',
		);
	});

	it("throws invalid-view-projection for a constantOne projection (defensive; unreachable via defineView)", () => {
		const view = defineView(app, "impossible", select(posts));
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
		const view = defineView(app, "published_posts", select(posts));
		expect(viewKind.identify(viewKind.serialize(view))).toBe(
			"app.published_posts",
		);
	});
});

describe("viewKind.diff", () => {
	it("diffs create when there is no previous snapshot", () => {
		const next = viewKind.serialize(
			defineView(app, "published_posts", select(posts)),
		);
		const identity = "app.published_posts";
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
			defineView(app, "published_posts", select(posts)),
		);
		const identity = "app.published_posts";
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
			defineView(app, "published_posts", select(posts)),
		);
		const next = viewKind.serialize(
			defineView(app, "published_posts", select(posts)),
		);
		expect(viewKind.diff(previous, next, "app.published_posts")).toEqual([]);
	});

	it("diffs a body-only change (same columns) as a single alter with 'view changed'", () => {
		const previous = viewKind.serialize(
			defineView(
				app,
				"published_posts",
				select(posts).where(isNotNull(posts.publishedAt)),
			),
		);
		const next = viewKind.serialize(
			defineView(
				app,
				"published_posts",
				select(posts).where(eq(posts.status, "published")),
			),
		);
		const identity = "app.published_posts";
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
			defineView(app, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(
				app,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const identity = "app.post_titles";
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
				app,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const next = viewKind.serialize(
			defineView(app, "post_titles", select({ id: posts.id }, posts)),
		);
		const identity = "app.post_titles";
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
			defineView(app, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(app, "post_titles", select({ postId: posts.id }, posts)),
		);
		const identity = "app.post_titles";
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
				app,
				"published_posts",
				select(posts).where(isNotNull(posts.publishedAt)),
			),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "create",
			identity: "app.published_posts",
			previous: null,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'create or replace view "app"."published_posts" as select "id", "status", "published_at" from "app"."posts" where "app"."posts"."published_at" is not null;',
		]);
	});

	it("inserts with (security_invoker = true) before as when set", () => {
		const next = viewKind.serialize(
			defineView(app, "published_posts", select(posts), {
				securityInvoker: true,
			}),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "create",
			identity: "app.published_posts",
			previous: null,
			next,
			notes: [],
		});
		expect(statements[0]?.sql).toBe(
			'create or replace view "app"."published_posts" with (security_invoker = true) as select "id", "status", "published_at" from "app"."posts";',
		);
	});

	it("emits create or replace alone for a prefix-rule alter", () => {
		const previous = viewKind.serialize(
			defineView(app, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(
				app,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "app.post_titles",
			previous,
			next,
			notes: ["view changed"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'create or replace view "app"."post_titles" as select "app"."posts"."id" as "id", "app"."posts"."status" as "status" from "app"."posts";',
		]);
	});

	it("emits drop then create or replace for a recreating alter", () => {
		const previous = viewKind.serialize(
			defineView(
				app,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const next = viewKind.serialize(
			defineView(app, "post_titles", select({ id: posts.id }, posts)),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "app.post_titles",
			previous,
			next,
			notes: ["view columns changed; recreating"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'drop view if exists "app"."post_titles";',
			'create or replace view "app"."post_titles" as select "app"."posts"."id" as "id" from "app"."posts";',
		]);
	});

	// Regression (review of PR #71): notes are display-only banner text, not
	// a control channel — emit must recompute the prefix rule itself from
	// previous/next's columns, not branch on `change.notes`. These two cases
	// pair a snapshot-derived outcome with a note that says the opposite.
	it("recreates even with empty notes, since the prefix rule is recomputed from the snapshots", () => {
		const previous = viewKind.serialize(
			defineView(
				app,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const next = viewKind.serialize(
			defineView(app, "post_titles", select({ id: posts.id }, posts)),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "app.post_titles",
			previous,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'drop view if exists "app"."post_titles";',
			'create or replace view "app"."post_titles" as select "app"."posts"."id" as "id" from "app"."posts";',
		]);
	});

	it("stays a single create or replace even with a stale recreate note, when the snapshots are actually a prefix", () => {
		const previous = viewKind.serialize(
			defineView(app, "post_titles", select({ id: posts.id }, posts)),
		);
		const next = viewKind.serialize(
			defineView(
				app,
				"post_titles",
				select({ id: posts.id, status: posts.status }, posts),
			),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "alter",
			identity: "app.post_titles",
			previous,
			next,
			notes: ["view columns changed; recreating"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'create or replace view "app"."post_titles" as select "app"."posts"."id" as "id", "app"."posts"."status" as "status" from "app"."posts";',
		]);
	});

	it("emits only drop for a drop change", () => {
		const previous = viewKind.serialize(
			defineView(app, "published_posts", select(posts)),
		);
		const statements = viewKind.emit({
			kind: "view",
			operation: "drop",
			identity: "app.published_posts",
			previous,
			next: null,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'drop view if exists "app"."published_posts";',
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
			app,
			"post_titles",
			select({ id: posts.id, status: posts.status }, posts),
		);
		const result1 = generateMigration({
			declarations: [posts, viewV1],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const viewV2 = defineView(
			app,
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
			'drop view if exists "app"."post_titles";',
		);
		const createIndex = result2.sql.indexOf(
			'create or replace view "app"."post_titles"',
		);
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(dropIndex);
		expect(result2.sql.match(/drop view if exists/g)).toHaveLength(1);
	});

	// D81: a column added mid-declaration to the underlying table lands
	// *last* in the table's physical order, so the view built from it is a
	// prefix extension (create or replace) — not the D27 drop + recreate a
	// declaration-order-only reading of this same change would have been.
	it("a mid-declaration column on the underlying table extends the view's own snapshot as a prefix, not a recreate", () => {
		const projectsV1 = table(app, "projects", {
			id: uuid(),
			title: text(),
			archivedAt: timestamptz(),
		});
		const viewV1 = defineView(app, "projects_v", select(projectsV1));
		const parent = buildSnapshot(
			[app, getTableMeta(projectsV1), viewV1],
			registry,
			emptySnapshot,
		);

		const projectsV2 = table(app, "projects", {
			id: uuid(),
			title: text(),
			description: text(),
			archivedAt: timestamptz(),
		});
		const viewV2 = defineView(app, "projects_v", select(projectsV2));
		const next = buildSnapshot(
			[app, getTableMeta(projectsV2), viewV2],
			registry,
			parent,
		);

		const nextView = next.objects["view:app.projects_v"] as ViewSnapshot;
		expect(nextView.columns).toEqual([
			"id",
			"title",
			"archived_at",
			"description",
		]);
		const previousView = parent.objects["view:app.projects_v"] as ViewSnapshot;
		const changes = viewKind.diff(previousView, nextView, "app.projects_v");
		expect(changes).toEqual([
			{
				kind: "view",
				operation: "alter",
				identity: "app.projects_v",
				previous: previousView,
				next: nextView,
				notes: ["view changed"],
			},
		]);
	});
});

describe("set-operation view bodies (add-set-operations task 2.2)", () => {
	const app = schema("app");
	const activeUsers = table(app, "active_users", {
		id: uuid().primaryKey(),
		name: text().notNull(),
	});
	// the RIGHT branch's second column is deliberately named differently
	// (review F3): the view's declared columns must come from the LEFT
	// branch, and identical branch names could never tell the two apart.
	const archivedUsers = table(app, "archived_users", {
		id: uuid().primaryKey(),
		title: text().notNull(),
	});

	it("a union view round-trips and lists the left branch's columns", () => {
		const unionView = defineView(
			app,
			"all_users_view",
			select(activeUsers).union(select(archivedUsers)),
		);
		const result = generateMigration({
			declarations: [app, activeUsers, archivedUsers, unionView],
			previousSnapshot: emptySnapshot,
		});
		expect(result.errors).toEqual([]);
		expect(result.sql).toContain(
			'create or replace view "app"."all_users_view" as select "id", "name" from "app"."active_users" union select "id", "title" from "app"."archived_users";',
		);
		const viewSnapshot = Object.entries(result.snapshot.objects).find(([key]) =>
			key.startsWith("view:"),
		)?.[1] as { columns: ReadonlyArray<string> };
		expect(viewSnapshot.columns).toEqual(["id", "name"]);
		// re-generating from the same declarations against the produced
		// snapshot is a no-op -- the codec round-trip holds structurally.
		const second = generateMigration({
			declarations: [app, activeUsers, archivedUsers, unionView],
			previousSnapshot: result.snapshot,
		});
		expect(second.sql).toBe("");
		const stored = JSON.stringify(result.snapshot);
		expect(stored).toContain('"set-op"');
	});
});

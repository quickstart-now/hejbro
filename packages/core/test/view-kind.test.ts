import { describe, expect, it } from "vitest";
import { defineView } from "../src/dsl/define-view";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import type { SetOpNode } from "../src/expr/ast";
import { expr } from "../src/expr/ast";
import { eq, isNotNull } from "../src/expr/operators";
import { createDefaultRegistry } from "../src/kind/registry";
import type { ViewSnapshot } from "../src/kinds/view-kind";
import { viewKind, viewSelectSql } from "../src/kinds/view-kind";
import type { SetOpStage } from "../src/query/select";
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

	it("a view body's offset and distinct on survive the snapshot round-trip (#437)", () => {
		// The reason the format moved to 8: these clauses reach the snapshot
		// through a view body, so a reader that ignored them would diff a
		// paginated or de-duplicated view as if it were neither.
		const view = defineView(
			app,
			"latest_per_status",
			select(posts)
				.distinctOn(posts.status)
				.orderBy(posts.status, { by: posts.publishedAt, direction: "desc" })
				.limit(50)
				.offset(10),
		);
		const snapshot = viewKind.serialize(view) as ViewSnapshot;
		expect(viewSelectSql(snapshot)).toBe(
			'select distinct on ("app"."posts"."status") "id", "status", "published_at" from "app"."posts" order by "app"."posts"."status" asc, "app"."posts"."published_at" desc limit 50 offset 10',
		);

		// and the round trip through a real snapshot diffs to nothing: the
		// clauses come back out of the snapshot exactly as they went in.
		const declarations = [posts, view];
		const first = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
			registry,
		});
		expect(first.errors).toEqual([]);
		const second = generateMigration({
			declarations,
			previousSnapshot: first.snapshot,
			registry,
		});
		expect(second.errors).toEqual([]);
		expect(second.sql).toBe("");
	});

	// add-window-functions task 1.8: 1.3's codec round-trip is NODE-level
	// (encodeExprNode/decodeExprNode called directly) -- this proves the
	// VIEW-level path the spec scenario and D104 both name ("a view
	// carrying a window function round-trips … a field shape would have
	// round-tripped it into a different view"): buildSnapshot's own
	// encode, then a second generateMigration decoding that snapshot back
	// and diffing to nothing. Hand-built (the over()/rank() DSL lands in
	// group 2) via expr(), same technique the D70 fixture uses.
	it("a view body's window function survives the snapshot round-trip (task 1.8)", () => {
		const view = defineView(
			app,
			"posts_ranked",
			select(
				{
					id: posts.id,
					rank: expr("numeric", {
						nodeKind: "window",
						fn: {
							nodeKind: "functionCall",
							schemaName: null,
							functionName: "rank",
							args: [],
						},
						partitionBy: [posts.status.exprNode],
						orderBy: [{ expr: posts.publishedAt.exprNode, direction: "desc" }],
					}),
				},
				posts,
			),
		);
		const snapshot = viewKind.serialize(view) as ViewSnapshot;
		expect(viewSelectSql(snapshot)).toContain(
			'rank() over (partition by "app"."posts"."status" order by "app"."posts"."published_at" desc)',
		);

		const declarations = [posts, view];
		const first = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
			registry,
		});
		expect(first.errors).toEqual([]);
		const second = generateMigration({
			declarations,
			previousSnapshot: first.snapshot,
			registry,
		});
		expect(second.errors).toEqual([]);
		expect(second.sql).toBe("");
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
	// #487 (harden-query-surface task 3.2): core's own union() now refuses
	// a mismatched key set at build time (SetOpResult resolving `never`),
	// so the two branches must share a key set -- this test used to give
	// the RIGHT branch's second column a different name ("title")
	// specifically to prove the view's declared columns come from the
	// LEFT branch; that construction no longer compiles (by design), so
	// the distinguishing signal moves to TYPE instead: `name` is
	// nullable here where the LEFT's is notNull, still union-compatible
	// (SetOpResult widens: notNull ∪ nullable = nullable) and exercises
	// the boundary this task's fix must NOT reject (same key, different
	// declared type) while a different key still would.
	const archivedUsers = table(app, "archived_users", {
		id: uuid().primaryKey(),
		name: text(),
	});

	it("a union view round-trips and lists the shared column names", () => {
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
			'create or replace view "app"."all_users_view" as select "id", "name" from "app"."active_users" union select "id", "name" from "app"."archived_users";',
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

	it("the view's declared columns come from the LEFT branch's IR node, even when construction bypasses the typed union() builder", () => {
		// #487 (group 3) and harden-query-surface group 8 both gate the
		// TYPED union() builder -- a hand-assembled SetOpNode (the shape a
		// snapshot decode, or any other code building the IR directly,
		// produces) never goes through either gate. This is the property
		// the test above stopped proving once a mismatched-name branch
		// pair stopped compiling through the builder (review, #487): the
		// view's declared columns still have to come from the LEFT
		// branch's IR, not "the left branch, but only when the builder
		// happened to construct the node".
		//
		// PG server-measured (harden-query-surface group 8's own review,
		// postgres:17.11): a view created from `select a.email, a.city
		// from a union select b.city, b.email from b` names its columns
		// "email, city" -- the LEFT branch's, even though the RIGHT
		// branch's own first column is literally "city". "Left branch
		// wins" is the server's real behavior this rule states, not
		// merely hejbro's own convention.
		const titledUsers = table(app, "titled_users", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const handBuiltNode: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: select(activeUsers).selectQuery,
			right: select(titledUsers).selectQuery,
			orderBy: [],
			limit: null,
			offset: null,
		};
		const unionView = defineView(app, "hand_built_union_view", {
			setOpQuery: handBuiltNode,
		} as SetOpStage);
		const result = generateMigration({
			declarations: [app, activeUsers, titledUsers, unionView],
			previousSnapshot: emptySnapshot,
		});
		expect(result.errors).toEqual([]);
		const viewSnapshot = Object.entries(result.snapshot.objects).find(([key]) =>
			key.startsWith("view:"),
		)?.[1] as { columns: ReadonlyArray<string> };
		expect(viewSnapshot.columns).toEqual(["id", "name"]);
	});
});

import { describe, expect, it } from "vitest";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { createDefaultRegistry } from "../src/kind/registry";
import { tableKind } from "../src/kinds/table-kind";
import {
	integer,
	text,
	timestamptz,
	uuid,
} from "../src/types/column-builder-factories";

const app = schema("app");

describe("tableKind.owns", () => {
	it("owns table declarations only", () => {
		expect(
			tableKind.owns(
				getTableMeta(table(app, "posts", { id: uuid().primaryKey() })),
			),
		).toBe(true);
		expect(tableKind.owns({ declarationKind: "schema" })).toBe(false);
	});
});

describe("tableKind.serialize", () => {
	it("materializes notNull from primaryKey", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = tableKind.serialize(getTableMeta(posts)) as {
			readonly columns: ReadonlyArray<{
				readonly name: string;
				readonly notNull: boolean;
			}>;
		};
		expect(snapshot.columns[0]?.notNull).toBe(true);
	});

	it("derives deterministic index and foreign key names", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const comments = table(app, "comments", { postId: uuid() }, (t) => ({
			indexes: [
				{ columns: [t.postId.sqlName], unique: false, indexName: null },
			],
			foreignKeys: [
				{
					columns: [t.postId],
					references: { table: posts, columns: [posts.id] },
					onDelete: "cascade",
				},
			],
		}));
		const snapshot = tableKind.serialize(getTableMeta(comments)) as {
			readonly indexes: ReadonlyArray<{ readonly name: string }>;
			readonly foreignKeys: ReadonlyArray<{
				readonly name: string;
				readonly referencesTable: string;
			}>;
		};
		expect(snapshot.indexes[0]?.name).toBe("comments_post_id_idx");
		expect(snapshot.foreignKeys[0]?.name).toBe("comments_post_id_fk");
		expect(snapshot.foreignKeys[0]?.referencesTable).toBe("app.posts");
	});
});

describe("tableKind.identify", () => {
	it("identifies as schema.tableName", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		expect(tableKind.identify(tableKind.serialize(getTableMeta(posts)))).toBe(
			"app.posts",
		);
	});
});

describe("tableKind.diff", () => {
	it("diffs none -> some as a create", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = tableKind.serialize(getTableMeta(posts));
		expect(tableKind.diff(null, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "create",
				identity: "app.posts",
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs some -> none as a drop", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const previous = tableKind.serialize(getTableMeta(posts));
		expect(tableKind.diff(previous, null, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "drop",
				identity: "app.posts",
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("has no changes when unchanged", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const snapshot = tableKind.serialize(getTableMeta(posts));
		expect(tableKind.diff(snapshot, snapshot, "app.posts")).toEqual([]);
	});

	it("has no changes when only column declaration order changes", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const after = table(app, "posts", {
			title: text(),
			id: uuid().primaryKey(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([]);
	});

	it("notes an added column", () => {
		const before = table(app, "posts", { id: uuid().primaryKey() });
		const after = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: text(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['column "slug" added'],
			},
		]);
	});

	it("notes a dropped column", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: text(),
		});
		const after = table(app, "posts", { id: uuid().primaryKey() });
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['column "slug" dropped'],
			},
		]);
	});

	it("notes a changed column type", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			views: integer(),
		});
		const after = table(app, "posts", {
			id: uuid().primaryKey(),
			views: text(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['column "views" changed'],
			},
		]);
	});

	it("notes an added index", () => {
		const before = table(app, "posts", { publishedAt: timestamptz() });
		const after = table(app, "posts", { publishedAt: timestamptz() }, (t) => ({
			indexes: [
				{
					columns: [t.publishedAt.sqlName],
					unique: false,
					indexName: null,
				},
			],
		}));
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['index "posts_published_at_idx" added'],
			},
		]);
	});

	it("notes an added foreign key", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const before = table(app, "comments", { postId: uuid() });
		const after = table(app, "comments", { postId: uuid() }, (t) => ({
			foreignKeys: [
				{
					columns: [t.postId],
					references: { table: posts, columns: [posts.id] },
					onDelete: "cascade",
				},
			],
		}));
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.comments")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.comments",
				previous,
				next,
				notes: ['foreign key "comments_post_id_fk" added'],
			},
		]);
	});
});

describe("createDefaultRegistry", () => {
	it("registers the table kind", () => {
		expect(createDefaultRegistry().get("table").kind).toBe("table");
	});
});

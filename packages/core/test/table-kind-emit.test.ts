import { describe, expect, it } from "vitest";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import type { KindChange } from "../src/kind/object-kind";
import { tableKind } from "../src/kinds/table-kind";
import { integer, text, uuid } from "../src/types/column-builder-factories";

const app = schema("app");

const expectSingleChange = (changes: ReadonlyArray<KindChange>): KindChange => {
	if (changes.length !== 1) {
		throw new Error(`expected exactly one change, got ${changes.length}`);
	}
	const [change] = changes;
	if (change === undefined) {
		throw new Error("expected a change");
	}
	return change;
};

describe("tableKind.emit — create", () => {
	it("emits a create table statement with columns, a primary key constraint, indexes, and a deferred foreign key", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const comments = table(
			app,
			"comments",
			{
				id: uuid().primaryKey().defaultRandom(),
				postId: uuid().notNull(),
			},
			(t) => ({
				indexes: [
					{
						columns: [t.postId.sqlName],
						unique: false,
						indexName: null,
					},
				],
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
						onDelete: "cascade",
					},
				],
			}),
		);

		const next = tableKind.serialize(getTableMeta(comments));
		const change = expectSingleChange(
			tableKind.diff(null, next, "app.comments"),
		);
		const sqlStatements = tableKind.emit(change);

		expect(sqlStatements).toEqual([
			{
				sql:
					'create table "app"."comments" (\n' +
					'\t"id" uuid not null default gen_random_uuid(),\n' +
					'\t"post_id" uuid not null,\n' +
					'\tprimary key ("id")\n' +
					");",
				stage: "main",
			},
			{
				sql: 'create index "comments_post_id_idx" on "app"."comments" ("post_id");',
				stage: "main",
			},
			{
				sql: 'alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."posts" ("id") on delete cascade;',
				stage: "deferred",
			},
		]);
	});

	it("emits a create table statement with a unique index and no on-delete clause when unset", () => {
		const users = table(
			app,
			"users",
			{ email: text().notNull().unique() },
			(t) => ({
				indexes: [
					{ columns: [t.email.sqlName], unique: true, indexName: null },
				],
			}),
		);
		const next = tableKind.serialize(getTableMeta(users));
		const change = expectSingleChange(tableKind.diff(null, next, "app.users"));
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'create table "app"."users" (\n\t"email" text not null unique\n);',
				stage: "main",
			},
			{
				sql: 'create unique index "users_email_idx" on "app"."users" ("email");',
				stage: "main",
			},
		]);
	});
});

describe("tableKind.emit — drop", () => {
	it("emits an exact drop table statement", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const previous = tableKind.serialize(getTableMeta(posts));
		const change = expectSingleChange(
			tableKind.diff(previous, null, "app.posts"),
		);
		expect(tableKind.emit(change)).toEqual([
			{ sql: 'drop table "app"."posts";', stage: "main" },
		]);
	});
});

describe("tableKind.emit — alter", () => {
	it("emits add column", () => {
		const before = table(app, "posts", { id: uuid().primaryKey() });
		const after = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: text().notNull(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.posts"),
		);
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."posts" add column "slug" text not null;',
				stage: "main",
			},
		]);
	});

	it("emits drop column", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: text(),
		});
		const after = table(app, "posts", { id: uuid().primaryKey() });
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.posts"),
		);
		expect(tableKind.emit(change)).toEqual([
			{ sql: 'alter table "app"."posts" drop column "slug";', stage: "main" },
		]);
	});

	it("emits alter column type", () => {
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
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.posts"),
		);
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."posts" alter column "views" type text;',
				stage: "main",
			},
		]);
	});

	it("emits set not null and drop not null", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const setNotNullAfter = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const setNotNullChange = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(setNotNullAfter)),
				"app.posts",
			),
		);
		expect(tableKind.emit(setNotNullChange)).toEqual([
			{
				sql: 'alter table "app"."posts" alter column "title" set not null;',
				stage: "main",
			},
		]);

		const dropNotNullChange = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(setNotNullAfter)),
				tableKind.serialize(getTableMeta(before)),
				"app.posts",
			),
		);
		expect(tableKind.emit(dropNotNullChange)).toEqual([
			{
				sql: 'alter table "app"."posts" alter column "title" drop not null;',
				stage: "main",
			},
		]);
	});

	it("emits set default and drop default", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const withDefault = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().default("untitled"),
		});
		const setDefaultChange = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(withDefault)),
				"app.posts",
			),
		);
		expect(tableKind.emit(setDefaultChange)).toEqual([
			{
				sql: `alter table "app"."posts" alter column "title" set default 'untitled';`,
				stage: "main",
			},
		]);

		const dropDefaultChange = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(withDefault)),
				tableKind.serialize(getTableMeta(before)),
				"app.posts",
			),
		);
		expect(tableKind.emit(dropDefaultChange)).toEqual([
			{
				sql: 'alter table "app"."posts" alter column "title" drop default;',
				stage: "main",
			},
		]);
	});

	it("doubles a quote in a string default through the full serialize → snapshot → emit path", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const withQuotedDefault = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().default("it's"),
		});

		const snapshot = tableKind.serialize(getTableMeta(withQuotedDefault));
		const snapshotColumns = (
			snapshot as {
				readonly columns: ReadonlyArray<{ readonly default: unknown }>;
			}
		).columns;
		expect(snapshotColumns[1]?.default).toBe("'it''s'");

		const setDefaultChange = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				snapshot,
				"app.posts",
			),
		);
		expect(tableKind.emit(setDefaultChange)).toEqual([
			{
				sql: `alter table "app"."posts" alter column "title" set default 'it''s';`,
				stage: "main",
			},
		]);

		const createChange = expectSingleChange(
			tableKind.diff(null, snapshot, "app.posts"),
		);
		const [createStatement] = tableKind.emit(createChange);
		expect(createStatement?.sql).toContain(`default 'it''s'`);
	});

	it("emits index add and drop", () => {
		const before = table(app, "posts", { slug: text() });
		const after = table(app, "posts", { slug: text() }, (t) => ({
			indexes: [{ columns: [t.slug.sqlName], unique: false, indexName: null }],
		}));
		const addChange = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(addChange)).toEqual([
			{
				sql: 'create index "posts_slug_idx" on "app"."posts" ("slug");',
				stage: "main",
			},
		]);

		const dropChange = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(after)),
				tableKind.serialize(getTableMeta(before)),
				"app.posts",
			),
		);
		expect(tableKind.emit(dropChange)).toEqual([
			{ sql: 'drop index "app"."posts_slug_idx";', stage: "main" },
		]);
	});

	it("emits foreign key add as deferred and drop before add when both change in the same alter", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const authors = table(app, "authors", { id: uuid().primaryKey() });
		const before = table(app, "comments", { postId: uuid() }, (t) => ({
			foreignKeys: [
				{
					columns: [t.postId],
					references: { table: posts, columns: [posts.id] },
				},
			],
		}));
		const after = table(app, "comments", { postId: uuid() }, (t) => ({
			foreignKeys: [
				{
					columns: [t.postId],
					references: { table: authors, columns: [authors.id] },
				},
			],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.comments",
			),
		);
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."comments" drop constraint "comments_post_id_fk";',
				stage: "main",
			},
			{
				sql: 'alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."authors" ("id");',
				stage: "deferred",
			},
		]);
	});
});

describe("tableKind.emit — unsupported column alters", () => {
	it("throws when only the unique flag changes", () => {
		const before = table(app, "posts", { slug: text() });
		const after = table(app, "posts", { slug: text().unique() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).toThrowError(/unique/i);
	});

	it("throws when the unique flag changes alongside the column type", () => {
		const before = table(app, "posts", { slug: integer() });
		const after = table(app, "posts", { slug: text().unique() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).toThrowError(/unique/i);
	});

	it("throws when the primary key flag is unset (which also drops materialized not-null)", () => {
		const before = table(app, "posts", { id: uuid().primaryKey() });
		const after = table(app, "posts", { id: uuid() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).toThrowError(/primary key/i);
	});
});

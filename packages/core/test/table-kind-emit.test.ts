import { describe, expect, it } from "vitest";
import { check } from "../src/dsl/check";
import { desc, index } from "../src/dsl/index-builder";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { inArray, isNotNull } from "../src/expr/operators";
import type { KindChange } from "../src/kind/object-kind";
import { tableKind } from "../src/kinds/table-kind";
import { asTableSnapshot, columnDefault } from "../src/kinds/table-snapshot";
import {
	integer,
	text,
	timestamptz,
	uuid,
} from "../src/types/column-builder-factories";

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
						columns: [{ name: t.postId.sqlName, desc: false, nulls: null }],
						unique: false,
						indexName: null,
						predicate: null,
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
					'\tconstraint "comments_pkey" primary key ("id")\n' +
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
					{
						columns: [{ name: t.email.sqlName, desc: false, nulls: null }],
						unique: true,
						indexName: null,
						predicate: null,
					},
				],
			}),
		);
		const next = tableKind.serialize(getTableMeta(users));
		const change = expectSingleChange(tableKind.diff(null, next, "app.users"));
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'create table "app"."users" (\n\t"email" text not null constraint "users_email_key" unique\n);',
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
		// default is a structured node (D67/D70); assert the final SQL via
		// columnDefault, the same accessor emit uses.
		const [, titleColumn] = asTableSnapshot(snapshot).columns;
		if (titleColumn === undefined) {
			throw new Error("expected a title column");
		}
		expect(columnDefault(titleColumn)).toBe("'it''s'");

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
			indexes: [
				{
					columns: [{ name: t.slug.sqlName, desc: false, nulls: null }],
					unique: false,
					indexName: null,
					predicate: null,
				},
			],
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

	it("emits foreign key drop as predrop and add as deferred when both change in the same alter (#122/A′)", () => {
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
				stage: "predrop",
			},
			{
				sql: 'alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."authors" ("id");',
				stage: "deferred",
			},
		]);
	});
});

describe("tableKind.emit — foreign key actions", () => {
	it("renders on delete and on update, including set default", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
						onDelete: "set null",
						onUpdate: "cascade",
					},
				],
			}),
		);
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(comments)),
				"app.comments",
			),
		);
		const sql = tableKind.emit(change).map((statement) => statement.sql);
		expect(sql).toContain(
			'alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."posts" ("id") on delete set null on update cascade;',
		);
	});

	it("emits a self-referencing foreign key as a deferred statement (D52)", () => {
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey().defaultRandom(), parentId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.parentId],
						references: { columns: [t.id] },
						onDelete: "cascade",
					},
				],
			}),
		);
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(comments)),
				"app.comments",
			),
		);
		const foreignKeyStatement = tableKind
			.emit(change)
			.find((statement) => statement.stage === "deferred");
		expect(foreignKeyStatement?.sql).toBe(
			'alter table "app"."comments" add constraint "comments_parent_id_fk" foreign key ("parent_id") references "app"."comments" ("id") on delete cascade;',
		);
	});
});

describe("tableKind.emit — checks", () => {
	it("inlines named checks in create table after the primary key", () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text().notNull() },
			(t) => ({
				checks: [
					check(
						"posts_status_check",
						inArray(t.status, ["draft", "published"]),
					),
				],
			}),
		);
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(posts)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change)[0]?.sql).toBe(
			'create table "app"."posts" (\n\t"id" uuid not null,\n\t"status" text not null,\n\tconstraint "posts_pkey" primary key ("id"),\n\tconstraint "posts_status_check" check ("app"."posts"."status" in (\'draft\', \'published\'))\n);',
		);
	});

	it("drops checks before column drops and adds them after column adds", () => {
		const before = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), legacy: text() },
			(t) => ({
				checks: [check("posts_legacy_check", isNotNull(t.legacy))],
			}),
		);
		const after = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text() },
			(t) => ({
				checks: [check("posts_status_check", isNotNull(t.status))],
			}),
		);
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'alter table "app"."posts" drop constraint "posts_legacy_check";',
			'alter table "app"."posts" drop column "legacy";',
			'alter table "app"."posts" add column "status" text;',
			'alter table "app"."posts" add constraint "posts_status_check" check ("app"."posts"."status" is not null);',
		]);
	});
});

describe("tableKind.emit — index ordering and where (D51)", () => {
	it("renders ordered columns and a where predicate", () => {
		const posts = table(
			app,
			"posts",
			{ createdAt: timestamptz(), publishedAt: timestamptz(), slug: text() },
			(t) => ({
				indexes: [
					index("posts_recent_idx").on(
						t.createdAt,
						desc(t.publishedAt, { nulls: "first" }),
					),
					index("posts_slug_published_uidx")
						.unique()
						.on(t.slug)
						.where(isNotNull(t.publishedAt)),
				],
			}),
		);
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(posts)),
				"app.posts",
			),
		);
		const sql = tableKind.emit(change).map((statement) => statement.sql);
		expect(sql).toContain(
			'create index "posts_recent_idx" on "app"."posts" ("created_at", "published_at" desc nulls first);',
		);
		expect(sql).toContain(
			'create unique index "posts_slug_published_uidx" on "app"."posts" ("slug") where "app"."posts"."published_at" is not null;',
		);
	});

	it("recreates an index whose definition changed under the same name (was silently skipped)", () => {
		const before = table(app, "posts", { a: text(), b: text() }, (t) => ({
			indexes: [index("posts_ab_idx").on(t.a)],
		}));
		const after = table(app, "posts", { a: text(), b: text() }, (t) => ({
			indexes: [index("posts_ab_idx").unique().on(t.a, t.b)],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'drop index "app"."posts_ab_idx";',
			'create unique index "posts_ab_idx" on "app"."posts" ("a", "b");',
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

	// #137: `renderColumnDefinition` (used for `add column`) never emits the
	// `primary key` clause -- that's a `createTableSql`-only, table-level
	// concern. Adding a `.primaryKey()` column to an *existing* table used
	// to silently emit `alter table ... add column ... not null;` with no
	// constraint at all -- no error, a plausible-looking statement, a
	// missing primary key. `phase8-pk-guard` (#137) turns that silent leak
	// into a loud refusal; `phase8-constraint-names` (#24) replaces this
	// guard with the real `add constraint ... primary key (...)` emission.
	it("throws when a primary-key column is added to an existing table (#137 add-path leak)", () => {
		const before = table(app, "posts", { title: text() });
		const after = table(app, "posts", {
			title: text(),
			id: uuid().primaryKey(),
		});
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).toThrowError(/primary key/i);
	});

	it("does not throw when a *non*-primary-key column is added (control)", () => {
		const before = table(app, "posts", { title: text() });
		const after = table(app, "posts", { title: text(), subtitle: text() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).not.toThrow();
	});

	it("does not throw when a unique column is added (control -- already correct, inline)", () => {
		const before = table(app, "posts", { title: text() });
		const after = table(app, "posts", {
			title: text(),
			slug: text().unique(),
		});
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).not.toThrow();
	});

	// #137: dropping one column of a composite primary key drops the whole
	// constraint on Postgres's side -- confirmed directly against a real
	// Postgres (no NOTICE, the surviving column(s) silently lose primary-key
	// status too). A fresh build of the same target declaration still
	// renders `primary key ("b")` for the surviving column, so the
	// chain-built database and a fresh one disagree (#137/#121's defect
	// class). `phase8-constraint-names` (#24) replaces this guard with the
	// real `drop constraint` + `add constraint ... primary key (survivors)`
	// emission.
	it("throws when dropping one column of a composite primary key leaves a surviving primary-key column (#137 drop-path asymmetry)", () => {
		const before = table(app, "posts", {
			a: uuid().primaryKey(),
			b: uuid().primaryKey(),
			title: text(),
		});
		const after = table(app, "posts", {
			b: uuid().primaryKey(),
			title: text(),
		});
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).toThrowError(/primary key/i);
	});

	// Control/contrast: dropping the *only* primary-key column (no survivor
	// in `next` still declares `.primaryKey()`) is the case #137's own text
	// calls "happens to be correct... because Postgres removes the
	// dependent constraint, not because hejbro noticed" -- a bare
	// `drop column` matches what `next` wants (no primary key at all), so
	// this must not throw.
	it("does not throw when dropping the only primary-key column (control -- single-column PK removal is already correct)", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const after = table(app, "posts", { title: text() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).not.toThrow();
	});

	it("does not throw when dropping a non-primary-key column (control)", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const after = table(app, "posts", { id: uuid().primaryKey() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(() => tableKind.emit(change)).not.toThrow();
	});
});

// D74/#23: a serial-family column added to an *existing* table must
// inline its sequence-backed default into the same `add column` statement
// -- otherwise `add column ... not null;` alone fails immediately on any
// table with rows (confirmed directly against a real Postgres). Detected
// via a sibling `sequence` "create" change matching this column's
// schema/table/name in `siblingChanges` (tableKind.emit's second,
// optional argument).
describe("tableKind.emit — sibling sequence coordination (D74/#23)", () => {
	const sequenceChange = (column: string): KindChange => ({
		kind: "sequence",
		operation: "create",
		identity: `app.posts_${column}_seq`,
		previous: null,
		next: {
			schema: "app",
			name: `posts_${column}_seq`,
			table: "posts",
			column,
			baseType: "integer",
		},
		notes: [],
	});

	it("inlines the default when a matching sibling sequence create change is present", () => {
		const before = table(app, "posts", { title: text() });
		const after = table(app, "posts", { title: text(), id: integer() });
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.posts"),
		);
		const statements = tableKind.emit(change, [change, sequenceChange("id")]);
		expect(statements).toEqual([
			{
				sql: `alter table "app"."posts" add column "id" integer default nextval('app.posts_id_seq');`,
				stage: "main",
			},
		]);
	});

	it("does not inline when no sibling sequence change is present (control -- unaffected majority case)", () => {
		const before = table(app, "posts", { title: text() });
		const after = table(app, "posts", { title: text(), subtitle: text() });
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.posts"),
		);
		expect(tableKind.emit(change, [change])).toEqual([
			{
				sql: 'alter table "app"."posts" add column "subtitle" text;',
				stage: "main",
			},
		]);
	});

	it("does not inline when the sibling sequence targets a *different* column (control -- precise matching)", () => {
		const before = table(app, "posts", { title: text() });
		const after = table(app, "posts", { title: text(), views: integer() });
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.posts"),
		);
		const statements = tableKind.emit(change, [
			change,
			sequenceChange("some_other_column"),
		]);
		expect(statements).toEqual([
			{
				sql: 'alter table "app"."posts" add column "views" integer;',
				stage: "main",
			},
		]);
	});
});

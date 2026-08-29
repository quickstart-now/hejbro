import { describe, expect, it } from "vitest";
import { check } from "../src/dsl/check";
import { desc, index, op } from "../src/dsl/index-builder";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { inArray, isNotNull } from "../src/expr/operators";
import { sql } from "../src/expr/sql-template";
import type { KindChange } from "../src/kind/object-kind";
import type { GrantSnapshot } from "../src/kinds/grant-kind";
import { tableKind } from "../src/kinds/table-kind";
import { asTableSnapshot, columnDefault } from "../src/kinds/table-snapshot";
import type { Snapshot } from "../src/snapshot/snapshot";
import { emptySnapshot } from "../src/snapshot/snapshot";
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
						columns: [
							{
								name: t.postId.sqlName,
								origin: { schemaName: "app", tableName: "comments" },
								desc: false,
								nulls: null,
								opclass: null,
							},
						],
						unique: false,
						indexName: null,
						predicate: null,
						method: null,
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
						columns: [
							{
								name: t.email.sqlName,
								origin: { schemaName: "app", tableName: "users" },
								desc: false,
								nulls: null,
								opclass: null,
							},
						],
						unique: true,
						indexName: null,
						predicate: null,
						method: null,
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

describe("tableKind.emit — create re-issues standing schema-wide grants (#121/D78)", () => {
	const allTablesGrant = (
		schemaName: string,
		role: string,
		privileges: GrantSnapshot["privileges"],
	): GrantSnapshot => ({
		schema: schemaName,
		grantKind: "all-tables-privileges",
		role,
		privileges,
	});

	const snapshotWith = (objects: Record<string, unknown>): Snapshot => ({
		formatVersion: 8,
		dialect: "postgres",
		objects: objects as Snapshot["objects"],
	});

	it("re-issues the exact schema-wide statement for a standing all-tables-privileges grant already declared in the table's schema", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = tableKind.serialize(getTableMeta(posts));
		const change = expectSingleChange(tableKind.diff(null, next, "app.posts"));
		const nextSnapshot = snapshotWith({
			"grant:app.all-tables-privileges.app_reader": allTablesGrant(
				"app",
				"app_reader",
				["select"],
			),
		});

		const sqlStatements = tableKind.emit(change, [change], nextSnapshot);

		// Deliberately the *schema-wide* form again — not a hand-rolled
		// table-scoped rewrite (see renderGrantStatement's own doc comment,
		// #121/D78, for why that matters for a real pg_dump comparison even
		// though both forms produce the same catalog privileges).
		expect(sqlStatements.at(-1)).toEqual({
			sql: 'grant select on all tables in schema "app" to "app_reader";',
			stage: "main",
		});
	});

	it("does not duplicate a grant that is itself newly created in the same diff (first-ever migration)", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = tableKind.serialize(getTableMeta(posts));
		const change = expectSingleChange(tableKind.diff(null, next, "app.posts"));
		const grantSnapshot = allTablesGrant("app", "app_reader", ["select"]);
		const grantCreateChange: KindChange = {
			kind: "grant",
			operation: "create",
			identity: "app.all-tables-privileges.app_reader",
			previous: null,
			next: grantSnapshot,
			notes: [],
		};
		const nextSnapshot = snapshotWith({
			"grant:app.all-tables-privileges.app_reader": grantSnapshot,
		});

		const sqlStatements = tableKind.emit(
			change,
			[change, grantCreateChange],
			nextSnapshot,
		);

		// Only the create-table statement — the grant's own "create" emit
		// (elsewhere in the same diff) already covers this table via
		// "on all tables in schema", so re-issuing it here too would just
		// be a harmless but confusing duplicate.
		expect(sqlStatements).toHaveLength(1);
	});

	it("ignores a standing grant in a different schema", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = tableKind.serialize(getTableMeta(posts));
		const change = expectSingleChange(tableKind.diff(null, next, "app.posts"));
		const nextSnapshot = snapshotWith({
			"grant:other.all-tables-privileges.app_reader": allTablesGrant(
				"other",
				"app_reader",
				["select"],
			),
		});

		expect(tableKind.emit(change, [change], nextSnapshot)).toHaveLength(1);
	});

	it("ignores schema-usage and default-table-privileges grants (neither is a per-table statement)", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = tableKind.serialize(getTableMeta(posts));
		const change = expectSingleChange(tableKind.diff(null, next, "app.posts"));
		const nextSnapshot = snapshotWith({
			"grant:app.schema-usage.app_reader": {
				schema: "app",
				grantKind: "schema-usage",
				role: "app_reader",
				privileges: [],
			} satisfies GrantSnapshot,
			"grant:app.default-table-privileges.app_reader": {
				schema: "app",
				grantKind: "default-table-privileges",
				role: "app_reader",
				privileges: ["select"],
			} satisfies GrantSnapshot,
		});

		expect(tableKind.emit(change, [change], nextSnapshot)).toHaveLength(1);
	});

	it("stays exactly as before when no next snapshot is passed (back-compat: the optional third parameter)", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = tableKind.serialize(getTableMeta(posts));
		const change = expectSingleChange(tableKind.diff(null, next, "app.posts"));

		expect(tableKind.emit(change, [change])).toHaveLength(1);
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
					columns: [
						{
							name: t.slug.sqlName,
							origin: { schemaName: "app", tableName: "posts" },
							desc: false,
							nulls: null,
							opclass: null,
						},
					],
					unique: false,
					indexName: null,
					predicate: null,
					method: null,
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

	// #284 US1 (T012): access method — `using <method>` after the table
	// name, nothing for btree; a method change recreates the index (same
	// drop + create path as any other definition change, R9).
	it("renders using <method> after the table name, and nothing for btree", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [
				index("posts_data_idx").using("gin").on(t.data),
				index("posts_data2_idx").using("btree").on(t.data),
			],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(posts)),
				"app.posts",
			),
		);
		const sql = tableKind.emit(change).map((statement) => statement.sql);
		expect(sql).toContain(
			'create index "posts_data_idx" on "app"."posts" using gin ("data");',
		);
		expect(sql).toContain(
			'create index "posts_data2_idx" on "app"."posts" ("data");',
		);
	});

	it("recreates an index whose method changed under the same name", () => {
		const before = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").using("gin").on(t.data)],
		}));
		const after = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").using("brin").on(t.data)],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'drop index "app"."posts_data_idx";',
			'create index "posts_data_idx" on "app"."posts" using brin ("data");',
		]);
	});

	// #284 US2 (T022): operator class — the opclass token sits between the
	// column and `desc`/`nulls` (R4/R9); an opclass change recreates the
	// index (same generic drop + create path as US1's method change).
	it("renders the opclass between the column and desc/nulls", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [
				index("posts_data_idx").on(
					desc(op(t.data, "text_pattern_ops"), { nulls: "first" }),
				),
			],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(posts)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toContain(
			'create index "posts_data_idx" on "app"."posts" ("data" text_pattern_ops desc nulls first);',
		);
	});

	it("recreates an index whose opclass changed under the same name", () => {
		const before = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").on(op(t.data, "text_pattern_ops"))],
		}));
		const after = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").on(t.data)],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'drop index "app"."posts_data_idx";',
			'create index "posts_data_idx" on "app"."posts" ("data");',
		]);
	});

	// #284 US3 (T033): expression indexes — the expression always renders
	// wrapped in its own parentheses (R9/F7 — Postgres' `index_elem`
	// grammar is `column_name | ( a_expr )`; a bare function call could
	// skip the wrap, but an operator expression cannot, and Postgres
	// normalizes either form to the same catalog entry, so this feature
	// always wraps), composes with unique + where, and an expression
	// change recreates the index (same generic drop + create path).
	it("renders the expression wrapped in its own parentheses, with fully-qualified column refs", () => {
		const users = table(app, "users", { email: text() }, (t) => ({
			indexes: [index("users_email_lower_idx").on(sql`lower(${t.email})`)],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(users)),
				"app.users",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toContain(
			'create index "users_email_lower_idx" on "app"."users" ((lower("app"."users"."email")));',
		);
	});

	it("wraps an operator expression the same way — a bare function call isn't special-cased", () => {
		const docs = table(app, "docs", { data: text() }, (t) => ({
			indexes: [index("docs_data_status_idx").on(sql`${t.data} ->> 'status'`)],
		}));
		const change = expectSingleChange(
			tableKind.diff(null, tableKind.serialize(getTableMeta(docs)), "app.docs"),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toContain(
			`create index "docs_data_status_idx" on "app"."docs" (("app"."docs"."data" ->> 'status'));`,
		);
	});

	it("composes an expression column with unique + where", () => {
		const users = table(
			app,
			"users",
			{ email: text(), deletedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("users_email_lower_uidx")
						.unique()
						.on(sql`lower(${t.email})`)
						.where(isNotNull(t.deletedAt)),
				],
			}),
		);
		const change = expectSingleChange(
			tableKind.diff(
				null,
				tableKind.serialize(getTableMeta(users)),
				"app.users",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toContain(
			'create unique index "users_email_lower_uidx" on "app"."users" ((lower("app"."users"."email"))) where "app"."users"."deleted_at" is not null;',
		);
	});

	it("recreates an index whose expression changed under the same name", () => {
		const before = table(app, "users", { email: text() }, (t) => ({
			indexes: [index("users_email_lower_idx").on(sql`lower(${t.email})`)],
		}));
		const after = table(app, "users", { email: text() }, (t) => ({
			indexes: [
				index("users_email_lower_idx").on(sql`lower(btrim(${t.email}))`),
			],
		}));
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.users",
			),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'drop index "app"."users_email_lower_idx";',
			'create index "users_email_lower_idx" on "app"."users" ((lower(btrim("app"."users"."email"))));',
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

	// #24: replaces the old #137 guard (throwHejbroError) with the real
	// `drop constraint` emission. Unsetting `.primaryKey()` on a column
	// that *stays* (no `drop column` event for Postgres to cascade from)
	// needs an explicit drop -- nothing else would ever remove the
	// constraint. Also drops materialized not-null (primaryKey no longer
	// implies it), independently, via alterColumnStatements.
	it("drops the primary key constraint explicitly when the flag is unset on a surviving column", () => {
		const before = table(app, "posts", { id: uuid().primaryKey() });
		const after = table(app, "posts", { id: uuid() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."posts" drop constraint "posts_pkey";',
				stage: "main",
			},
			{
				sql: 'alter table "app"."posts" alter column "id" drop not null;',
				stage: "main",
			},
		]);
	});

	// #137/#24: `renderColumnDefinition` (used for `add column`) never
	// emits the `primary key` clause -- that's a `createTableSql`-only,
	// table-level concern for a *create*. Adding a `.primaryKey()` column
	// to an *existing* table used to silently emit
	// `alter table ... add column ... not null;` with no constraint at
	// all. `phase8-pk-guard` (#137) turned that silent leak into a loud
	// refusal; `phase8-constraint-names` (#24) replaces the refusal with
	// the real `add constraint ... primary key (...)` emission, after the
	// column itself is added (it must exist before the constraint can
	// name it).
	it("adds the primary key constraint when a primary-key column is added to an existing table (#137 add-path leak, now fixed)", () => {
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
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."posts" add column "id" uuid not null;',
				stage: "main",
			},
			{
				sql: 'alter table "app"."posts" add constraint "posts_pkey" primary key ("id");',
				stage: "main",
			},
		]);
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

	// #24: the flag-toggle case, but the *add* direction, and on a column
	// that already existed (not added alongside) -- exercises the same
	// planPrimaryKeyChange rule as the "flag unset" test above, from the
	// opposite end. Confirms the unification (#166-170's old per-column
	// guard, #239-247's old added-column guard, #255-265's old
	// composite-drop guard) really is one rule, not three coincidentally
	// similar ones.
	it("adds the primary key constraint when the flag is set on a column that already existed (unification control)", () => {
		const before = table(app, "posts", { id: uuid() });
		const after = table(app, "posts", { id: uuid().primaryKey() });
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."posts" alter column "id" set not null;',
				stage: "main",
			},
			{
				sql: 'alter table "app"."posts" add constraint "posts_pkey" primary key ("id");',
				stage: "main",
			},
		]);
	});

	// Control: the primary key column *set* staying the same (even though
	// the table alters for an unrelated reason) must never touch the
	// constraint at all -- no drop, no add, no-op on this axis.
	it("touches nothing primary-key-related when an unrelated column alter leaves the pk column set unchanged", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const after = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const change = expectSingleChange(
			tableKind.diff(
				tableKind.serialize(getTableMeta(before)),
				tableKind.serialize(getTableMeta(after)),
				"app.posts",
			),
		);
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."posts" alter column "title" set not null;',
				stage: "main",
			},
		]);
	});

	// #137: dropping one column of a composite primary key drops the whole
	// constraint on Postgres's side (no NOTICE, confirmed directly) -- so
	// hejbro must never rely on that cascade for the *survivor's* sake.
	// `phase8-constraint-names` (#24) replaces the old guard with an
	// explicit `drop constraint` — positioned *before* the `drop column`
	// that would otherwise race the cascade — followed by
	// `add constraint ... primary key (<survivors>)`, reusing the same
	// constraint name (`derivePrimaryKeyName` depends only on the table
	// name, never the member columns, so "posts_pkey" survives unchanged
	// even though its membership does not).
	it("drops and re-adds the primary key constraint when dropping one column of a composite key leaves a surviving member (#137 drop-path asymmetry, now fixed)", () => {
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
		expect(tableKind.emit(change)).toEqual([
			{
				sql: 'alter table "app"."posts" drop constraint "posts_pkey";',
				stage: "main",
			},
			{
				sql: 'alter table "app"."posts" drop column "a";',
				stage: "main",
			},
			{
				sql: 'alter table "app"."posts" add constraint "posts_pkey" primary key ("b");',
				stage: "main",
			},
		]);
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

describe("column-level references emit identically to extras (add-relational-reads task 1.3)", () => {
	it("both declaration forms produce byte-identical migration sql and snapshot", () => {
		const buildDeclarations = (viaColumn: boolean) => {
			const owner = schema("app");
			const users = table(owner, "users", { id: uuid().primaryKey() });
			const pets = (() => {
				if (viaColumn) {
					return table(owner, "pets", {
						id: uuid().primaryKey(),
						ownerId: uuid()
							.notNull()
							.references(() => users.id),
					});
				}
				return table(
					owner,
					"pets",
					{ id: uuid().primaryKey(), ownerId: uuid().notNull() },
					(t) => ({
						foreignKeys: [
							{ columns: [t.ownerId], references: { columns: [users.id] } },
						],
					}),
				);
			})();
			return [owner, getTableMeta(users), getTableMeta(pets)];
		};

		const viaColumn = generateMigration({
			declarations: buildDeclarations(true),
			previousSnapshot: emptySnapshot,
		});
		const viaExtras = generateMigration({
			declarations: buildDeclarations(false),
			previousSnapshot: emptySnapshot,
		});
		expect(viaColumn.sql).toBe(viaExtras.sql);
		expect(viaColumn.sql).toContain('references "app"."users" ("id")');
		expect(JSON.stringify(viaColumn.snapshot)).toBe(
			JSON.stringify(viaExtras.snapshot),
		);
	});

	it("a mixed-form table emits in the same canonical order as all-extras (D1)", () => {
		const buildMixed = (mixed: boolean) => {
			const owner = schema("app");
			const users = table(owner, "users", { id: uuid().primaryKey() });
			const orgs = table(owner, "orgs", { id: uuid().primaryKey() });
			const pets = (() => {
				if (mixed) {
					return table(
						owner,
						"pets",
						{
							id: uuid().primaryKey(),
							ownerId: uuid()
								.notNull()
								.references(() => users.id),
							orgId: uuid().notNull(),
						},
						(t) => ({
							foreignKeys: [
								{ columns: [t.orgId], references: { columns: [orgs.id] } },
							],
						}),
					);
				}
				return table(
					owner,
					"pets",
					{
						id: uuid().primaryKey(),
						ownerId: uuid().notNull(),
						orgId: uuid().notNull(),
					},
					(t) => ({
						foreignKeys: [
							{ columns: [t.orgId], references: { columns: [orgs.id] } },
							{ columns: [t.ownerId], references: { columns: [users.id] } },
						],
					}),
				);
			})();
			return [
				owner,
				getTableMeta(users),
				getTableMeta(orgs),
				getTableMeta(pets),
			];
		};

		const mixed = generateMigration({
			declarations: buildMixed(true),
			previousSnapshot: emptySnapshot,
		});
		const allExtras = generateMigration({
			declarations: buildMixed(false),
			previousSnapshot: emptySnapshot,
		});
		expect(mixed.sql).toBe(allExtras.sql);
		expect(JSON.stringify(mixed.snapshot)).toBe(
			JSON.stringify(allExtras.snapshot),
		);
	});
});

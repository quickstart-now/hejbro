import { describe, expect, expectTypeOf, it } from "vitest";
import type { ColumnBuilder, Table } from "../src/index";
import {
	eq,
	exists,
	getTableMeta,
	index,
	isTable,
	schema,
	select,
	sql,
	table,
	text,
	timestamptz,
	uuid,
} from "../src/index";

const shop = schema("shop");

describe("table() surface (D15)", () => {
	it("exposes columns as top-level ColumnRef properties", () => {
		const posts = table(shop, "posts", {
			id: uuid().primaryKey(),
			publishedAt: timestamptz(),
		});
		expect(posts.id.family).toBe("uuid");
		expect(posts.publishedAt.sqlName).toBe("published_at");
		expect(posts.publishedAt.exprNode).toEqual({
			nodeKind: "columnRef",
			schemaName: "shop",
			tableName: "posts",
			columnName: "published_at",
		});
	});
	it("hides declaration metadata behind the symbol", () => {
		const posts = table(shop, "posts", { id: uuid() });
		expect(isTable(posts)).toBe(true);
		const meta = getTableMeta(posts);
		expect(meta.tableName).toBe("posts");
		expect(meta.columns[0]?.columnName).toBe("id");
		expect(Object.keys(posts)).toEqual(["id"]);
	});
	it("passes column refs to extras and resolves index()/fk inputs", () => {
		const posts = table(
			shop,
			"posts",
			{ id: uuid().primaryKey(), publishedAt: timestamptz() },
			(t) => ({ indexes: [index().on(t.publishedAt)] }),
		);
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{
				name: "published_at",
				origin: { schemaName: "shop", tableName: "posts" },
				desc: false,
				nulls: null,
				opclass: null,
			},
		]);
		const comments = table(
			shop,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid().notNull() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
						onDelete: "cascade",
					},
				],
			}),
		);
		const fk = getTableMeta(comments).foreignKeys[0];
		expect(fk?.columns).toEqual(["post_id"]);
		expect(fk?.references.tableName).toBe("posts");
	});
	it("keeps rejecting duplicate snake_cased column names", () => {
		expect(() =>
			// biome-ignore lint/style/useNamingConvention: post_id models the real SQL column name assertSqlName (D36) would derive from postId -- the test's whole point is this exact collision.
			table(shop, "posts", { postId: uuid(), post_id: uuid() }),
		).toThrowError(/duplicate-column|duplicate column/);
	});
});

const app = schema("app");

describe("table() — self-referencing foreign keys (D52)", () => {
	it("derives the referenced table from the callback's own column refs", () => {
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
		const [fk] = getTableMeta(comments).foreignKeys;
		expect(fk?.references).toEqual({
			schemaName: "app",
			tableName: "comments",
			columns: ["id"],
		});
	});

	it("still accepts an explicit table and cross-checks it", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const other = table(app, "other", { id: uuid().primaryKey() });
		expect(() =>
			table(app, "comments", { postId: uuid() }, (t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: other, columns: [posts.id] },
					},
				],
			})),
		).toThrowError(
			/foreign-key-table-mismatch|references\.columns point at "app"."posts" but references\.table names "app"."other"/,
		);
	});

	it("rejects referenced columns from two different tables", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const users = table(app, "users", { id: uuid().primaryKey() });
		expect(() =>
			table(app, "comments", { a: uuid(), b: uuid() }, (t) => ({
				foreignKeys: [
					{
						columns: [t.a, t.b],
						references: { columns: [posts.id, users.id] },
					},
				],
			})),
		).toThrow(/foreign-key-mixed-reference-tables|referencing columns of both/);
	});

	it("rejects a foreign key with no referenced columns", () => {
		expect(() =>
			table(app, "comments", { postId: uuid() }, (t) => ({
				foreignKeys: [{ columns: [t.postId], references: { columns: [] } }],
			})),
		).toThrow(
			/foreign-key-empty-references|no referenced columns \(references\.columns is empty\)/,
		);
	});
});

describe("table() — duplicate index and foreign key name errors (D51)", () => {
	it("rejects two indexes resolving to the same name", () => {
		expect(() =>
			table(app, "posts", { a: text(), b: text() }, (t) => ({
				indexes: [index("posts_a_idx").on(t.a), index().on(t.a)],
			})),
		).toThrow(
			/duplicate-index-name|unnamed indexes default to "<table>_<columns>_idx"/,
		);
	});

	it("rejects two foreign keys on the same local columns", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const users = table(app, "users", { id: uuid().primaryKey() });
		expect(() =>
			table(app, "comments", { ownerId: uuid() }, (t) => ({
				foreignKeys: [
					{ columns: [t.ownerId], references: { columns: [posts.id] } },
					{ columns: [t.ownerId], references: { columns: [users.id] } },
				],
			})),
		).toThrow(
			/duplicate-foreign-key-name|a column set can only reference one table/,
		);
	});
});

// D106 R3-B3: a foreign key's own catalog name, kept — the same shape
// index()'s own optional name already has (a name given, or `null`
// deriving `<table>_<columns>_fk` at emit time).
describe("table() — foreign key names (D106 R3-B3)", () => {
	it("derives the name by default, same as before this change", () => {
		const posts = table(app, "posts_fkname_a", { id: uuid().primaryKey() });
		const comments = table(
			app,
			"comments_fkname_a",
			{ id: uuid().primaryKey(), postId: uuid() },
			(t) => ({
				foreignKeys: [
					{ columns: [t.postId], references: { columns: [posts.id] } },
				],
			}),
		);
		expect(getTableMeta(comments).foreignKeys[0]?.name).toBeNull();
	});

	it("carries an explicit name through to the declaration", () => {
		const posts = table(app, "posts_fkname_b", { id: uuid().primaryKey() });
		const comments = table(
			app,
			"comments_fkname_b",
			{ id: uuid().primaryKey(), postId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { columns: [posts.id] },
						name: "comments_fkname_b_legacy_fkey",
					},
				],
			}),
		);
		expect(getTableMeta(comments).foreignKeys[0]?.name).toBe(
			"comments_fkname_b_legacy_fkey",
		);
	});

	it("rejects an explicit name that isn't a valid hejbro SQL identifier (D36, same rule index() already enforces)", () => {
		const posts = table(app, "posts_fkname_c", { id: uuid().primaryKey() });
		expect(() =>
			table(
				app,
				"comments_fkname_c",
				{ id: uuid().primaryKey(), postId: uuid() },
				(t) => ({
					foreignKeys: [
						{
							columns: [t.postId],
							references: { columns: [posts.id] },
							name: "Not-Valid",
						},
					],
				}),
			),
		).toThrow(/invalid-sql-name|is not a valid hejbro SQL identifier/);
	});

	it("rejects two foreign keys sharing the same explicit name, even on different columns", () => {
		const posts = table(app, "posts_fkname_d", { id: uuid().primaryKey() });
		const users = table(app, "users_fkname_d", { id: uuid().primaryKey() });
		expect(() =>
			table(
				app,
				"comments_fkname_d",
				{ id: uuid().primaryKey(), postId: uuid(), ownerId: uuid() },
				(t) => ({
					foreignKeys: [
						{
							columns: [t.postId],
							references: { columns: [posts.id] },
							name: "shared_name",
						},
						{
							columns: [t.ownerId],
							references: { columns: [users.id] },
							name: "shared_name",
						},
					],
				}),
			),
		).toThrow(expect.objectContaining({ code: "duplicate-foreign-key-name" }));
	});

	it("does not flag two foreign keys on the same columns as duplicates when they carry different explicit names", () => {
		// same shape the derived-name path already rejects (both would
		// derive "comments_fkname_e_owner_id_fk") -- explicit, distinct
		// names are a different constraint on Postgres's own terms, and
		// the DSL's own duplicate guard must not conflate the two.
		const posts = table(app, "posts_fkname_e", { id: uuid().primaryKey() });
		const users = table(app, "users_fkname_e", { id: uuid().primaryKey() });
		const comments = table(
			app,
			"comments_fkname_e",
			{ id: uuid().primaryKey(), ownerId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.ownerId],
						references: { columns: [posts.id] },
						name: "comments_fkname_e_owner_post_fkey",
					},
					{
						columns: [t.ownerId],
						references: { columns: [users.id] },
						name: "comments_fkname_e_owner_user_fkey",
					},
				],
			}),
		);
		expect(getTableMeta(comments).foreignKeys.map((fk) => fk.name)).toEqual([
			"comments_fkname_e_owner_post_fkey",
			"comments_fkname_e_owner_user_fkey",
		]);
	});
});

// #284 US3 (T031): expression indexes — validation order (data-model.md):
// unknown-index-column (name entries only) → duplicate names (name-only
// derivation) → index-expression-requires-name → index-expression-subquery
// → index-expression-foreign-column-ref.
describe("table() — expression index validation (#284 US3)", () => {
	it("requires an explicit name, proposing one from the columns the expression references", () => {
		expect(() =>
			table(app, "users", { email: text() }, (t) => ({
				indexes: [index().on(sql`lower(${t.email})`)],
			})),
		).toThrow(
			/index-expression-requires-name|Next: name it — index\("users_email_idx"\)/,
		);
	});

	it("proposes <table>_expr_idx when the expression references no column", () => {
		expect(() =>
			table(app, "users", { email: text() }, () => ({
				indexes: [index().on(sql`now()`)],
			})),
		).toThrow(
			/index-expression-requires-name|Next: name it — index\("users_expr_idx"\)/,
		);
	});

	it("rejects a subquery inside an index expression", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "users", { id: uuid() }, (t) => ({
				indexes: [
					index("users_bad_idx").on(
						exists(select(other).where(eq(other.id, t.id))),
					),
				],
			})),
		).toThrow(
			/index-expression-subquery|Postgres forbids subqueries in index expressions/,
		);
	});

	it("rejects an index expression referencing another table's column", () => {
		const other = table(app, "other", { n: text() });
		expect(() =>
			table(app, "users", { id: uuid() }, () => ({
				indexes: [index("users_bad_idx").on(sql`lower(${other.n})`)],
			})),
		).toThrow(
			/index-expression-foreign-column-ref|can only see this table's own columns/,
		);
	});

	it("unknown-index-column ignores expression entries — a mixed name+expression index composes without crashing", () => {
		const users = table(app, "users", { id: uuid(), email: text() }, (t) => ({
			indexes: [
				index("users_id_lower_email_idx").on(t.id, sql`lower(${t.email})`),
			],
		}));
		expect(getTableMeta(users).indexes[0]?.columns).toHaveLength(2);
	});

	it("duplicate-name derivation ignores expression entries — an unnamed mixed index derives its name from the name column alone", () => {
		expect(() =>
			table(app, "users", { email: text() }, (t) => ({
				indexes: [
					index("users_email_idx").on(t.email),
					index().on(t.email, sql`lower(${t.email})`),
				],
			})),
		).toThrow(
			/duplicate-index-name|table "users" declares two indexes named "users_email_idx"/,
		);
	});
});

// D1: extracts a built Table<TColumns>'s own column builders (declared
// type name, notNull, hasDefault -- the full TMeta each factory call
// carried) from its TColumns type parameter, not from the runtime refs
// object. TableColumns<TColumns> (the refs object type) stays
// ColumnRef<BuilderFamily<TColumns[K]>> -- family only -- because
// ColumnRef lives in expr/ast.ts, off limits to this change (column-source
// tracking for ColumnRef is parked as #307). This is @hejbro/query's one
// place to read per-column TMeta, and it needs no change to table.ts at
// all: Table<TColumns>'s own type parameter already retains it.
type ColumnBuildersOf<TTable extends Table> =
	TTable extends Table<infer TColumns> ? TColumns : never;

describe("table() columns carry their declared meta (D1, task 3.3)", () => {
	it("table columns carry their declared meta", () => {
		const posts = table(shop, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		type PostsColumns = ColumnBuildersOf<typeof posts>;
		// task 3.16: primaryKey() implies notNull at the type level.
		expectTypeOf<PostsColumns["id"]>().toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" } & { notNull: true }>
		>();
		expectTypeOf<PostsColumns["title"]>().toEqualTypeOf<
			ColumnBuilder<"text", { typeName: "text" } & { notNull: true }>
		>();
		// BuilderFamily extraction off the runtime refs object (table.ts's
		// existing four call sites) is unchanged -- still family only.
		expectTypeOf(posts.title.family).toEqualTypeOf<"text">();
	});
});

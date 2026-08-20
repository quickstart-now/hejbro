import { describe, expect, it } from "vitest";
import {
	getTableMeta,
	index,
	isTable,
	schema,
	table,
	text,
	timestamptz,
	uuid,
} from "../src/index";

const ddland = schema("ddland");

describe("table() surface (D15)", () => {
	it("exposes columns as top-level ColumnRef properties", () => {
		const posts = table(ddland, "posts", {
			id: uuid().primaryKey(),
			publishedAt: timestamptz(),
		});
		expect(posts.id.family).toBe("uuid");
		expect(posts.publishedAt.sqlName).toBe("published_at");
		expect(posts.publishedAt.exprNode).toEqual({
			nodeKind: "columnRef",
			schemaName: "ddland",
			tableName: "posts",
			columnName: "published_at",
		});
	});
	it("hides declaration metadata behind the symbol", () => {
		const posts = table(ddland, "posts", { id: uuid() });
		expect(isTable(posts)).toBe(true);
		const meta = getTableMeta(posts);
		expect(meta.tableName).toBe("posts");
		expect(meta.columns[0]?.columnName).toBe("id");
		expect(Object.keys(posts)).toEqual(["id"]);
	});
	it("passes column refs to extras and resolves index()/fk inputs", () => {
		const posts = table(
			ddland,
			"posts",
			{ id: uuid().primaryKey(), publishedAt: timestamptz() },
			(t) => ({ indexes: [index().on(t.publishedAt)] }),
		);
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{ name: "published_at", desc: false, nulls: null },
		]);
		const comments = table(
			ddland,
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
			table(ddland, "posts", { postId: uuid(), post_id: uuid() }),
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

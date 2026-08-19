import { describe, expect, it } from "vitest";
import {
	getTableMeta,
	index,
	isTable,
	schema,
	table,
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
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual(["published_at"]);
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
		expect(fk?.references.table.tableName).toBe("posts");
	});
	it("keeps rejecting duplicate snake_cased column names", () => {
		expect(() =>
			table(ddland, "posts", { postId: uuid(), post_id: uuid() }),
		).toThrowError(/duplicate-column|duplicate column/);
	});
});

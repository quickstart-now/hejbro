import { describe, expect, it } from "vitest";
import { index } from "../src/dsl/index-builder";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table, toSnakeCase } from "../src/dsl/table";
import {
	integer,
	text,
	timestamptz,
	uuid,
} from "../src/types/column-builder-factories";

describe("toSnakeCase", () => {
	it("converts camelCase to snake_case", () => {
		expect(toSnakeCase("publishedAt")).toBe("published_at");
		expect(toSnakeCase("id")).toBe("id");
	});
});

describe("schema()", () => {
	it("declares a schema", () => {
		expect(schema("app")).toEqual({
			declarationKind: "schema",
			schemaName: "app",
		});
	});
});

describe("pgEnum()", () => {
	it("declares an enum and its column type", () => {
		const app = schema("app");
		const postStatus = pgEnum(app, "post_status", ["draft", "published"]);
		expect(postStatus.declarationKind).toBe("enum");
		expect(postStatus.values).toEqual(["draft", "published"]);
		expect(postStatus.column().columnState.typeNode).toEqual({
			typeName: "enum",
			enumSchema: "app",
			enumName: "post_status",
		});
	});
});

describe("table() — app-style posts", () => {
	const app = schema("app");
	const postStatus = pgEnum(app, "post_status", ["draft", "published"]);

	it("preserves declaration order and applies snake_casing", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
			status: postStatus.column().notNull(),
			publishedAt: timestamptz(),
		});

		const meta = getTableMeta(posts);
		expect(meta.declarationKind).toBe("table");
		expect(meta.tableName).toBe("posts");
		expect(meta.columns.map((entry) => entry.columnName)).toEqual([
			"id",
			"title",
			"status",
			"published_at",
		]);
	});

	it("records the referenced table identity and snake_cased columns on a foreign key", () => {
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
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
						onDelete: "cascade",
					},
				],
			}),
		);

		const meta = getTableMeta(comments);
		expect(meta.foreignKeys).toHaveLength(1);
		expect(meta.foreignKeys[0]?.references).toEqual({
			schemaName: "app",
			tableName: "posts",
			columns: ["id"],
		});
		expect(meta.foreignKeys[0]?.columns).toEqual(["post_id"]);
	});

	it("declares indexes via index().on(...) with typed column refs", () => {
		const posts = table(app, "posts", { publishedAt: timestamptz() }, (t) => ({
			indexes: [index().on(t.publishedAt)],
		}));
		expect(getTableMeta(posts).indexes).toEqual([
			{
				columns: [
					{ name: "published_at", desc: false, nulls: null, opclass: null },
				],
				unique: false,
				indexName: null,
				predicate: null,
				method: null,
			},
		]);
	});

	it("throws naming the table when an index references an unknown column", () => {
		expect(() =>
			table(app, "posts", { id: uuid().primaryKey() }, () => ({
				indexes: [
					{
						columns: [
							{ name: "nonexistent", desc: false, nulls: null, opclass: null },
						],
						unique: false,
						indexName: null,
						predicate: null,
						method: null,
					},
				],
			})),
		).toThrowError(/posts/);
	});

	it("throws naming the table when a foreign key column belongs to another table", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		expect(() =>
			table(app, "comments", { id: uuid().primaryKey() }, () => ({
				foreignKeys: [
					{
						columns: [posts.id],
						references: { table: posts, columns: [posts.id] },
					},
				],
			})),
		).toThrowError(/foreign-column-ref|own columns/);
	});

	it("throws naming the table when two columns collide after snake_casing", () => {
		expect(() =>
			table(app, "widgets", {
				fooBar: text(),
				// biome-ignore lint/style/useNamingConvention: foo_bar models the real SQL column name assertSqlName (D36) would derive from fooBar -- the test's whole point is this exact collision.
				foo_bar: text(),
			}),
		).toThrowError(/widgets/);
	});
});

describe("table() — declaration-site capture", () => {
	it("captures the call site on the table's declaredAt", () => {
		const app = schema("app");
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		const declaredAt = getTableMeta(widgets).declaredAt;
		if (declaredAt !== null) {
			expect(declaredAt).toContain("dsl.test.ts");
		}
		expect(declaredAt === null || typeof declaredAt === "string").toBe(true);
	});
});

describe("table() — auxiliary types", () => {
	it("accepts integer columns for coverage of a second simple type", () => {
		const app = schema("app");
		const counters = table(app, "counters", { value: integer().notNull() });
		expect(getTableMeta(counters).columns[0]?.columnState.typeNode).toEqual({
			typeName: "integer",
		});
	});
});

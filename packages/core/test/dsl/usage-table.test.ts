import { describe, expect, expectTypeOf, it } from "vitest";
import { pgEnum } from "../../src/dsl/pg-enum";
import { schema } from "../../src/dsl/schema";
import { getTableMeta, table } from "../../src/dsl/table";
import { syncedTable } from "../../src/dsl/usage-table";
import { eq } from "../../src/expr/operators";
import { renderSelect } from "../../src/expr/render-sql";
import { select } from "../../src/query/select";
import { bigint, text, uuid } from "../../src/types/column-builder-factories";

const app = schema("app");
const status = pgEnum(app, "post_status", ["draft", "published"]);

describe("syncedTable (2.4)", () => {
	it("carries the TypeScript key of each column", () => {
		const users = syncedTable("app", "users", {
			userId: uuid().primaryKey(),
			displayName: text().notNull(),
		});
		expectTypeOf(users.userId).not.toBeNever();
		expectTypeOf(users.displayName).not.toBeNever();
		expect(getTableMeta(users).columns.map((c) => c.columnKey)).toEqual([
			"userId",
			"displayName",
		]);
		expect(getTableMeta(users).columns.map((c) => c.columnName)).toEqual([
			"user_id",
			"display_name",
		]);
	});

	it("carries mode, non-null elements, references and enum values", () => {
		const users = syncedTable("app", "users", {
			id: uuid().primaryKey(),
		});
		const posts = syncedTable("app", "posts", {
			id: uuid().primaryKey(),
			authorId: uuid()
				.notNull()
				.references(() => users.id),
			amount: bigint({ mode: "bigint" }).notNull(),
			tags: text().array().notNullElements(),
			status: status.column().notNull(),
		});
		const meta = getTableMeta(posts);
		// relation key: the column-level `.references()` sugar folds into a
		// real foreign key, exactly as it does for `table()` (D87: a usage
		// table's relation keys must survive at the query layer).
		expect(meta.foreignKeys).toHaveLength(1);
		expect(meta.foreignKeys[0]?.references.tableName).toBe("users");
		// numeric mode: `bigint({ mode: "bigint" })` reads back as `bigint`,
		// not the family's default `string` — the mode survives the same
		// `columnState` the type layer reads its `ColumnReadType` from.
		expect(
			meta.columns.find((c) => c.columnKey === "amount")?.columnState.mode,
		).toBe("bigint");
		// non-null array elements
		expect(
			meta.columns.find((c) => c.columnKey === "tags")?.columnState
				.notNullElements,
		).toBe(true);
		// enum values: the column's `typeNode` still names the exact enum
		// `status` was declared against, so the declared value union
		// (`"draft" | "published"`) is still what the type layer reads.
		const statusTypeNode = meta.columns.find((c) => c.columnKey === "status")
			?.columnState.typeNode;
		expect(statusTypeNode).toMatchObject({
			typeName: "enum",
			enumSchema: "app",
			enumName: "post_status",
		});
	});

	it("a usage table is an ordinary queryable table", () => {
		const usage = syncedTable("app", "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const declared = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		expect(renderSelect(select(usage).selectQuery)).toBe(
			renderSelect(select(declared).selectQuery),
		);
		expect(
			renderSelect(select(usage).where(eq(usage.title, "x")).selectQuery),
		).toContain('where "app"."posts"."title" =');
	});
});

import { describe, expect, it } from "vitest";
import type { ColumnRef } from "../../src/index";
import { index, isNull, schema, table, uuid } from "../../src/index";

const app = schema("app");

/**
 * A CTE column reference (add-ctes, task 1.2c) hand-built the way group 3's
 * `with()` reference will hand one out once it exists — `schemaName: null`,
 * `tableName` the CTE's bare name. `family`/`typeNode`/`sqlName` are copied
 * from a real column so only the identity half is synthetic.
 */
const cteColumnRef = (
	tableName: string,
	columnName: string,
): ColumnRef<"uuid"> => {
	const posts = table(app, "posts", { id: uuid().primaryKey() });
	return {
		...posts.id,
		sqlName: columnName,
		exprNode: {
			nodeKind: "columnRef",
			schemaName: null,
			tableName,
			columnName,
		},
	};
};

describe("declaration sites refuse a CTE column reference (task 1.2c)", () => {
	it("a foreign key's reference target refuses a CTE column, naming the CTE", () => {
		expect(() =>
			table(app, "comments", { postId: uuid() }, (t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { columns: [cteColumnRef("ranked", "id")] },
					},
				],
			})),
		).toThrow(
			expect.objectContaining({
				code: "foreign-column-ref",
				message: expect.stringContaining("ranked"),
			}),
		);
	});

	it("a foreign key's local column refuses a CTE column, naming the CTE", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		expect(() =>
			table(app, "comments", {}, () => ({
				foreignKeys: [
					{
						columns: [cteColumnRef("ranked", "post_id")],
						references: { columns: [posts.id] },
					},
				],
			})),
		).toThrow(
			expect.objectContaining({
				code: "foreign-column-ref",
				message: expect.stringContaining("ranked"),
			}),
		);
	});

	it("the per-column .references() sugar refuses a CTE reference target, naming the CTE", () => {
		expect(() =>
			table(app, "comments", {
				postId: uuid().references(() => cteColumnRef("ranked", "id")),
			}),
		).toThrow(
			expect.objectContaining({
				code: "foreign-column-ref",
				message: expect.stringContaining("ranked"),
			}),
		);
	});

	it("an index's where predicate refuses a CTE column, naming the CTE", () => {
		expect(() =>
			table(app, "comments", { postId: uuid() }, (t) => ({
				indexes: [
					index()
						.on(t.postId)
						.where(isNull(cteColumnRef("ranked", "flag"))),
				],
			})),
		).toThrow(
			expect.objectContaining({
				code: "index-predicate-foreign-column-ref",
				message: expect.stringContaining("ranked"),
			}),
		);
	});

	it("an index's own column list refuses a CTE column, naming the CTE (task 1.2d)", () => {
		expect(() =>
			table(app, "comments", { postId: uuid() }, () => ({
				indexes: [index().on(cteColumnRef("ranked", "id"))],
			})),
		).toThrow(
			expect.objectContaining({
				code: "foreign-column-ref",
				message: expect.stringContaining("ranked"),
			}),
		);
	});
});

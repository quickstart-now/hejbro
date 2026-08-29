import { describe, expect, it } from "vitest";
import type { ColumnRef } from "../../src/index";
import {
	index,
	isNull,
	schema,
	select,
	table,
	uuid,
	withCte,
} from "../../src/index";

const app = schema("app");

/**
 * A CTE column reference (add-ctes, task 1.2c) hand-built to look like the
 * shape `withCte()`'s own reference (`w.as()`, task 3.1/3.2) hands out —
 * `schemaName: null`, `tableName` the CTE's bare name — except it keeps
 * `sqlName` (a real `withCte()` reference does not, task 3.2), so it still
 * reaches `dsl/index-builder.ts`'s `ColumnRef` branch rather than its
 * expression one. `family`/`typeNode` are copied from a real column so only
 * the identity half is synthetic.
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

	// add-ctes task 3.5: a REAL withCte() reference (no `sqlName`, unlike the
	// hand-built cteColumnRef above) takes a different branch in
	// dsl/index-builder.ts's own isColumnRef duck-typing -- it lands as an
	// index EXPRESSION, not a plain column, so it is
	// assertNoForeignIndexExpressionColumn (a pre-existing, non-add-ctes
	// guard) that actually rejects it, and that guard's message never
	// expected a null schema before this change made one reachable.
	it("an index expression naming a CTE column names the CTE, not `null`", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			return select({ id: ranked.id }, ranked);
		});
		const leaked = stage.projectionInput.id;
		expect(() =>
			table(app, "comments", { postId: uuid() }, () => ({
				indexes: [index("comments_leaked_idx").on(leaked)],
			})),
		).toThrow(
			expect.objectContaining({
				code: "index-expression-foreign-column-ref",
				message: expect.stringContaining('of the CTE "ranked"'),
			}),
		);
	});
});

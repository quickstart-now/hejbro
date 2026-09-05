import { describe, expect, expectTypeOf, it } from "vitest";
import type { Aggregated, Expr, ExprNode, ReadAs } from "../../src/index";
import {
	avg,
	columnRef,
	count,
	expr,
	filter,
	isNotNull,
	max,
	min,
	over,
	rowNumber,
	sql,
	sum,
} from "../../src/index";

const viewsColumn = columnRef("app", "posts", "views", { typeName: "integer" });
const publishedAtColumn = columnRef("app", "posts", "published_at", {
	typeName: "timestamptz",
});
const condition = isNotNull(publishedAtColumn);

/**
 * Every builder aggregate the delta covers, table-shaped (D110) rather
 * than one example — `argsExprNodes` is each constructor's own argument
 * list, exactly what `filter`'s produced `aggregateFilter.fn.args`
 * must equal.
 */
const aggregateCases: ReadonlyArray<{
	readonly label: string;
	readonly functionName: string;
	readonly target: Expr;
	readonly argsExprNodes: ReadonlyArray<ExprNode>;
}> = [
	{
		label: "count",
		functionName: "count",
		target: count(),
		argsExprNodes: [{ nodeKind: "rawSql", sql: "*" }],
	},
	{
		label: "min",
		functionName: "min",
		target: min(viewsColumn),
		argsExprNodes: [viewsColumn.exprNode],
	},
	{
		label: "max",
		functionName: "max",
		target: max(viewsColumn),
		argsExprNodes: [viewsColumn.exprNode],
	},
	{
		label: "sum",
		functionName: "sum",
		target: sum(viewsColumn),
		argsExprNodes: [viewsColumn.exprNode],
	},
	{
		label: "avg",
		functionName: "avg",
		target: avg(viewsColumn),
		argsExprNodes: [viewsColumn.exprNode],
	},
];

describe("filter()'s node shape, task 1.1 (#501/R2 Q2)", () => {
	it.each(aggregateCases)(
		"$label: filter(target, condition) is an aggregateFilter node wrapping the aggregate's own call",
		({ functionName, target, argsExprNodes }) => {
			const filtered = filter(target, condition);
			expect(filtered.exprNode).toEqual({
				nodeKind: "aggregateFilter",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName,
					args: argsExprNodes,
				},
				where: condition.exprNode,
			});
		},
	);

	it.each(aggregateCases)(
		"$label: over(filter(target, condition), spec) nests the aggregateFilter node under the window's fn",
		({ functionName, target, argsExprNodes }) => {
			const windowed = over(filter(target, condition), {
				orderBy: [publishedAtColumn],
			});
			expect(windowed.exprNode).toEqual({
				nodeKind: "window",
				fn: {
					nodeKind: "aggregateFilter",
					fn: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName,
						args: argsExprNodes,
					},
					where: condition.exprNode,
				},
				partitionBy: [],
				orderBy: [{ expr: publishedAtColumn.exprNode, direction: "asc" }],
			});
		},
	);
});

describe("filter()'s projected type matches its aggregate's own, task 1.1 (#501/R2 Q2)", () => {
	it("count: keeps the ReadAs<bigint> brand", () => {
		expectTypeOf(filter(count(), condition)).toEqualTypeOf<
			Aggregated<Expr<"numeric"> & ReadAs<bigint>>
		>();
	});

	it("min: keeps the operand's own read type", () => {
		expectTypeOf(filter(min(viewsColumn), condition)).toEqualTypeOf<
			Aggregated<typeof viewsColumn>
		>();
	});

	it("max: keeps the operand's own read type", () => {
		expectTypeOf(filter(max(viewsColumn), condition)).toEqualTypeOf<
			Aggregated<typeof viewsColumn>
		>();
	});

	it("sum: stays at the numeric family's widest honest type", () => {
		expectTypeOf(filter(sum(viewsColumn), condition)).toEqualTypeOf<
			Aggregated<Expr<"numeric">>
		>();
	});

	it("avg: stays at the numeric family's widest honest type", () => {
		expectTypeOf(filter(avg(viewsColumn), condition)).toEqualTypeOf<
			Aggregated<Expr<"numeric">>
		>();
	});
});

describe("filter() refuses anything that is not a builder aggregate, task 1.1 (#501/R2 Q3)", () => {
	it("refuses a column reference", () => {
		expect(() => filter(viewsColumn, condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining("a column reference"),
			}),
		);
	});

	it("refuses a raw sql fragment", () => {
		expect(() => filter(sql`1`, condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining("a raw sql fragment"),
			}),
		);
	});

	it("refuses a schema-qualified declared function call, even one named like a builder aggregate", () => {
		const declaredCall: Expr = expr("numeric", {
			nodeKind: "functionCall",
			schemaName: "app",
			functionName: "count",
			args: [],
		});
		expect(() => filter(declaredCall, condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining(
					'a declared function call "app.count"',
				),
			}),
		);
	});

	it("refuses a window-only call -- rejected by tsc (@ts-expect-error) and named at runtime", () => {
		expect(() =>
			// @ts-expect-error rowNumber() carries no exprNode -- not an Expr, so filter()'s `TExpr extends Expr` constraint refuses it at compile time (#501/R2 Q2).
			filter(rowNumber(), condition),
		).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining("a window function"),
			}),
		);
	});

	it("refuses an already-windowed expression", () => {
		const windowedCount = over(count(), {});
		expect(() => filter(windowedCount, condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining("an already-windowed expression"),
			}),
		);
	});
});

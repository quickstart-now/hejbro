import { describe, expect, expectTypeOf, it } from "vitest";
import type { Aggregated, Expr, ExprNode, ReadAs } from "../../src/index";
import {
	and,
	avg,
	columnRef,
	count,
	expr,
	filter,
	gt,
	isNotNull,
	max,
	min,
	not,
	now,
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

	// This shape (a schema-qualified functionCall node) has no public
	// constructor today -- `db.fn` (the real "declared function" concept,
	// `@hejbro/query`) executes immediately and returns a `Promise`, never
	// builds an `ExprNode`; the only way this node shape reaches `filter()`
	// today is a snapshot-decoded expression. Hand-built here for exactly
	// that reason (review B1).
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

	// Review B1: `db.fn`'s real runtime shape (`@hejbro/query`'s `FnCaller`,
	// `Promise<unknown>`) carries neither `exprNode` nor `windowFn` --
	// `describeFilterTarget` used to call anything without `exprNode` "a
	// window function" regardless, which named this wrong. A bare
	// `Promise` stands in for it here (core has no dependency on
	// `@hejbro/query` to construct the real thing).
	it("refuses a db.fn call (a promise, neither an expression nor a window function)", () => {
		const dbFnResult = Promise.resolve(42) as unknown as Expr;
		expect(() => filter(dbFnResult, condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining("a non-expression value"),
			}),
		);
	});

	it("refuses an arbitrary non-expression object, the same way", () => {
		expect(() => filter({} as unknown as Expr, condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining("a non-expression value"),
			}),
		);
	});

	// Review N5: re-filtering an already-filtered expression used to fall
	// through to the generic "an expression" phrase -- aggregateFilter has
	// no row of its own in FILTER_TARGET_PHRASES.
	it("refuses an already-filtered expression", () => {
		const alreadyFiltered = filter(count(), condition);
		expect(() => filter(alreadyFiltered, condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining("an already-filtered expression"),
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

	// CRAP coverage gap found by the group-completion gate (#501), then
	// review B1: an unqualified functionCall whose name isn't one of the
	// five aggregates (e.g. now()) is still a declared function call, not
	// a bare "expression" -- the schema is absent from the phrase, not the
	// whole classification. `now()` is a real public constructor
	// (`expr/operators.ts`), so this row needs no hand-built node.
	it("refuses an unqualified function call that isn't one of the five aggregates, named by its bare function name", () => {
		expect(() => filter(now(), condition)).toThrowError(
			expect.objectContaining({
				code: "filter-not-aggregate",
				message: expect.stringContaining('a declared function call "now"'),
			}),
		);
	});
});

// add-aggregate-filter, review B2 (#501/R7): filter's condition takes
// exactly what where takes (design.md), so a window function inside it
// is refused the same way, through the same diagnostic where/groupBy/
// having already use -- table over where a window function can hide in
// the condition, not just the direct case.
describe("filter() refuses a window function inside its condition, same diagnostic as where (#501/R7 B2)", () => {
	const windowedRank = over(rowNumber(), {});

	it.each([
		["directly", () => gt(windowedRank, 1)],
		["nested inside and(...)", () => and(condition, gt(windowedRank, 1))],
		["nested inside not(...)", () => not(gt(windowedRank, 1))],
	])("%s", (_label, buildCondition) => {
		expect(() => filter(count(), buildCondition())).toThrowError(
			expect.objectContaining({ code: "window-function-not-allowed" }),
		);
	});
});

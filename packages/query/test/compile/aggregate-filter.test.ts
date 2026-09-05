import type { ExprNode, SelectNode } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

// add-aggregate-filter task 1.4 (#501): AggregateFilterNode is hand-built
// here rather than via the public DSL, mirroring compile/window.test.ts --
// the point of this test is params.ts's own lift handler, not the builder.

const amount: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "orders",
	columnName: "amount",
};

const literal = (value: number): ExprNode => ({
	nodeKind: "literal",
	literal: { literalKind: "number", value },
});

const cellQuery = (cell: ExprNode): SelectNode => ({
	queryKind: "select",
	projection: {
		projectionKind: "columns",
		columns: [{ alias: "cell", expr: cell }],
	},
	from: { schemaName: "app", tableName: "orders" },
	joins: [],
	where: null,
	groupBy: [],
	having: null,
	orderBy: [],
	limit: null,
	offset: null,
	distinct: null,
});

describe("compile: aggregate-filter (task 1.4, #501/R2)", () => {
	it("literals inside filter(...) are lifted in statement order: the aggregate's own args, then the condition", () => {
		const node: ExprNode = {
			nodeKind: "aggregateFilter",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "coalesce",
				args: [amount, literal(0)],
			},
			where: {
				nodeKind: "comparison",
				operator: ">",
				left: amount,
				right: literal(10),
			},
		};
		const result = compile(cellQuery(node));
		expect(result.sql).toBe(
			'select coalesce("app"."orders"."amount", $1) filter (where "app"."orders"."amount" > $2) as "cell" from "app"."orders"',
		);
		expect(result.params).toEqual([0, 10]);
	});

	it("a condition with two literals lifts both, in condition order, after the aggregate's own args", () => {
		const node: ExprNode = {
			nodeKind: "aggregateFilter",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "count",
				args: [{ nodeKind: "rawSql", sql: "*" }],
			},
			where: {
				nodeKind: "logical",
				operator: "and",
				operands: [
					{
						nodeKind: "comparison",
						operator: "=",
						left: amount,
						right: literal(1),
					},
					{
						nodeKind: "comparison",
						operator: ">",
						left: amount,
						right: literal(2),
					},
				],
			},
		};
		const result = compile(cellQuery(node));
		expect(result.sql).toBe(
			'select count(*) filter (where ("app"."orders"."amount" = $1) and ("app"."orders"."amount" > $2)) as "cell" from "app"."orders"',
		);
		expect(result.params).toEqual([1, 2]);
	});

	it("a filtered call with no literals lifts no parameters", () => {
		const node: ExprNode = {
			nodeKind: "aggregateFilter",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "count",
				args: [{ nodeKind: "rawSql", sql: "*" }],
			},
			where: {
				nodeKind: "nullTest",
				negated: true,
				operand: amount,
			},
		};
		const result = compile(cellQuery(node));
		expect(result.params).toEqual([]);
	});

	it("windowed: over(filter(sum(x), condition), spec) lifts the aggregate's own args, then the condition, then partitionBy, then orderBy", () => {
		const node: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "aggregateFilter",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "sum",
					args: [amount],
				},
				where: {
					nodeKind: "comparison",
					operator: ">",
					left: amount,
					right: literal(1),
				},
			},
			partitionBy: [literal(2)],
			orderBy: [{ expr: literal(3), direction: "asc" }],
		};
		const result = compile(cellQuery(node));
		expect(result.sql).toBe(
			'select sum("app"."orders"."amount") filter (where "app"."orders"."amount" > $1) over (partition by $2 order by $3 asc) as "cell" from "app"."orders"',
		);
		expect(result.params).toEqual([1, 2, 3]);
	});
});

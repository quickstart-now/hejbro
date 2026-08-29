import type { ExprNode, SelectNode } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

// add-window-functions task 1.6: WindowNode is hand-built here rather than
// via the public DSL (the over()/rank() vocabulary lands in group 2) -- the
// point of this test is params.ts's own lift handler, not the builder.

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

const windowQuery = (window: ExprNode): SelectNode => ({
	queryKind: "select",
	projection: {
		projectionKind: "columns",
		columns: [{ alias: "score", expr: window }],
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

describe("compile: window functions (task 1.6)", () => {
	it("literals inside over() are lifted in statement order: fn args, then partitionBy, then orderBy", () => {
		const window: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "coalesce",
				args: [amount, literal(0)],
			},
			partitionBy: [literal(1)],
			orderBy: [{ expr: literal(2), direction: "asc" }],
		};
		const result = compile(windowQuery(window));

		expect(result.sql).toBe(
			'select coalesce("app"."orders"."amount", $1) over (partition by $2 order by $3 asc) as "score" from "app"."orders"',
		);
		expect(result.params).toEqual([0, 1, 2]);
	});

	it("a windowed function with no literals lifts no parameters", () => {
		const window: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "rank",
				args: [],
			},
			partitionBy: [],
			orderBy: [],
		};
		const result = compile(windowQuery(window));

		expect(result.sql).toBe(
			'select rank() over () as "score" from "app"."orders"',
		);
		expect(result.params).toEqual([]);
	});
});

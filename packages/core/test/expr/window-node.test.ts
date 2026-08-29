import { describe, expect, it } from "vitest";
import type { ExprNode, SelectNode } from "../../src/index";
import { renderExpr, renderSelect } from "../../src/index";

const customerId: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "orders",
	columnName: "customer_id",
};
const createdAt: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "orders",
	columnName: "created_at",
};
const amount: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "orders",
	columnName: "amount",
};

describe("WindowNode rendering (task 1.1)", () => {
	it("renders a window function with partition by and order by", () => {
		const node: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "rank",
				args: [],
			},
			partitionBy: [customerId],
			orderBy: [{ expr: createdAt, direction: "desc" }],
		};
		expect(renderExpr(node)).toBe(
			'rank() over (partition by "app"."orders"."customer_id" order by "app"."orders"."created_at" desc)',
		);
	});

	it("omits partition by and order by when both are empty", () => {
		const node: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "row_number",
				args: [],
			},
			partitionBy: [],
			orderBy: [],
		};
		expect(renderExpr(node)).toBe("row_number() over ()");
	});

	it("renders a windowed aggregate's own function call through fn, order by only", () => {
		const node: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "sum",
				args: [amount],
			},
			partitionBy: [],
			orderBy: [{ expr: createdAt, direction: "asc" }],
		};
		expect(renderExpr(node)).toBe(
			'sum("app"."orders"."amount") over (order by "app"."orders"."created_at" asc)',
		);
	});
});

describe("WindowNode scope validation (task 1.2)", () => {
	const outside: ExprNode = {
		nodeKind: "columnRef",
		schemaName: "app",
		tableName: "comments",
		columnName: "id",
	};
	const baseQuery: SelectNode = {
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: { schemaName: "app", tableName: "orders" },
		joins: [],
		where: null,
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	};

	const windowColumn = (window: ExprNode): SelectNode => ({
		...baseQuery,
		projection: {
			projectionKind: "columns",
			columns: [{ alias: "rnk", expr: window }],
		},
	});

	it("throws foreign-column-ref when partitionBy references an out-of-scope table", () => {
		const window: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "rank",
				args: [],
			},
			partitionBy: [outside],
			orderBy: [],
		};
		expect(() => renderSelect(windowColumn(window))).toThrowError(
			expect.objectContaining({ code: "foreign-column-ref" }),
		);
	});

	it("throws foreign-column-ref when orderBy references an out-of-scope table", () => {
		const window: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "rank",
				args: [],
			},
			partitionBy: [],
			orderBy: [{ expr: outside, direction: "asc" }],
		};
		expect(() => renderSelect(windowColumn(window))).toThrowError(
			expect.objectContaining({ code: "foreign-column-ref" }),
		);
	});

	it("throws foreign-column-ref when fn's own argument references an out-of-scope table", () => {
		const window: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "sum",
				args: [outside],
			},
			partitionBy: [],
			orderBy: [],
		};
		expect(() => renderSelect(windowColumn(window))).toThrowError(
			expect.objectContaining({ code: "foreign-column-ref" }),
		);
	});

	it("does not throw when a projection-level reference is the only usage (does not substitute for the window check)", () => {
		const window: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "rank",
				args: [],
			},
			partitionBy: [customerId],
			orderBy: [],
		};
		expect(() => renderSelect(windowColumn(window))).not.toThrow();
	});
});

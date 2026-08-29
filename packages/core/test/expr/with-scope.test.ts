import { describe, expect, it } from "vitest";
import type { QueryNode, SelectNode } from "../../src/index";
import { renderQuery } from "../../src/index";

const recentOrders: SelectNode = {
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

describe("WITH scope (task 1.3)", () => {
	it("a column of an undeclared CTE is refused, naming the statement's available sources", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
			],
			recursive: false,
			body: {
				...recentOrders,
				from: { cteName: "missing_cte" },
			},
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({
				code: "undeclared-cte",
				message: expect.stringContaining("missing_cte"),
			}),
		);
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({
				message: expect.stringContaining("recent_orders"),
			}),
		);
	});

	it("a join naming an undeclared CTE is refused the same way", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
			],
			recursive: false,
			body: {
				...recentOrders,
				joins: [
					{
						joinKind: "inner",
						table: { cteName: "missing_cte" },
						on: {
							nodeKind: "literal",
							literal: { literalKind: "boolean", value: true },
						},
					},
				],
			},
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({ code: "undeclared-cte" }),
		);
	});

	it("a CTE that names another declared CTE renders without error", () => {
		const topCustomers: SelectNode = {
			...recentOrders,
			from: { cteName: "recent_orders" },
		};
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
				{ name: "top_customers", query: topCustomers, materialized: null },
			],
			recursive: false,
			body: { ...recentOrders, from: { cteName: "top_customers" } },
		};
		expect(() => renderQuery(node)).not.toThrow();
	});
});

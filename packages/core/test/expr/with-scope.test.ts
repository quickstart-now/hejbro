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

describe("Entry visibility within the list (task 1.4)", () => {
	it("an entry may reference an earlier entry", () => {
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
			body: recentOrders,
		};
		expect(() => renderQuery(node)).not.toThrow();
	});

	it("a node referencing a later entry is refused", () => {
		const earlyEntry: SelectNode = {
			...recentOrders,
			from: { cteName: "top_customers" },
		};
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: earlyEntry, materialized: null },
				{ name: "top_customers", query: recentOrders, materialized: null },
			],
			recursive: false,
			body: recentOrders,
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({
				code: "undeclared-cte",
				message: expect.stringContaining("top_customers"),
			}),
		);
	});

	it("an entry cannot reference itself (non-recursive)", () => {
		const selfReferencing: SelectNode = {
			...recentOrders,
			from: { cteName: "recent_orders" },
		};
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: selfReferencing, materialized: null },
			],
			recursive: false,
			body: recentOrders,
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({ code: "undeclared-cte" }),
		);
	});
});

describe("Visibility reaches a nested subquery's own from/join (task 1.3 follow-up)", () => {
	it("an exists() subquery naming an undeclared CTE is refused", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
			],
			recursive: false,
			body: {
				...recentOrders,
				where: {
					nodeKind: "exists",
					negated: false,
					query: { ...recentOrders, from: { cteName: "missing_cte" } },
				},
			},
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({
				code: "undeclared-cte",
				message: expect.stringContaining("missing_cte"),
			}),
		);
	});

	it("an exists() subquery may reference a CTE visible at the body's own position", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
			],
			recursive: false,
			body: {
				...recentOrders,
				where: {
					nodeKind: "exists",
					negated: false,
					query: { ...recentOrders, from: { cteName: "recent_orders" } },
				},
			},
		};
		expect(() => renderQuery(node)).not.toThrow();
	});

	it("an exists() subquery inside an entry sees only that entry's earlier CTEs", () => {
		const laterInsideExists: SelectNode = {
			...recentOrders,
			where: {
				nodeKind: "exists",
				negated: false,
				query: { ...recentOrders, from: { cteName: "top_customers" } },
			},
		};
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: laterInsideExists, materialized: null },
				{ name: "top_customers", query: recentOrders, materialized: null },
			],
			recursive: false,
			body: recentOrders,
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({
				code: "undeclared-cte",
				message: expect.stringContaining("top_customers"),
			}),
		);
	});
});

describe("A CTE reference escaping its WITH is refused (task 1.3c)", () => {
	it("a select rendered outside any WITH refuses a CTE from-source", () => {
		const node: SelectNode = {
			...recentOrders,
			from: { cteName: "recent_orders" },
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({
				code: "undeclared-cte",
				message: expect.stringContaining("recent_orders"),
			}),
		);
	});

	it("a select rendered outside any WITH refuses a CTE join target", () => {
		const node: SelectNode = {
			...recentOrders,
			joins: [
				{
					joinKind: "inner",
					table: { cteName: "recent_orders" },
					on: {
						nodeKind: "literal",
						literal: { literalKind: "boolean", value: true },
					},
				},
			],
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({ code: "undeclared-cte" }),
		);
	});

	it("a select rendered outside any WITH still accepts a table from-source (no CTE targets, no check)", () => {
		expect(() => renderQuery(recentOrders)).not.toThrow();
	});
});

describe("foreign-column-ref advice names a CTE, not always a table (task 1.5(a) review)", () => {
	it("a column of a declared-but-not-joined CTE is refused with 'join that CTE'", () => {
		const topCustomers: SelectNode = {
			...recentOrders,
			from: { schemaName: "app", tableName: "customers" },
		};
		const body: SelectNode = {
			...recentOrders,
			projection: {
				projectionKind: "columns",
				columns: [
					{
						alias: "id",
						expr: {
							nodeKind: "columnRef",
							schemaName: null,
							tableName: "top_customers",
							columnName: "id",
						},
					},
				],
			},
		};
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
				{ name: "top_customers", query: topCustomers, materialized: null },
			],
			recursive: false,
			body,
		};
		expect(() => renderQuery(node)).toThrow(
			expect.objectContaining({
				code: "foreign-column-ref",
				message: expect.stringContaining("join that CTE"),
			}),
		);
	});
});

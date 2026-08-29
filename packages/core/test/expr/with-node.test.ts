import { describe, expect, it } from "vitest";
import type { QueryNode, SelectNode } from "../../src/index";
import { renderQuery } from "../../src/index";

const ordersFrom: SelectNode["from"] = {
	schemaName: "app",
	tableName: "orders",
};

const recentOrders: SelectNode = {
	queryKind: "select",
	projection: { projectionKind: "constantOne" },
	from: ordersFrom,
	joins: [],
	where: null,
	groupBy: [],
	having: null,
	orderBy: [],
	limit: null,
	offset: null,
	distinct: null,
};

const topCustomers: SelectNode = {
	...recentOrders,
	from: { schemaName: "app", tableName: "customers" },
};

const body: SelectNode = {
	...recentOrders,
	from: { schemaName: "app", tableName: "reports" },
};

describe("WithNode rendering (task 1.1)", () => {
	it("renders a with list ahead of its body, comma-separated in declaration order", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
				{ name: "top_customers", query: topCustomers, materialized: null },
			],
			recursive: false,
			body,
		};
		expect(renderQuery(node)).toBe(
			'with "recent_orders" as (select 1 from "app"."orders"), "top_customers" as (select 1 from "app"."customers") select 1 from "app"."reports"',
		);
	});

	it("renders with recursive when the list is recursive", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
			],
			recursive: true,
			body,
		};
		expect(renderQuery(node)).toBe(
			'with recursive "recent_orders" as (select 1 from "app"."orders") select 1 from "app"."reports"',
		);
	});

	it("renders as materialized when an entry is hinted true", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: true },
			],
			recursive: false,
			body,
		};
		expect(renderQuery(node)).toBe(
			'with "recent_orders" as materialized (select 1 from "app"."orders") select 1 from "app"."reports"',
		);
	});

	it("renders as not materialized when an entry is hinted false", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: false },
			],
			recursive: false,
			body,
		};
		expect(renderQuery(node)).toBe(
			'with "recent_orders" as not materialized (select 1 from "app"."orders") select 1 from "app"."reports"',
		);
	});

	it("renders no materialization token when an entry declares neither", () => {
		const node: QueryNode = {
			queryKind: "with",
			ctes: [
				{ name: "recent_orders", query: recentOrders, materialized: null },
			],
			recursive: false,
			body,
		};
		expect(renderQuery(node)).toBe(
			'with "recent_orders" as (select 1 from "app"."orders") select 1 from "app"."reports"',
		);
	});
});

describe("FromNode rendering (task 1.2)", () => {
	it("a select whose from-source is a CTE reference renders the name unqualified", () => {
		const node: SelectNode = {
			queryKind: "select",
			projection: {
				projectionKind: "columns",
				columns: [
					{
						alias: "id",
						expr: {
							nodeKind: "columnRef",
							schemaName: null,
							tableName: "recent_orders",
							columnName: "id",
						},
					},
				],
			},
			from: { cteName: "recent_orders" },
			joins: [],
			where: null,
			groupBy: [],
			having: null,
			orderBy: [],
			limit: null,
			offset: null,
			distinct: null,
		};
		// task 1.3c: a CTE reference is only ever valid where some enclosing
		// WITH declares it visible -- renderWith is what supplies that in
		// practice; here it's simulated directly since this test isolates
		// rendering, not the WITH wiring (that's with-scope.test.ts's job).
		expect(renderQuery(node, [{ cteName: "recent_orders" }])).toBe(
			'select "recent_orders"."id" as "id" from "recent_orders"',
		);
	});
});

describe("Join to a CTE reference (task 1.2b)", () => {
	it("a select joins a CTE reference, resolving the join condition against both sources", () => {
		const node: SelectNode = {
			queryKind: "select",
			projection: {
				projectionKind: "columns",
				columns: [
					{
						alias: "id",
						expr: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "orders",
							columnName: "id",
						},
					},
				],
			},
			from: { schemaName: "app", tableName: "orders" },
			joins: [
				{
					joinKind: "inner",
					table: { cteName: "ranked" },
					on: {
						nodeKind: "comparison",
						operator: "=",
						left: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "orders",
							columnName: "id",
						},
						right: {
							nodeKind: "columnRef",
							schemaName: null,
							tableName: "ranked",
							columnName: "order_id",
						},
					},
				},
			],
			where: null,
			groupBy: [],
			having: null,
			orderBy: [],
			limit: null,
			offset: null,
			distinct: null,
		};
		// task 1.3c: simulated visibility, same reasoning as the 1.2 test above.
		expect(renderQuery(node, [{ cteName: "ranked" }])).toBe(
			'select "app"."orders"."id" as "id" from "app"."orders" inner join "ranked" on "app"."orders"."id" = "ranked"."order_id"',
		);
	});
});

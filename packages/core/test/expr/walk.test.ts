import { describe, expect, it } from "vitest";
import type { ExprNode } from "../../src/expr/ast";
import { someDeepExprNode, someExprNode } from "../../src/expr/walk";

const rawSqlCall = (sql: string): ExprNode => ({ nodeKind: "rawSql", sql });

const existsOverWhere = (inner: ExprNode): ExprNode => ({
	nodeKind: "exists",
	negated: false,
	query: {
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: { schemaName: "app", tableName: "profiles" },
		joins: [],
		where: inner,
		orderBy: [],
		limit: null,
	},
});

const existsOverJoin = (inner: ExprNode): ExprNode => ({
	nodeKind: "exists",
	negated: false,
	query: {
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: { schemaName: "app", tableName: "attachments" },
		joins: [
			{
				joinKind: "inner",
				table: { schemaName: "app", tableName: "profiles" },
				on: inner,
			},
		],
		where: null,
		orderBy: [],
		limit: null,
	},
});

const existsOverOrderBy = (inner: ExprNode): ExprNode => ({
	nodeKind: "exists",
	negated: false,
	query: {
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: { schemaName: "app", tableName: "profiles" },
		joins: [],
		where: null,
		orderBy: [{ expr: inner, direction: "asc" }],
		limit: null,
	},
});

const isMarker = (node: ExprNode): boolean =>
	node.nodeKind === "rawSql" && node.sql === "marker";

describe("someDeepExprNode (#141: exists()-descending sibling of someExprNode)", () => {
	it("finds a match at the root", () => {
		expect(someDeepExprNode(rawSqlCall("marker"), isMarker)).toBe(true);
	});

	it("finds a match nested through comparison/logical, same as someExprNode already does", () => {
		const node: ExprNode = {
			nodeKind: "logical",
			operator: "and",
			operands: [
				{
					nodeKind: "comparison",
					operator: "=",
					left: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "t",
						columnName: "c",
					},
					right: rawSqlCall("marker"),
				},
			],
		};
		expect(someDeepExprNode(node, isMarker)).toBe(true);
		expect(someExprNode(node, isMarker)).toBe(true);
	});

	it("returns false when nothing matches", () => {
		const node: ExprNode = {
			nodeKind: "comparison",
			operator: "=",
			left: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "t",
				columnName: "c",
			},
			right: rawSqlCall("not the marker"),
		};
		expect(someDeepExprNode(node, isMarker)).toBe(false);
	});

	// The whole point of this function: someExprNode treats exists() as
	// opaque and misses a match inside its subquery; someDeepExprNode
	// descends and finds it. Same input, both functions, different
	// answers -- proves the deep walker actually walks deeper, not just
	// that it exists.
	it("finds a match inside exists()'s where clause, where someExprNode does not", () => {
		const node = existsOverWhere(rawSqlCall("marker"));
		expect(someExprNode(node, isMarker)).toBe(false);
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match inside exists()'s join condition", () => {
		const node = existsOverJoin(rawSqlCall("marker"));
		expect(someExprNode(node, isMarker)).toBe(false);
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match inside exists()'s orderBy term", () => {
		const node = existsOverOrderBy(rawSqlCall("marker"));
		expect(someExprNode(node, isMarker)).toBe(false);
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match inside a nested exists() (exists within exists)", () => {
		const node = existsOverWhere(existsOverWhere(rawSqlCall("marker")));
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("still lets a predicate match the exists node itself, same as someExprNode", () => {
		const isExists = (node: ExprNode): boolean => node.nodeKind === "exists";
		const node = existsOverWhere(rawSqlCall("irrelevant"));
		expect(someDeepExprNode(node, isExists)).toBe(true);
		expect(someExprNode(node, isExists)).toBe(true);
	});

	// The remaining ExprNode kinds each get their own case so every branch
	// of someDeepExprNodeHandlers is exercised, not just the ones the
	// exists()-descent tests above already touch (comparison, logical).
	const columnRef: ExprNode = {
		nodeKind: "columnRef",
		schemaName: "app",
		tableName: "t",
		columnName: "c",
	};

	it("finds a match through not", () => {
		const node: ExprNode = { nodeKind: "not", operand: rawSqlCall("marker") };
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match through nullTest", () => {
		const node: ExprNode = {
			nodeKind: "nullTest",
			negated: false,
			operand: rawSqlCall("marker"),
		};
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match through inList", () => {
		const node: ExprNode = {
			nodeKind: "inList",
			negated: false,
			operand: columnRef,
			values: [rawSqlCall("marker")],
		};
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match through between", () => {
		const node: ExprNode = {
			nodeKind: "between",
			negated: false,
			operand: columnRef,
			lowerBound: columnRef,
			upperBound: rawSqlCall("marker"),
		};
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match through functionCall", () => {
		const node: ExprNode = {
			nodeKind: "functionCall",
			schemaName: null,
			functionName: "coalesce",
			args: [columnRef, rawSqlCall("marker")],
		};
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match through sqlTemplate", () => {
		const node: ExprNode = {
			nodeKind: "sqlTemplate",
			chunks: [
				{ chunkKind: "text", text: "1 = 1 and " },
				{ chunkKind: "expr", expr: rawSqlCall("marker") },
			],
		};
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});
});

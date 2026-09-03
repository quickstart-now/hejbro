import { describe, expect, it } from "vitest";
import type { ExprNode, FunctionCallNode } from "../../src/expr/ast";
import {
	exprChildren,
	replaceExprChildren,
} from "../../src/expr/expr-children";
import {
	findExprScopeViolation,
	someDeepExprNode,
	someExprNode,
} from "../../src/expr/walk";
import { buildUnrelatedCase, REACHABLE_NODE_KINDS } from "./reachable-kinds";

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
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
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
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
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
		groupBy: [],
		having: null,
		orderBy: [{ expr: inner, direction: "asc" }],
		limit: null,
		offset: null,
		distinct: null,
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

	// #444 F5a: existsChildExprs/selectExprChildExprs used to hand-list
	// where/joins.on/orderBy only, missing the two fields #443 added.
	it("descends into an exists() subquery's having and groupBy", () => {
		const existsOverGroupBy = (inner: ExprNode): ExprNode => ({
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constantOne" },
				from: { schemaName: "app", tableName: "profiles" },
				joins: [],
				where: null,
				groupBy: [inner],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		});
		const existsOverHaving = (inner: ExprNode): ExprNode => ({
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constantOne" },
				from: { schemaName: "app", tableName: "profiles" },
				joins: [],
				where: null,
				groupBy: [],
				having: inner,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		});
		expect(
			someDeepExprNode(existsOverGroupBy(rawSqlCall("marker")), isMarker),
		).toBe(true);
		expect(
			someDeepExprNode(existsOverHaving(rawSqlCall("marker")), isMarker),
		).toBe(true);
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

	// add-window-functions task 1.7: someDeepExprNodeHandlers.window has no
	// in-core consumer (it's exported purely for @hejbro/supabase's own
	// validators, whose exercise of it doesn't count toward THIS package's
	// own coverage/CRAP score, measured per package) -- a direct test of
	// each of its three branches, same convention as functionCall/
	// sqlTemplate above. `rls-cached-auth-outside-rls.test.ts`'s own new
	// case proves the real consumer path; this proves the branch itself.
	const buildWindow = (fields: {
		readonly fn?: FunctionCallNode;
		readonly partitionBy?: ReadonlyArray<ExprNode>;
		readonly orderBy?: ReadonlyArray<ExprNode>;
	}): ExprNode => ({
		nodeKind: "window",
		fn: fields.fn ?? {
			nodeKind: "functionCall",
			schemaName: null,
			functionName: "rank",
			args: [],
		},
		partitionBy: fields.partitionBy ?? [],
		orderBy: (fields.orderBy ?? []).map((expr) => ({ expr, direction: "asc" })),
	});

	it("finds a match through a window function's own fn argument", () => {
		const node = buildWindow({
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "coalesce",
				args: [rawSqlCall("marker")],
			},
		});
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match through a window function's partitionBy", () => {
		const node = buildWindow({ partitionBy: [rawSqlCall("marker")] });
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("finds a match through a window function's orderBy", () => {
		const node = buildWindow({ orderBy: [rawSqlCall("marker")] });
		expect(someDeepExprNode(node, isMarker)).toBe(true);
	});

	it("returns false when a window function matches nothing", () => {
		const node = buildWindow({ partitionBy: [columnRef] });
		expect(someDeepExprNode(node, isMarker)).toBe(false);
	});
});

/**
 * #473 2.2: someExprNode/someDeepExprNode no longer restate child
 * positions themselves — both fold onto expr-children.ts's registry.
 * This proves that fold mechanically rather than by a hand-picked case
 * per kind: for every reachable node kind, a marker is planted at EACH
 * position `exprChildren` reports (via `replaceExprChildren`, never by
 * re-deriving the position by hand), and both walkers must find it.
 * Before the fold, this would have needed one hand-written case per
 * table per kind to give the same coverage — exactly the duplication
 * #473 is about. `exists`/`selectExpr` report zero positions here on
 * purpose (their `query` is a `SelectNode`, not a child `ExprNode`) and
 * are covered separately above, through their own subquery-descent path.
 */
describe("both walkers see every position expr-children.ts's registry reports (#473 2.2)", () => {
	const registryMarker: ExprNode = { nodeKind: "rawSql", sql: "marker" };
	const isRegistryMarker = (node: ExprNode): boolean =>
		node.nodeKind === "rawSql" && node.sql === "marker";

	REACHABLE_NODE_KINDS.forEach((kind) => {
		const node = buildUnrelatedCase(kind);
		const children = exprChildren(node);

		children.forEach((_child, position) => {
			it(`${kind}: a marker at child position ${position} is found by both someExprNode and someDeepExprNode`, () => {
				const childAt = (index: number, original: ExprNode): ExprNode => {
					if (index === position) {
						return registryMarker;
					}
					return original;
				};
				const withMarker = replaceExprChildren(
					node,
					children.map((child, index) => childAt(index, child)),
				);
				expect(someExprNode(withMarker, isRegistryMarker)).toBe(true);
				expect(someDeepExprNode(withMarker, isRegistryMarker)).toBe(true);
			});
		});
	});
});

describe("findExprScopeViolation reaches a CTE-sourced exists() (add-ctes task 2.2)", () => {
	it("a walk reaches an expression inside a CTE body -- a column of an exists()'s own CTE from-source is in scope", () => {
		const node: ExprNode = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constantOne" },
				from: { cteName: "ranked" },
				joins: [],
				where: {
					nodeKind: "columnRef",
					schemaName: null,
					tableName: "ranked",
					columnName: "id",
				},
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		};
		expect(findExprScopeViolation(node, [])).toBeUndefined();
	});

	it("a column naming a different CTE than the exists()'s own from-source is a violation", () => {
		const node: ExprNode = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constantOne" },
				from: { cteName: "ranked" },
				joins: [],
				where: {
					nodeKind: "columnRef",
					schemaName: null,
					tableName: "other_cte",
					columnName: "id",
				},
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		};
		const violation = findExprScopeViolation(node, []);
		expect(violation?.tableName).toBe("other_cte");
	});

	it("a join to a CTE inside exists() extends scope the same way a table join does", () => {
		const node: ExprNode = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constantOne" },
				from: { schemaName: "app", tableName: "profiles" },
				joins: [
					{
						joinKind: "inner",
						table: { cteName: "ranked" },
						on: {
							nodeKind: "columnRef",
							schemaName: null,
							tableName: "ranked",
							columnName: "id",
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
			},
		};
		expect(findExprScopeViolation(node, [])).toBeUndefined();
	});
});

import type {
	AggregateFilterNode,
	BetweenNode,
	ColumnRefNode,
	ComparisonNode,
	ExistsNode,
	ExprNode,
	FunctionCallNode,
	InListNode,
	LiteralNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	PlpgsqlRefNode,
	RawSqlNode,
	SelectExprNode,
	SelectNode,
	SqlTemplateNode,
	WindowNode,
} from "@hejbro/core";
import { renderExpr } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { liftExprNode } from "../../src/compile/params";

const literal = (value: number): LiteralNode => ({
	nodeKind: "literal",
	literal: { literalKind: "number", value },
});

const innerSelect = (where: ExprNode): SelectNode => ({
	queryKind: "select",
	projection: { projectionKind: "constantOne" },
	from: { schemaName: "app", tableName: "orders" },
	joins: [],
	where,
	groupBy: [],
	having: null,
	orderBy: [],
	limit: null,
	offset: null,
	distinct: null,
});

type Row = {
	readonly kind: ExprNode["nodeKind"];
	readonly label: string;
	readonly node: ExprNode;
	readonly expectedSql: string;
	readonly expectedParams: ReadonlyArray<unknown>;
};

/**
 * One row per {@link ExprNode} kind the registry knows, plus five extra
 * rows (#515, tasks.md 1.2): expected SQL and parameter order are
 * hand-derived from each kind's own render order, then confirmed against
 * the pre-fold `liftExprNode`/`renderExpr` (commit 31689711, before
 * `expr-children.ts`'s registry replaces this file's own per-kind handler
 * table) and pinned as literals -- running this same table again after
 * the fold must stay byte-identical, which is the proof no child
 * position was lost. `literal` and `exists`/`selectExpr` keep their own
 * branch after the fold by design (515/R3 F): a literal node becomes the
 * `$n` placeholder itself rather than a node with children to walk, and
 * `exists`/`selectExpr`'s `query` is a `SelectNode`, not an `ExprNode`, so
 * `exprChildren` never reports it as a child. The four `negated: true`
 * rows pin that rebuilding a node preserves its non-`ExprNode` parts
 * (the flag itself), and the nested row pins that `$n` numbering threads
 * left to right across nested composite children, not just direct ones.
 */
const ROWS: ReadonlyArray<Row> = [
	{
		kind: "literal",
		label: "literal",
		node: literal(11),
		expectedSql: "$1",
		expectedParams: [11],
	},
	{
		kind: "rawSql",
		label: "rawSql",
		node: { nodeKind: "rawSql", sql: "now()" } satisfies RawSqlNode,
		expectedSql: "now()",
		expectedParams: [],
	},
	{
		kind: "plpgsqlRef",
		label: "plpgsqlRef",
		node: {
			nodeKind: "plpgsqlRef",
			path: ["new", "status"],
		} satisfies PlpgsqlRefNode,
		expectedSql: "new.status",
		expectedParams: [],
	},
	{
		kind: "columnRef",
		label: "columnRef",
		node: {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "orders",
			columnName: "amount",
		} satisfies ColumnRefNode,
		expectedSql: '"app"."orders"."amount"',
		expectedParams: [],
	},
	{
		kind: "comparison",
		label: "comparison",
		node: {
			nodeKind: "comparison",
			operator: "=",
			left: literal(21),
			right: literal(22),
		} satisfies ComparisonNode,
		expectedSql: "$1 = $2",
		expectedParams: [21, 22],
	},
	{
		kind: "logical",
		label: "logical",
		node: {
			nodeKind: "logical",
			operator: "and",
			operands: [literal(31), literal(32), literal(33)],
		} satisfies LogicalNode,
		expectedSql: "$1 and $2 and $3",
		expectedParams: [31, 32, 33],
	},
	{
		kind: "not",
		label: "not",
		node: { nodeKind: "not", operand: literal(41) } satisfies NotNode,
		expectedSql: "not $1",
		expectedParams: [41],
	},
	{
		kind: "nullTest",
		label: "nullTest",
		node: {
			nodeKind: "nullTest",
			negated: false,
			operand: literal(51),
		} satisfies NullTestNode,
		expectedSql: "$1 is null",
		expectedParams: [51],
	},
	{
		kind: "inList",
		label: "inList",
		node: {
			nodeKind: "inList",
			negated: false,
			operand: literal(61),
			values: [literal(62), literal(63)],
		} satisfies InListNode,
		expectedSql: "$1 in ($2, $3)",
		expectedParams: [61, 62, 63],
	},
	{
		kind: "between",
		label: "between",
		node: {
			nodeKind: "between",
			negated: false,
			operand: literal(71),
			lowerBound: literal(72),
			upperBound: literal(73),
		} satisfies BetweenNode,
		expectedSql: "$1 between $2 and $3",
		expectedParams: [71, 72, 73],
	},
	{
		kind: "functionCall",
		label: "functionCall",
		node: {
			nodeKind: "functionCall",
			schemaName: null,
			functionName: "coalesce",
			args: [literal(81), literal(82)],
		} satisfies FunctionCallNode,
		expectedSql: "coalesce($1, $2)",
		expectedParams: [81, 82],
	},
	{
		kind: "sqlTemplate",
		label: "sqlTemplate",
		node: {
			nodeKind: "sqlTemplate",
			chunks: [
				{ chunkKind: "text", text: "prefix " },
				{ chunkKind: "expr", expr: literal(91) },
				{ chunkKind: "text", text: " mid " },
				{ chunkKind: "expr", expr: literal(92) },
			],
		} satisfies SqlTemplateNode,
		expectedSql: "prefix $1 mid $2",
		expectedParams: [91, 92],
	},
	{
		kind: "exists",
		label: "exists",
		node: {
			nodeKind: "exists",
			negated: false,
			query: innerSelect(literal(101)),
		} satisfies ExistsNode,
		expectedSql: 'exists (select 1 from "app"."orders" where $1)',
		expectedParams: [101],
	},
	{
		kind: "selectExpr",
		label: "selectExpr",
		node: {
			nodeKind: "selectExpr",
			mode: "jsonObject",
			query: innerSelect(literal(111)),
		} satisfies SelectExprNode,
		expectedSql:
			'(select row_to_json("agg") from (select 1 from "app"."orders" where $1) as "agg")',
		expectedParams: [111],
	},
	{
		kind: "window",
		label: "window",
		node: {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "sum",
				args: [literal(121)],
			},
			partitionBy: [literal(122)],
			orderBy: [{ expr: literal(123), direction: "asc" }],
		} satisfies WindowNode,
		expectedSql: "sum($1) over (partition by $2 order by $3 asc)",
		expectedParams: [121, 122, 123],
	},
	{
		kind: "aggregateFilter",
		label: "aggregateFilter",
		node: {
			nodeKind: "aggregateFilter",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "sum",
				args: [literal(131)],
			},
			where: literal(132),
		} satisfies AggregateFilterNode,
		expectedSql: "sum($1) filter (where $2)",
		expectedParams: [131, 132],
	},
	// `negated: true` rows: rebuilding a node through replaceExprChildren
	// must preserve the non-ExprNode `negated` flag it never touches.
	{
		kind: "nullTest",
		label: "nullTest negated",
		node: {
			nodeKind: "nullTest",
			negated: true,
			operand: literal(141),
		} satisfies NullTestNode,
		expectedSql: "$1 is not null",
		expectedParams: [141],
	},
	{
		kind: "inList",
		label: "inList negated",
		node: {
			nodeKind: "inList",
			negated: true,
			operand: literal(151),
			values: [literal(152), literal(153)],
		} satisfies InListNode,
		expectedSql: "$1 not in ($2, $3)",
		expectedParams: [151, 152, 153],
	},
	{
		kind: "between",
		label: "between negated",
		node: {
			nodeKind: "between",
			negated: true,
			operand: literal(161),
			lowerBound: literal(162),
			upperBound: literal(163),
		} satisfies BetweenNode,
		expectedSql: "$1 not between $2 and $3",
		expectedParams: [161, 162, 163],
	},
	{
		kind: "exists",
		label: "exists negated",
		node: {
			nodeKind: "exists",
			negated: true,
			query: innerSelect(literal(171)),
		} satisfies ExistsNode,
		expectedSql: 'not exists (select 1 from "app"."orders" where $1)',
		expectedParams: [171],
	},
	// Nested row: `$n` numbering threads left to right across a composite
	// operand's own children, not just across direct children -- and each
	// composite operand (comparison, between) parenthesizes itself inside
	// the enclosing `and`, exactly as `renderOperand` already does for a
	// top-level `not`/`logical` wrapping a `comparison` (render-sql.ts's
	// `compositeNodeKinds`); `window` is not itself in that set, so it
	// renders unwrapped.
	{
		kind: "logical",
		label: "logical nested (comparison, between, window as operands)",
		node: {
			nodeKind: "logical",
			operator: "and",
			operands: [
				{
					nodeKind: "comparison",
					operator: "=",
					left: literal(201),
					right: literal(202),
				},
				{
					nodeKind: "between",
					negated: false,
					operand: literal(203),
					lowerBound: literal(204),
					upperBound: literal(205),
				},
				{
					nodeKind: "window",
					fn: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName: "sum",
						args: [literal(206)],
					},
					partitionBy: [literal(207)],
					orderBy: [{ expr: literal(208), direction: "asc" }],
				},
			],
		} satisfies LogicalNode,
		expectedSql:
			"($1 = $2) and ($3 between $4 and $5) and sum($6) over (partition by $7 order by $8 asc)",
		expectedParams: [201, 202, 203, 204, 205, 206, 207, 208],
	},
];

describe("liftExprNode: one row per ExprNode kind, pinned pre-fold (#515)", () => {
	it("covers all 16 kinds the registry knows, at least once each", () => {
		const kinds = new Set(ROWS.map((row) => row.kind));
		expect(kinds.size).toBe(16);
	});

	ROWS.forEach((row) => {
		it(`${row.label}: lifts to the expected SQL and parameter order`, () => {
			const lifted = liftExprNode(row.node, 1);
			expect(renderExpr(lifted.node)).toBe(row.expectedSql);
			expect(lifted.params).toEqual(row.expectedParams);
		});
	});
});

import { describe, expect, it } from "vitest";
import { assertNever } from "../../src/error";
import type { ExprNode } from "../../src/expr/ast";
import type { RenameTarget } from "../../src/expr/retarget";
import { retargetExprNode } from "../../src/expr/retarget";
import { REACHABLE_NODE_KINDS } from "./reachable-kinds";

const tableRenameTarget: RenameTarget = {
	oldSchema: "app",
	oldTable: "posts",
	newSchema: "app",
	newTable: "articles",
	oldColumn: null,
	newColumn: null,
};

const columnRenameTarget: RenameTarget = {
	oldSchema: "app",
	oldTable: "posts",
	newSchema: "app",
	newTable: "posts",
	oldColumn: "title",
	newColumn: "headline",
};

describe("retargetExprNode (#110 item 7/18: rename retargeting)", () => {
	it("retargets a direct columnRef on a table rename", () => {
		const node: ExprNode = {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "id",
		};
		expect(retargetExprNode(node, tableRenameTarget)).toEqual({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "articles",
			columnName: "id",
		});
	});

	it("retargets only the matching column on a column rename, leaving other columns alone", () => {
		const node: ExprNode = {
			nodeKind: "comparison",
			operator: "=",
			left: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "title",
			},
			right: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "subtitle",
			},
		};
		expect(retargetExprNode(node, columnRenameTarget)).toEqual({
			nodeKind: "comparison",
			operator: "=",
			left: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "headline",
			},
			right: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "subtitle",
			},
		});
	});

	it("leaves an unrelated table's columnRef untouched", () => {
		const node: ExprNode = {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "comments",
			columnName: "id",
		};
		expect(retargetExprNode(node, tableRenameTarget)).toBe(node);
	});

	// #110 item 23/24, reviewer round 2/3: on a COLUMN rename
	// (oldSchema===newSchema, oldTable===newTable), EVERY reference-bearing
	// node kind that mentions the same table but is otherwise unaffected
	// must come back as the exact SAME reference -- schema/table matching
	// the rename target is not enough on its own to mean "this node
	// changed" (a table rename always changes schema/table, so reaching a
	// match branch there always means something changed; a column rename
	// does not have that property).
	//
	// This was fixed twice, for two DIFFERENT node kinds, because the
	// first test (a bare `columnRef` case) only exercised
	// `retargetExprNode`'s own `columnRef` branch and never
	// `retargetTableRef` -- a structurally different function, reached
	// only through `exists()`'s `from`/`join`, with its own separate (and
	// separately buggy) copy of the same comparison. Round 2's fix
	// ("add one more case for the gap that was just found") was *itself*
	// the same narrow-test pattern that caused the miss in the first
	// place, one level up -- adding cases one at a time as gaps are found
	// doesn't make the next gap visible.
	//
	// This is why the loop below iterates `REACHABLE_NODE_KINDS`
	// (`reachable-kinds.ts`) rather than a hand-picked list living only in
	// this file: it's the SAME array the D70 completeness test in
	// `naming-conventions.test.ts` iterates (#110 item 72) -- a future
	// `ExprNode` kind added to the codec's map lands in both tests'
	// coverage automatically, or requires an explicit, reasoned exclusion
	// visible in one shared place, not a silent gap in whichever test
	// nobody happened to update.
	//
	// `buildUnrelatedCase` is an exhaustive switch over the full
	// `ExprNode["nodeKind"]` union (compiler-enforced via `assertNever`),
	// so a new node kind fails to compile here until it's given a case --
	// every builder below constructs a minimal, valid node of that kind
	// that does NOT reference `columnRenameTarget`'s column anywhere in
	// its subtree (some wrap `unrelatedColumnRef`, a column on the same
	// table but a different column, to also exercise composite nodes'
	// own identity-preservation branches, not just their leaves).
	// `exists` alone covers BOTH `retargetTableRef` call sites at once
	// (`query.from` and `join.table`), matching the same table as the
	// rename target on both, since that's precisely the shape that was
	// broken.
	const unrelatedColumnRef: ExprNode = {
		nodeKind: "columnRef",
		schemaName: "app",
		tableName: "posts",
		columnName: "subtitle",
	};
	const unrelatedLiteral: ExprNode = {
		nodeKind: "literal",
		literal: { literalKind: "number", value: 1 },
	};

	const buildUnrelatedCase = (kind: ExprNode["nodeKind"]): ExprNode => {
		switch (kind) {
			case "literal":
				return unrelatedLiteral;
			case "columnRef":
				return unrelatedColumnRef;
			case "plpgsqlRef":
				return { nodeKind: "plpgsqlRef", path: ["new", "x"] };
			case "comparison":
				return {
					nodeKind: "comparison",
					operator: "=",
					left: unrelatedColumnRef,
					right: unrelatedLiteral,
				};
			case "logical":
				return {
					nodeKind: "logical",
					operator: "and",
					operands: [unrelatedColumnRef, unrelatedLiteral],
				};
			case "not":
				return { nodeKind: "not", operand: unrelatedColumnRef };
			case "nullTest":
				return {
					nodeKind: "nullTest",
					negated: false,
					operand: unrelatedColumnRef,
				};
			case "inList":
				return {
					nodeKind: "inList",
					negated: false,
					operand: unrelatedColumnRef,
					values: [unrelatedLiteral],
				};
			case "between":
				return {
					nodeKind: "between",
					negated: false,
					operand: unrelatedColumnRef,
					lowerBound: unrelatedLiteral,
					upperBound: unrelatedLiteral,
				};
			case "functionCall":
				return {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "lower",
					args: [unrelatedColumnRef],
				};
			case "sqlTemplate":
				return {
					nodeKind: "sqlTemplate",
					chunks: [
						{ chunkKind: "text", text: "(" },
						{ chunkKind: "expr", expr: unrelatedColumnRef },
						{ chunkKind: "text", text: ")" },
					],
				};
			case "rawSql":
				return { nodeKind: "rawSql", sql: "true" };
			case "exists":
				return {
					nodeKind: "exists",
					negated: false,
					query: {
						queryKind: "select",
						projection: { projectionKind: "constantOne" },
						from: { schemaName: "app", tableName: "posts" },
						joins: [
							{
								joinKind: "inner",
								table: { schemaName: "app", tableName: "posts" },
								on: unrelatedLiteral,
							},
						],
						where: null,
						orderBy: [],
						limit: null,
					},
				};
			default:
				return assertNever(kind);
		}
	};

	it.each(
		REACHABLE_NODE_KINDS.map(
			(kind) => [kind, buildUnrelatedCase(kind)] as const,
		),
	)(
		"returns the exact same reference on an unrelated column rename: %s",
		(_kind, node) => {
			expect(retargetExprNode(node, columnRenameTarget)).toBe(node);
		},
	);

	it("retargets a columnRef nested arbitrarily deep (logical/not/inList/between/functionCall/sqlTemplate)", () => {
		const ref: ExprNode = {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "status",
		};
		const node: ExprNode = {
			nodeKind: "logical",
			operator: "and",
			operands: [
				{ nodeKind: "not", operand: { ...ref } },
				{
					nodeKind: "inList",
					negated: false,
					operand: { ...ref },
					values: [
						{
							nodeKind: "literal",
							literal: { literalKind: "string", value: "x" },
						},
					],
				},
				{
					nodeKind: "between",
					negated: false,
					operand: { ...ref },
					lowerBound: {
						nodeKind: "literal",
						literal: { literalKind: "number", value: 0 },
					},
					upperBound: {
						nodeKind: "literal",
						literal: { literalKind: "number", value: 1 },
					},
				},
				{
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "lower",
					args: [{ ...ref }],
				},
				{
					nodeKind: "sqlTemplate",
					chunks: [
						{ chunkKind: "text", text: "(" },
						{ chunkKind: "expr", expr: { ...ref } },
						{ chunkKind: "text", text: ")" },
					],
				},
			],
		};
		const retargeted = retargetExprNode(node, tableRenameTarget);
		// every columnRef nested inside not/inList/between/functionCall/
		// sqlTemplate followed the rename -- no "posts" survives anywhere
		// in the tree, and "articles" appears once per nested ref (5).
		const serialized = JSON.stringify(retargeted);
		expect(serialized).not.toContain('"posts"');
		expect(serialized.match(/"articles"/g)).toHaveLength(5);
	});

	it("retargets a columnRef inside an exists() subquery's where/join/orderBy, and the subquery's own from/join table refs", () => {
		const node: ExprNode = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constantOne" },
				from: { schemaName: "app", tableName: "posts" },
				joins: [
					{
						joinKind: "inner",
						table: { schemaName: "app", tableName: "authors" },
						on: {
							nodeKind: "comparison",
							operator: "=",
							left: {
								nodeKind: "columnRef",
								schemaName: "app",
								tableName: "posts",
								columnName: "author_id",
							},
							right: {
								nodeKind: "columnRef",
								schemaName: "app",
								tableName: "authors",
								columnName: "id",
							},
						},
					},
				],
				where: {
					nodeKind: "comparison",
					operator: "=",
					left: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "posts",
						columnName: "id",
					},
					right: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "comments",
						columnName: "post_id",
					},
				},
				orderBy: [
					{
						expr: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "posts",
							columnName: "created_at",
						},
						direction: "desc",
					},
				],
				limit: 1,
			},
		};
		const retargeted = retargetExprNode(node, tableRenameTarget);
		const serialized = JSON.stringify(retargeted);
		// every "posts" reference became "articles" -- the from ref, the
		// join's on-clause left side, the where clause, and the orderBy term
		expect(serialized).not.toContain('"posts"');
		// unrelated tables (authors, comments) are untouched
		expect(serialized).toContain('"authors"');
		expect(serialized).toContain('"comments"');
	});

	it("returns the exact same reference when nothing matches (cheap no-op check)", () => {
		const node: ExprNode = {
			nodeKind: "literal",
			literal: { literalKind: "boolean", value: true },
		};
		expect(retargetExprNode(node, tableRenameTarget)).toBe(node);
	});
});

import { describe, expect, it } from "vitest";
import type { ExprNode } from "../../src/expr/ast";
import type { RenameTarget } from "../../src/expr/retarget";
import { retargetExprNode } from "../../src/expr/retarget";

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

import { describe, expect, it } from "vitest";
import type { ExprNode } from "../../src/expr/ast";
import { decodeExprNode, encodeExprNode } from "../../src/expr/codec";

// #110: encode (ExprNode -> snapshot form) and decode (snapshot form ->
// ExprNode) must round-trip losslessly in both directions -- this is what
// lets rename-plan.ts decode a stored node, retarget identifiers, and
// re-encode it (D67), and what lets emit re-render a stored node back to
// SQL via the existing renderExpr (untouched by this codec).
describe("expr codec — round-trip", () => {
	const cases: ReadonlyArray<readonly [string, ExprNode]> = [
		[
			"literal (string)",
			{ nodeKind: "literal", literal: { literalKind: "string", value: "hi" } },
		],
		[
			"literal (number)",
			{ nodeKind: "literal", literal: { literalKind: "number", value: 42 } },
		],
		[
			"literal (boolean)",
			{
				nodeKind: "literal",
				literal: { literalKind: "boolean", value: false },
			},
		],
		[
			"literal (null)",
			{ nodeKind: "literal", literal: { literalKind: "null" } },
		],
		[
			"literal (timestamp)",
			{
				nodeKind: "literal",
				literal: {
					literalKind: "timestamp",
					isoValue: "2026-08-21T00:00:00.000Z",
				},
			},
		],
		[
			"columnRef",
			{
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "id",
			},
		],
		["plpgsqlRef", { nodeKind: "plpgsqlRef", path: ["new", "post_id"] }],
		[
			"comparison (SQL-token operator with a space, untouched)",
			{
				nodeKind: "comparison",
				operator: "not like",
				left: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "title",
				},
				right: {
					nodeKind: "literal",
					literal: { literalKind: "string", value: "draft%" },
				},
			},
		],
		[
			"logical",
			{
				nodeKind: "logical",
				operator: "and",
				operands: [
					{
						nodeKind: "literal",
						literal: { literalKind: "boolean", value: true },
					},
					{
						nodeKind: "literal",
						literal: { literalKind: "boolean", value: false },
					},
				],
			},
		],
		[
			"not",
			{
				nodeKind: "not",
				operand: {
					nodeKind: "literal",
					literal: { literalKind: "boolean", value: true },
				},
			},
		],
		[
			"nullTest",
			{
				nodeKind: "nullTest",
				negated: true,
				operand: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "published_at",
				},
			},
		],
		[
			"inList",
			{
				nodeKind: "inList",
				negated: false,
				operand: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "status",
				},
				values: [
					{
						nodeKind: "literal",
						literal: { literalKind: "string", value: "draft" },
					},
					{
						nodeKind: "literal",
						literal: { literalKind: "string", value: "published" },
					},
				],
			},
		],
		[
			"between",
			{
				nodeKind: "between",
				negated: false,
				operand: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "price",
				},
				lowerBound: {
					nodeKind: "literal",
					literal: { literalKind: "number", value: 0 },
				},
				upperBound: {
					nodeKind: "literal",
					literal: { literalKind: "number", value: 100 },
				},
			},
		],
		[
			"functionCall (schema-qualified)",
			{
				nodeKind: "functionCall",
				schemaName: "auth",
				functionName: "uid",
				args: [],
			},
		],
		[
			"functionCall (unqualified, null schema)",
			{
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "now",
				args: [],
			},
		],
		[
			"sqlTemplate",
			{
				nodeKind: "sqlTemplate",
				chunks: [
					{ chunkKind: "text", text: "lower(" },
					{
						chunkKind: "expr",
						expr: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "posts",
							columnName: "title",
						},
					},
					{ chunkKind: "text", text: ")" },
				],
			},
		],
		["rawSql", { nodeKind: "rawSql", sql: "now() at time zone 'utc'" }],
		[
			"exists (full SelectNode: allColumns projection, join, orderBy, limit)",
			{
				nodeKind: "exists",
				negated: false,
				query: {
					queryKind: "select",
					projection: {
						projectionKind: "allColumns",
						columnNames: ["id", "post_id"],
					},
					from: { schemaName: "app", tableName: "comments" },
					joins: [
						{
							joinKind: "inner",
							table: { schemaName: "app", tableName: "posts" },
							on: {
								nodeKind: "comparison",
								operator: "=",
								left: {
									nodeKind: "columnRef",
									schemaName: "app",
									tableName: "comments",
									columnName: "post_id",
								},
								right: {
									nodeKind: "columnRef",
									schemaName: "app",
									tableName: "posts",
									columnName: "id",
								},
							},
						},
					],
					where: {
						nodeKind: "nullTest",
						negated: true,
						operand: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "posts",
							columnName: "published_at",
						},
					},
					orderBy: [
						{
							expr: {
								nodeKind: "columnRef",
								schemaName: "app",
								tableName: "comments",
								columnName: "created_at",
							},
							direction: "desc",
						},
					],
					limit: 1,
				},
			},
		],
		[
			"exists (columns projection, constantOne, no joins/where/orderBy/limit)",
			{
				nodeKind: "exists",
				negated: true,
				query: {
					queryKind: "select",
					projection: { projectionKind: "constantOne" },
					from: { schemaName: "app", tableName: "comments" },
					joins: [],
					where: null,
					orderBy: [],
					limit: null,
				},
			},
		],
	];

	it.each(cases)("round-trips: %s", (_label, node) => {
		const encoded = encodeExprNode(node);
		const decoded = decodeExprNode(encoded);
		expect(decoded).toEqual(node);
		// re-encoding the decoded node must be byte-identical to the first
		// encoding -- proves the round trip is stable, not just "decodable".
		expect(encodeExprNode(decoded)).toEqual(encoded);
	});

	it("kebab-cases every discriminator value it introduces (spot check, full audit lives in naming-conventions.test.ts)", () => {
		const encoded = encodeExprNode({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "id",
		}) as { readonly nodeKind: string };
		expect(encoded.nodeKind).toBe("column-ref");
	});

	it("does not kebab-case SQL's own tokens (comparison operator, order-by direction)", () => {
		const encoded = encodeExprNode({
			nodeKind: "comparison",
			operator: "not like",
			left: { nodeKind: "rawSql", sql: "a" },
			right: { nodeKind: "rawSql", sql: "b" },
		}) as { readonly operator: string };
		expect(encoded.operator).toBe("not like");
	});
});

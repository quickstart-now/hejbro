import { describe, expect, it } from "vitest";
import type { ExprNode, SelectNode } from "../../src/index";
import { renderExpr, renderSelect } from "../../src/index";

const publishedAt: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "posts",
	columnName: "published_at",
};
const status: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "posts",
	columnName: "status",
};
const lit = (value: string): ExprNode => ({
	nodeKind: "literal",
	literal: { literalKind: "string", value },
});

describe("renderExpr", () => {
	it("renders column refs schema-qualified and quoted", () => {
		expect(renderExpr(publishedAt)).toBe('"app"."posts"."published_at"');
	});
	it("renders comparisons", () => {
		expect(
			renderExpr({
				nodeKind: "comparison",
				operator: "=",
				left: status,
				right: lit("published"),
			}),
		).toBe('"app"."posts"."status" = \'published\'');
	});
	it("parenthesizes nested logical operands deterministically", () => {
		const isPublished: ExprNode = {
			nodeKind: "comparison",
			operator: "=",
			left: status,
			right: lit("published"),
		};
		const notDeleted: ExprNode = {
			nodeKind: "nullTest",
			negated: false,
			operand: publishedAt,
		};
		expect(
			renderExpr({
				nodeKind: "logical",
				operator: "or",
				operands: [
					{
						nodeKind: "logical",
						operator: "and",
						operands: [isPublished, notDeleted],
					},
					isPublished,
				],
			}),
		).toBe(
			'(("app"."posts"."status" = \'published\') and ("app"."posts"."published_at" is null)) or ("app"."posts"."status" = \'published\')',
		);
	});
	it("renders null tests, in lists, between, not", () => {
		expect(
			renderExpr({ nodeKind: "nullTest", negated: true, operand: publishedAt }),
		).toBe('"app"."posts"."published_at" is not null');
		expect(
			renderExpr({
				nodeKind: "inList",
				negated: false,
				operand: status,
				values: [lit("a"), lit("b")],
			}),
		).toBe('"app"."posts"."status" in (\'a\', \'b\')');
	});
	it("renders function calls, schema-qualified when set", () => {
		expect(
			renderExpr({
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "now",
				args: [],
			}),
		).toBe("now()");
		expect(
			renderExpr({
				nodeKind: "functionCall",
				schemaName: "auth",
				functionName: "uid",
				args: [],
			}),
		).toBe("auth.uid()");
	});
	it("renders sql templates and raw sql verbatim where designed", () => {
		expect(
			renderExpr({
				nodeKind: "sqlTemplate",
				chunks: [
					{ chunkKind: "text", text: "char_length(" },
					{ chunkKind: "expr", expr: status },
					{ chunkKind: "text", text: ") > 3" },
				],
			}),
		).toBe('char_length("app"."posts"."status") > 3');
		expect(renderExpr({ nodeKind: "rawSql", sql: "1 = 1" })).toBe("1 = 1");
	});
});

// #444 F2: renderSelectClauses' own mentionedRefs list missed
// groupBy/having/distinct on -- a foreign reference there used to render
// wrong SQL instead of throwing.
describe("renderSelect scope checks (#444 F2)", () => {
	const outside: ExprNode = {
		nodeKind: "columnRef",
		schemaName: "app",
		tableName: "comments",
		columnName: "id",
	};
	const baseQuery: SelectNode = {
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: { schemaName: "app", tableName: "posts" },
		joins: [],
		where: null,
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	};

	it("throws foreign-column-ref for a groupBy reference outside scope", () => {
		expect(() =>
			renderSelect({ ...baseQuery, groupBy: [outside] }),
		).toThrowError(expect.objectContaining({ code: "foreign-column-ref" }));
	});

	it("throws foreign-column-ref for a having reference outside scope", () => {
		expect(() => renderSelect({ ...baseQuery, having: outside })).toThrowError(
			expect.objectContaining({ code: "foreign-column-ref" }),
		);
	});

	it("throws foreign-column-ref for a distinct on reference outside scope", () => {
		expect(() =>
			renderSelect({
				...baseQuery,
				distinct: { distinctKind: "on", columns: [outside] },
			}),
		).toThrowError(expect.objectContaining({ code: "foreign-column-ref" }));
	});
});

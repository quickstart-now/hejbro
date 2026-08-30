import { describe, expect, it } from "vitest";
import {
	exprChildren,
	replaceExprChildren,
} from "../../src/expr/expr-children";
import type { ExprNode, SelectNode, SetOpNode } from "../../src/index";
import {
	collectColumnRefs,
	renderExpr,
	renderSelect,
	renderSetOp,
} from "../../src/index";
import { buildUnrelatedCase, REACHABLE_NODE_KINDS } from "./reachable-kinds";

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

// group 5.2, harden-query-surface (#470): OrderByTerm.nulls reaches SQL
// text in the three positions group 1.4 measured `nulls first`/`nulls
// last` legal in on postgres:17 -- a plain select, a window clause, and
// a set-op whole-set order. This is the difference between "the field
// exists" (5.1) and "the field renders" (5.2); 5.4 (execution pending,
// 7.7's closing slot) is the difference between "the golden string
// matches" and "the server agrees".
describe("nulls placement renders in all three order-by positions (#470)", () => {
	const projectedQuery: SelectNode = {
		queryKind: "select",
		projection: {
			projectionKind: "columns",
			columns: [{ alias: "published_at", expr: publishedAt }],
		},
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

	it("renders order by x desc nulls last in a select", () => {
		const query: SelectNode = {
			...projectedQuery,
			orderBy: [{ expr: publishedAt, direction: "desc", nulls: "last" }],
		};
		expect(renderSelect(query)).toBe(
			'select "app"."posts"."published_at" as "published_at" from "app"."posts" order by "app"."posts"."published_at" desc nulls last',
		);
	});

	it("renders order by x desc nulls last in a window clause", () => {
		const windowNode: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "rank",
				args: [],
			},
			partitionBy: [],
			orderBy: [{ expr: publishedAt, direction: "desc", nulls: "last" }],
		};
		expect(renderExpr(windowNode)).toBe(
			'rank() over (order by "app"."posts"."published_at" desc nulls last)',
		);
	});

	it("renders order by x desc nulls last in a set-op whole-set order", () => {
		const combined: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: projectedQuery,
			right: projectedQuery,
			orderBy: [{ expr: publishedAt, direction: "desc", nulls: "last" }],
			limit: null,
			offset: null,
		};
		expect(renderSetOp(combined)).toContain(
			'order by "published_at" desc nulls last',
		);
	});
});

/**
 * #473 2.3: collectColumnRefs no longer restates ExprNode child positions
 * in its own handler table — it recurses through expr-children.ts's
 * registry, with `columnRef` as its one base case beyond the fold (a
 * column ref has no children; it *is* the thing being collected). This
 * proves the fold mechanically: for every reachable node kind, a distinct
 * columnRef is planted at each position `exprChildren` reports (via
 * `replaceExprChildren`, never a hand-derived position), and
 * `collectColumnRefs` must report it. `exists`/`selectExpr` report zero
 * positions here on purpose (their `query` is a `SelectNode`, out of this
 * registry's vocabulary) — collectColumnRefs stopping at a subquery
 * boundary is existing, unrelated behavior (a subquery validates its own
 * scope when rendered), not something this fold changes.
 */
describe("collectColumnRefs reaches every position expr-children.ts's registry reports (#473 2.3)", () => {
	REACHABLE_NODE_KINDS.forEach((kind) => {
		const node = buildUnrelatedCase(kind);
		const children = exprChildren(node);

		children.forEach((_child, position) => {
			it(`${kind}: a columnRef planted at child position ${position} is collected`, () => {
				const marker: ExprNode = {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "marker_table",
					columnName: "marker_column",
				};
				const childAt = (index: number, original: ExprNode): ExprNode => {
					if (index === position) {
						return marker;
					}
					return original;
				};
				const withMarker = replaceExprChildren(
					node,
					children.map((child, index) => childAt(index, child)),
				);
				expect(collectColumnRefs(withMarker)).toContainEqual(marker);
			});
		});
	});
});

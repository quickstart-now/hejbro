import { describe, expect, expectTypeOf, it } from "vitest";
import type { Expr } from "../../src/index";
import {
	and,
	between,
	columnRef,
	eq,
	inArray,
	isNotNull,
	like,
	ne,
	not,
	now,
	or,
	renderExpr,
} from "../../src/index";

const status = columnRef("ddland", "posts", "status", { typeName: "text" });
const publishedAt = columnRef("ddland", "posts", "published_at", {
	typeName: "timestamptz",
});
const postId = columnRef("ddland", "posts", "id", { typeName: "uuid" });

describe("operators", () => {
	it("builds comparisons with auto-lifted literals", () => {
		expect(renderExpr(eq(status, "published").exprNode)).toBe(
			'"ddland"."posts"."status" = \'published\'',
		);
	});
	it("composes boolean expressions", () => {
		const composed = or(
			and(eq(status, "published"), isNotNull(publishedAt)),
			not(ne(status, "draft")),
		);
		expect(renderExpr(composed.exprNode)).toContain(" or ");
		expectTypeOf(composed).toEqualTypeOf<Expr<"boolean">>();
	});
	it("builds inArray / between / like / now", () => {
		expect(renderExpr(inArray(status, ["a", "b"]).exprNode)).toBe(
			'"ddland"."posts"."status" in (\'a\', \'b\')',
		);
		expect(renderExpr(like(status, "post-%").exprNode)).toBe(
			'"ddland"."posts"."status" like \'post-%\'',
		);
		expect(renderExpr(now().exprNode)).toBe("now()");
		expect(renderExpr(between(publishedAt, now(), now()).exprNode)).toBe(
			'"ddland"."posts"."published_at" between now() and now()',
		);
	});
	it("rejects family mismatches at the type level", () => {
		// @ts-expect-error uuid column compared against a number
		eq(postId, 42);
		// @ts-expect-error boolean combinator fed a non-boolean expression
		and(status);
	});
});

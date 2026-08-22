import { describe, expect, it } from "vitest";
import { columnRef, renderExpr, sql } from "../../src/index";

const slug = columnRef("app", "posts", "slug", { typeName: "text" });

describe("sql tagged template", () => {
	it("splices expressions and quotes plain values — never raw", () => {
		const guard = sql`char_length(${slug}) > ${3}`;
		expect(renderExpr(guard.exprNode)).toBe(
			'char_length("app"."posts"."slug") > 3',
		);
	});
	it("treats interpolated strings as quoted literals (injection corpus)", () => {
		const attempted = sql`name = ${"x'; drop table posts; --"}`;
		expect(renderExpr(attempted.exprNode)).toBe(
			"name = 'x''; drop table posts; --'",
		);
	});
	it("sql.raw passes text through verbatim", () => {
		expect(renderExpr(sql.raw("1 = 1").exprNode)).toBe("1 = 1");
	});
});

import { describe, expect, it } from "vitest";
import { collectColumnRefs, expr, isNull, renderExpr } from "../../src/index";

const newParentId = expr("uuid", {
	nodeKind: "plpgsqlRef",
	path: ["new", "parent_id"],
});

describe("plpgsqlRef", () => {
	it("renders dot-joined and unquoted", () => {
		expect(renderExpr(newParentId.exprNode)).toBe("new.parent_id");
	});
	it("renders single-segment locals", () => {
		expect(
			renderExpr({ nodeKind: "plpgsqlRef", path: ["parent_post_id"] }),
		).toBe("parent_post_id");
	});
	it("composes with operators without parenthesization", () => {
		expect(renderExpr(isNull(newParentId).exprNode)).toBe(
			"new.parent_id is null",
		);
	});
	it("is invisible to column scope validation", () => {
		expect(collectColumnRefs(newParentId.exprNode)).toEqual([]);
	});
});

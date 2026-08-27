import { describe, expect, it } from "vitest";
import { liftLiteral, renderLiteral } from "../../src/index";

const render = (value: unknown) => renderLiteral(liftLiteral(value, "text"));

describe("liftLiteral + renderLiteral", () => {
	it("quotes strings and doubles embedded quotes (injection corpus)", () => {
		expect(render("hello")).toBe("'hello'");
		expect(render("it's")).toBe("'it''s'");
		expect(render("'; drop table users; --")).toBe(
			"'''; drop table users; --'",
		);
	});
	it("renders numbers, booleans, null", () => {
		expect(renderLiteral(liftLiteral(42, "numeric"))).toBe("42");
		expect(renderLiteral(liftLiteral(true, "boolean"))).toBe("true");
		expect(renderLiteral(liftLiteral(null, "text"))).toBe("null");
	});
	it("renders Date as an explicit timestamptz literal", () => {
		const value = new Date("2026-08-19T00:00:00.000Z");
		expect(renderLiteral(liftLiteral(value, "datetime"))).toBe(
			"'2026-08-19T00:00:00.000Z'::timestamptz",
		);
	});
	it("rejects non-finite numbers with an actionable error", () => {
		expect(() => liftLiteral(Number.NaN, "numeric")).toThrowError(
			/invalid-literal|not a finite number/,
		);
	});
	// #154 ratchet-5: liftLiteral's final fallback (a JS type none of the
	// prior typeof checks match -- undefined, function, symbol, bigint) had
	// no test at all. harden-query-layer #322: `bigint` stays here,
	// unsupported by this function -- `liftLiteral` is the *declaration*-
	// path lifter (`.default()`, comparison operators), reverted to exactly
	// its pre-#322 baseline (see `query/column-value.test.ts` for the
	// mutation-write-path `bigint`/`interval`/`array` lifter this project
	// added instead, `liftColumnValue`, which never touches this function).
	it("rejects unsupported JS types (invalid-literal)", () => {
		expect(() => liftLiteral(undefined, "text")).toThrowError(
			expect.objectContaining({ code: "invalid-literal" }),
		);
		expect(() => liftLiteral(() => {}, "text")).toThrowError(
			expect.objectContaining({ code: "invalid-literal" }),
		);
		expect(() => liftLiteral(Symbol("x"), "text")).toThrowError(
			expect.objectContaining({ code: "invalid-literal" }),
		);
		expect(() => liftLiteral(10n, "numeric")).toThrowError(
			expect.objectContaining({ code: "invalid-literal" }),
		);
	});

	it("rejects arrays and plain objects (ambiguous-literal)", () => {
		// hejbroError objects are not Error instances (issue #25), so match the
		// thrown object's `code` directly rather than relying on `.message`.
		expect(() => liftLiteral(["a", "b"], "array")).toThrowError(
			expect.objectContaining({ code: "ambiguous-literal" }),
		);
		expect(() => liftLiteral({ a: 1 }, "json")).toThrowError(
			expect.objectContaining({ code: "ambiguous-literal" }),
		);
	});
});

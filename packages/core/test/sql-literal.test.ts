import { describe, expect, it } from "vitest";
import { quoteStringLiteral } from "../src/sql/literal";

describe("quoteStringLiteral", () => {
	it("always single-quotes", () => {
		expect(quoteStringLiteral("draft")).toBe("'draft'");
	});
	it("escapes an embedded single quote by doubling it", () => {
		expect(quoteStringLiteral("it's")).toBe("'it''s'");
	});
	it("escapes consecutive single quotes", () => {
		expect(quoteStringLiteral("''")).toBe("''''''");
	});
	it("quotes an empty string", () => {
		expect(quoteStringLiteral("")).toBe("''");
	});
});

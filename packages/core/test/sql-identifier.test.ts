import { describe, expect, it } from "vitest";
import { qualifyName, quoteIdentifier } from "../src/sql/identifier";

describe("quoteIdentifier", () => {
	it("always double-quotes", () => {
		expect(quoteIdentifier("posts")).toBe('"posts"');
	});
	it("escapes embedded double quotes", () => {
		expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
	});
	it("rejects empty names with actionable message", () => {
		expect(() => quoteIdentifier("")).toThrowError(
			/empty.*give the object a name/i,
		);
	});
});

describe("qualifyName", () => {
	it("joins quoted parts", () => {
		expect(qualifyName("app", "posts")).toBe('"app"."posts"');
	});
});

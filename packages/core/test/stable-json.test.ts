import { describe, expect, it } from "vitest";
import { stableJson } from "../src/snapshot/stable-json";

describe("stableJson", () => {
	it("sorts keys recursively", () => {
		expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
			stableJson({ a: { c: 3, d: 2 }, b: 1 }),
		);
	});
	it("preserves array order", () => {
		const rendered = stableJson({ values: ["b", "a"] });
		expect(rendered.indexOf('"b"')).toBeLessThan(rendered.indexOf('"a"'));
	});
	it("ends with a newline", () => {
		expect(stableJson({})).toMatch(/\n$/);
	});
});

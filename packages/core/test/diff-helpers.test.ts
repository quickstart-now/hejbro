import { describe, expect, it } from "vitest";
import { diffByKey, sameJson } from "../src/kind/diff-helpers";

describe("diffByKey", () => {
	it("detects added entries", () => {
		const result = diffByKey<number>([], [{ key: "a", value: 1 }]);
		expect(result.added).toEqual([{ key: "a", value: 1 }]);
		expect(result.removed).toEqual([]);
		expect(result.changed).toEqual([]);
	});

	it("detects removed entries", () => {
		const result = diffByKey<number>([{ key: "a", value: 1 }], []);
		expect(result.removed).toEqual([{ key: "a", value: 1 }]);
		expect(result.added).toEqual([]);
		expect(result.changed).toEqual([]);
	});

	it("detects changed entries", () => {
		const result = diffByKey<number>(
			[{ key: "a", value: 1 }],
			[{ key: "a", value: 2 }],
		);
		expect(result.changed).toEqual([{ key: "a", previous: 1, next: 2 }]);
		expect(result.added).toEqual([]);
		expect(result.removed).toEqual([]);
	});

	it("omits unchanged entries entirely", () => {
		const result = diffByKey<number>(
			[{ key: "a", value: 1 }],
			[{ key: "a", value: 1 }],
		);
		expect(result.added).toEqual([]);
		expect(result.removed).toEqual([]);
		expect(result.changed).toEqual([]);
	});

	it("ignores input order and sorts output by key", () => {
		const previous = [
			{ key: "b", value: 1 },
			{ key: "d", value: 1 },
		];
		const next = [
			{ key: "c", value: 1 },
			{ key: "a", value: 1 },
		];
		const result = diffByKey<number>(previous, next);
		expect(result.added.map((entry) => entry.key)).toEqual(["a", "c"]);
		expect(result.removed.map((entry) => entry.key)).toEqual(["b", "d"]);
	});

	it("treats deep-equal objects (by stableJson bytes) as unchanged regardless of key order", () => {
		const previous = [{ key: "a", value: { x: 1, y: 2 } }];
		const next = [{ key: "a", value: { y: 2, x: 1 } }];
		const result = diffByKey(previous, next);
		expect(result.changed).toEqual([]);
	});
});

describe("sameJson", () => {
	it("is true for structurally equal values regardless of key order", () => {
		expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
	});
	it("is false for different values", () => {
		expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
	});
});

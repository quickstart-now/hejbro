import { describe, expect, expectTypeOf, it } from "vitest";
import { HejbroError } from "../src/error";
import { assertNoNulls } from "../src/types/assert-no-nulls";

describe("assertNoNulls (add-array-ergonomics, group 2)", () => {
	it("a clean array comes back with the same elements, none dropped", () => {
		const clean: ReadonlyArray<string | null> = ["a", "b", "c"];
		const narrowed = assertNoNulls(clean);
		expectTypeOf(narrowed).toEqualTypeOf<ReadonlyArray<string>>();
		expect(narrowed).toEqual(["a", "b", "c"]);
	});

	it("a falsy element is not a null element and is never dropped", () => {
		const withFalsy: ReadonlyArray<string | null> = ["a", "", "c"];
		const narrowed = assertNoNulls(withFalsy);
		expect(narrowed).toHaveLength(3);
		expect(narrowed).toEqual(["a", "", "c"]);
	});

	it("a null element throws HejbroError(null-array-element) naming its index and the fix", () => {
		const withNull: ReadonlyArray<string | null> = ["a", "b", null, "d"];
		expect.assertions(5);
		try {
			assertNoNulls(withNull);
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("null-array-element");
			expect((error as HejbroError).message).toMatch(/\bindex 2\b/);
			expect((error as HejbroError).message).toMatch(/\bNext:/);
			expect((error as HejbroError).message).toMatch(
				/\.array\(\)\.notNullElements\(\)/,
			);
		}
	});

	it("names the FIRST null when more than one element is null", () => {
		const withNulls: ReadonlyArray<string | null> = [null, "b", null];
		expect.assertions(1);
		try {
			assertNoNulls(withNulls);
		} catch (error) {
			expect((error as HejbroError).message).toMatch(/\bindex 0\b/);
		}
	});

	it("an empty array is fine, returning an empty array", () => {
		expect(assertNoNulls([])).toEqual([]);
	});
});

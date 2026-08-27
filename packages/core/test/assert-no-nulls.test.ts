import { describe, expect, it } from "vitest";
import { HejbroError } from "../src/error";
import { assertNoNulls } from "../src/types/assert-no-nulls";

describe("assertNoNulls (add-array-ergonomics, group 2)", () => {
	it("a clean array comes back with the same elements, none dropped", () => {
		const clean: ReadonlyArray<string | null> = ["a", "b", "c"];
		const narrowed = assertNoNulls(clean);
		expect(narrowed).toEqual(["a", "b", "c"]);
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
			expect((error as HejbroError).message).toContain("Next:");
			expect((error as HejbroError).message).toContain(
				".array().notNullElements()",
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

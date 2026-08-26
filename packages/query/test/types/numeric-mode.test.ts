import { describe, expect, it } from "vitest";
import { convertNumericText } from "../../src/types/numeric-mode";

describe("convertNumericText (D3, task 3.9)", () => {
	it("'string' mode returns the raw text unchanged, always exact", () => {
		expect(convertNumericText("123", "string")).toBe("123");
		expect(convertNumericText("123.456", "string")).toBe("123.456");
		expect(convertNumericText("99999999999999999999999999999", "string")).toBe(
			"99999999999999999999999999999",
		);
	});

	it("'number' mode converts within Number.MAX_SAFE_INTEGER", () => {
		expect(convertNumericText("123", "number")).toBe(123);
		expect(convertNumericText("123.456", "number")).toBe(123.456);
		expect(convertNumericText("-42", "number")).toBe(-42);
		expect(convertNumericText(String(Number.MAX_SAFE_INTEGER), "number")).toBe(
			Number.MAX_SAFE_INTEGER,
		);
	});

	it("number mode rejects a value beyond MAX_SAFE_INTEGER", () => {
		const beyond = `${Number.MAX_SAFE_INTEGER}9`;
		expect(() => convertNumericText(beyond, "number")).toThrowError(
			/beyond Number\.MAX_SAFE_INTEGER/,
		);
	});

	it("number mode rejects a value beyond -MIN_SAFE_INTEGER (positive/negative contrast)", () => {
		const beyondNegative = `-${Number.MAX_SAFE_INTEGER}9`;
		expect(() => convertNumericText(beyondNegative, "number")).toThrowError(
			/beyond Number\.MAX_SAFE_INTEGER/,
		);
	});

	it("throws a kebab-case-coded, enriched plain Error (not HejbroError)", () => {
		try {
			convertNumericText(`${Number.MAX_SAFE_INTEGER}9`, "number");
			expect.unreachable("convertNumericText should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "numeric-mode-overflow");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});

	it("'bigint' mode converts an already-integer (int8) value exactly", () => {
		expect(convertNumericText("123", "bigint")).toBe(123n);
		expect(convertNumericText("-42", "bigint")).toBe(-42n);
		expect(convertNumericText("99999999999999999999999999999", "bigint")).toBe(
			99999999999999999999999999999n,
		);
	});

	it("'bigint' mode converts a value merely written with a zero fraction", () => {
		// "42.000" and "42" are the same value -- nothing is lost, so this
		// is the positive contrast for the negative case right below.
		expect(convertNumericText("42.000", "bigint")).toBe(42n);
		expect(convertNumericText("-42.0", "bigint")).toBe(-42n);
	});

	it("'bigint' mode rejects a nonzero fractional (numeric) value instead of silently truncating it", () => {
		expect(() => convertNumericText("123.9", "bigint")).toThrowError(
			/nonzero fractional part/,
		);
		expect(() => convertNumericText("-123.9", "bigint")).toThrowError(
			/nonzero fractional part/,
		);
		expect(() => convertNumericText("123.001", "bigint")).toThrowError(
			/nonzero fractional part/,
		);
	});

	it("'bigint' fraction rejection throws a kebab-case-coded, enriched plain Error", () => {
		try {
			convertNumericText("123.9", "bigint");
			expect.unreachable("convertNumericText should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "numeric-mode-fraction-loss");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});
});

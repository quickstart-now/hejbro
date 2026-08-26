import { describe, expect, it } from "vitest";
import {
	convertBigintMode,
	convertNumberMode,
	convertNumericText,
	validateNumericText,
} from "../../src/types/numeric-mode";

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

	describe("unparsable/empty input is rejected before any mode branches (all three modes share this contract)", () => {
		const unparsableInputs: ReadonlyArray<[string, string]> = [
			["abc", "not numeric text"],
			["", "empty string"],
			["  ", "whitespace only"],
		];
		const modes: ReadonlyArray<"string" | "number" | "bigint"> = [
			"string",
			"number",
			"bigint",
		];

		modes.forEach((mode) => {
			unparsableInputs.forEach(([raw, label]) => {
				it(`'${mode}' mode rejects ${label} (${JSON.stringify(raw)}) instead of silently returning a value`, () => {
					expect(() => convertNumericText(raw, mode)).toThrowError(
						/could not be converted/,
					);
				});
			});
		});

		it("rejection throws a kebab-case-coded, enriched plain Error (unparsable-numeric-text)", () => {
			try {
				convertNumericText("", "number");
				expect.unreachable("convertNumericText should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect(error).toHaveProperty("code", "unparsable-numeric-text");
				expect((error as Error).message).toMatch(/Next:/);
			}
		});

		it("positive control: ordinary numeric text still converts normally in every mode (not swallowed by the new guard)", () => {
			expect(convertNumericText("42", "string")).toBe("42");
			expect(convertNumericText("42", "number")).toBe(42);
			expect(convertNumericText("42", "bigint")).toBe(42n);
			expect(convertNumericText("42.000", "string")).toBe("42.000");
			expect(convertNumericText("42.000", "number")).toBe(42.0);
			expect(convertNumericText("42.000", "bigint")).toBe(42n);
			expect(convertNumericText("-7", "string")).toBe("-7");
			expect(convertNumericText("-7", "number")).toBe(-7);
			expect(convertNumericText("-7", "bigint")).toBe(-7n);
		});
	});
});

// The three functions convertNumericText itself now dispatches to
// (CRAP split, 3.9-crap): each gets its own direct test here, on top of
// the black-box coverage above -- CRAP is driven by per-function
// complexity, not just line coverage, so a dedicated test per function
// is the actual mechanism that keeps each one's CRAP low, not merely a
// side effect of convertNumericText's own tests happening to reach
// every line.
describe("validateNumericText (extracted from convertNumericText, 3.9-crap)", () => {
	it("passes through silently for valid numeric text, in every mode", () => {
		expect(() => validateNumericText("42", "string")).not.toThrow();
		expect(() => validateNumericText("-7.5", "number")).not.toThrow();
		expect(() => validateNumericText("0", "bigint")).not.toThrow();
	});

	it("throws unparsable-numeric-text for anything that isn't decimal numeric text", () => {
		expect(() => validateNumericText("abc", "number")).toThrowError(
			/could not be converted/,
		);
		expect(() => validateNumericText("", "bigint")).toThrowError(
			/could not be converted/,
		);
		expect(() => validateNumericText("  ", "string")).toThrowError(
			/could not be converted/,
		);
	});
});

describe("convertNumberMode (extracted from convertNumericText, 3.9-crap)", () => {
	it("converts within Number.MAX_SAFE_INTEGER", () => {
		expect(convertNumberMode("123", "number")).toBe(123);
		expect(convertNumberMode("123.456", "number")).toBe(123.456);
		expect(convertNumberMode(String(Number.MAX_SAFE_INTEGER), "number")).toBe(
			Number.MAX_SAFE_INTEGER,
		);
	});

	it("rejects a value beyond MAX_SAFE_INTEGER/MIN_SAFE_INTEGER (positive/negative contrast)", () => {
		expect(() =>
			convertNumberMode(`${Number.MAX_SAFE_INTEGER}9`, "number"),
		).toThrowError(/beyond Number\.MAX_SAFE_INTEGER/);
		expect(() =>
			convertNumberMode(`-${Number.MAX_SAFE_INTEGER}9`, "number"),
		).toThrowError(/beyond Number\.MAX_SAFE_INTEGER/);
	});
});

describe("convertBigintMode (extracted from convertNumericText, 3.9-crap)", () => {
	it("converts an already-integer value exactly, including one merely written with a zero fraction", () => {
		expect(convertBigintMode("123", "bigint")).toBe(123n);
		expect(convertBigintMode("42.000", "bigint")).toBe(42n);
		expect(convertBigintMode("99999999999999999999999999999", "bigint")).toBe(
			99999999999999999999999999999n,
		);
	});

	it("rejects a nonzero fractional value instead of silently truncating it", () => {
		expect(() => convertBigintMode("123.9", "bigint")).toThrowError(
			/nonzero fractional part/,
		);
	});
});

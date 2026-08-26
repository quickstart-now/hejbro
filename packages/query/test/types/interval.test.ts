import { describe, expect, expectTypeOf, it } from "vitest";
import type { IntervalValue } from "../../src/types/interval";
import { parseInterval } from "../../src/types/interval";

describe("IntervalValue (D4, task 3.7)", () => {
	it("an interval column surfaces as a structured, normalized value", () => {
		// exact shape: every field required (owner decision overrides this
		// task's own original D8-based proposal -- D8 governs insert input,
		// not a value read back from the database), one axis each for
		// Postgres's own months/days/microseconds triple.
		expectTypeOf<IntervalValue>().toEqualTypeOf<{
			readonly years: number;
			readonly months: number;
			readonly days: number;
			readonly hours: number;
			readonly minutes: number;
			readonly seconds: number;
			readonly microseconds: number;
		}>();

		// a fully-specified value compiles (this line's own compilation is
		// the assertion — a missing/renamed field would fail `check-types`).
		const full: IntervalValue = {
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 700000,
		};
		expectTypeOf(full.years).toEqualTypeOf<number>();
		expectTypeOf(full.microseconds).toEqualTypeOf<number>();
	});
});

describe("parseInterval (task 3.8)", () => {
	it("parses a full postgres-style interval (positive control)", () => {
		expect(
			parseInterval("1 year 2 mons 3 days 04:05:06.789123"),
		).toEqual<IntervalValue>({
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 789123,
		});
	});

	it("parses a date-only interval, normalized (missing axes are 0)", () => {
		expect(parseInterval("3 days")).toEqual<IntervalValue>({
			years: 0,
			months: 0,
			days: 3,
			hours: 0,
			minutes: 0,
			seconds: 0,
			microseconds: 0,
		});
	});

	it("parses a time-only interval, no fraction, normalized", () => {
		expect(parseInterval("04:05:06")).toEqual<IntervalValue>({
			years: 0,
			months: 0,
			days: 0,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 0,
		});
	});

	it("two source texts for the same interval normalize to the identical object", () => {
		// owner's own motivating case: "3 days" and "3 days 0 mons" mean the
		// same interval and must not become structurally different objects.
		expect(parseInterval("3 days")).toEqual(
			parseInterval("0 years 3 days 00:00:00"),
		);
	});

	it("applies a single leading sign to the whole time part", () => {
		expect(parseInterval("-1 mons +3 days -04:05:06")).toEqual<IntervalValue>({
			years: 0,
			months: -1,
			days: 3,
			hours: -4,
			minutes: -5,
			seconds: -6,
			microseconds: 0,
		});
	});

	it("parses the explicit zero interval", () => {
		expect(parseInterval("00:00:00")).toEqual<IntervalValue>({
			years: 0,
			months: 0,
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
			microseconds: 0,
		});
	});

	it("an unparsable interval is rejected, never half-parsed", () => {
		// a single unrecognizable word -- no partial IntervalValue comes back,
		// the call throws instead (the throw itself is the "never
		// half-parsed" guarantee: there is no return value to inspect).
		expect(() => parseInterval("banana")).toThrowError(/could not be parsed/);
	});

	it("rejects a malformed date unit (positive/negative contrast with 3 days)", () => {
		expect(() => parseInterval("3 dayz")).toThrowError(/unknown date unit/);
	});

	it("rejects a non-integer date component instead of silently dropping it", () => {
		expect(() => parseInterval("1.5 days")).toThrowError(
			/doesn't start with a whole number/,
		);
	});

	it("rejects empty input", () => {
		expect(() => parseInterval("")).toThrowError(/could not be parsed/);
		expect(() => parseInterval("   ")).toThrowError(/could not be parsed/);
	});

	it("throws a kebab-case-coded, enriched plain Error (not HejbroError)", () => {
		try {
			parseInterval("banana");
			expect.unreachable("parseInterval should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "unparsable-interval");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});
});

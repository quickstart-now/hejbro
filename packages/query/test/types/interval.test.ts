import { describe, expectTypeOf, it } from "vitest";
import type { IntervalValue } from "../../src/types/interval";

describe("IntervalValue (D4, task 3.7)", () => {
	it("an interval column surfaces as a structured value", () => {
		// exact shape: every field optional (D8's `col?: T`, defaults to 0),
		// one axis each for Postgres's own months/days/microseconds triple.
		expectTypeOf<IntervalValue>().toEqualTypeOf<{
			readonly years?: number;
			readonly months?: number;
			readonly days?: number;
			readonly hours?: number;
			readonly minutes?: number;
			readonly seconds?: number;
			readonly microseconds?: number;
		}>();

		// a fully-specified value compiles (this line's own compilation is
		// the assertion — a missing/renamed field would fail `check-types`)...
		const full: IntervalValue = {
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 700000,
		};
		// ...and so does the empty interval (every field optional).
		const empty: IntervalValue = {};
		expectTypeOf(full.years).toEqualTypeOf<number | undefined>();
		expectTypeOf(empty.microseconds).toEqualTypeOf<number | undefined>();
	});
});

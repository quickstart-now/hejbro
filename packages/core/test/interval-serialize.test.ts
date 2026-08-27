import { describe, expect, it } from "vitest";
import {
	canonicalizeInterval,
	serializeInterval,
} from "../src/types/interval-serialize";
import type { IntervalValue } from "../src/types/ts-type-map";

const ZERO: IntervalValue = {
	years: 0,
	months: 0,
	days: 0,
	hours: 0,
	minutes: 0,
	seconds: 0,
	microseconds: 0,
};

describe("canonicalizeInterval (#322 task 2.2)", () => {
	it("leaves an already-canonical value unchanged (fixed point)", () => {
		const value: IntervalValue = {
			...ZERO,
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 7,
		};
		expect(canonicalizeInterval(value)).toEqual(value);
	});

	it("folds a months-axis carry (months >= 12) into years, never into days -- cross-axis conversion never happens", () => {
		expect(canonicalizeInterval({ ...ZERO, months: 14 })).toEqual({
			...ZERO,
			years: 1,
			months: 2,
		});
	});

	it("folds a time-axis carry (minutes/seconds/microseconds overflow) up through hours", () => {
		expect(
			canonicalizeInterval({
				...ZERO,
				minutes: 90,
				seconds: 90,
				microseconds: 1_500_000,
			}),
		).toEqual({
			...ZERO,
			hours: 1,
			minutes: 31,
			seconds: 31,
			microseconds: 500_000,
		});
	});

	it("keeps months-axis and time-axis carries independent of a mixed-sign input across axes (months positive, time negative)", () => {
		expect(canonicalizeInterval({ ...ZERO, months: 1, minutes: -90 })).toEqual({
			...ZERO,
			months: 1,
			hours: -1,
			minutes: -30,
		});
	});

	it("is idempotent: canonicalizing an already-canonical value returns the same value again", () => {
		const once = canonicalizeInterval({ ...ZERO, months: 25, seconds: 3_700 });
		expect(canonicalizeInterval(once)).toEqual(once);
	});

	it("never leaks -0 on the months or days axis", () => {
		const result = canonicalizeInterval({ ...ZERO, months: -5 });
		expect(Object.is(result.years, -0)).toBe(false);
		expect(result).toEqual({ ...ZERO, years: 0, months: -5 });
	});
});

describe("serializeInterval (#322 task 2.2, design.md Settled Decision 2)", () => {
	it("renders the zero interval in the always-full grammar, every axis present", () => {
		expect(serializeInterval(ZERO)).toBe(
			"0 years 0 mons 0 days 00:00:00.000000",
		);
	});

	it("renders every axis's own sign independently, zero-padded", () => {
		expect(
			serializeInterval({
				years: 1,
				months: 2,
				days: 3,
				hours: 4,
				minutes: 5,
				seconds: 6,
				microseconds: 7,
			}),
		).toBe("1 years 2 mons 3 days 04:05:06.000007");
	});

	it("right-pads a sub-six-digit microseconds value on the LEFT (not the parser's right-pad-on-read convention) so it round-trips through parseInterval's own padEnd(6) unchanged", () => {
		// microseconds: 6 must render as ".000006", never ".6" -- ".6" would
		// parse back (via parseInterval's own read-side padEnd(6,"0")) as
		// 600000, not 6.
		expect(serializeInterval({ ...ZERO, microseconds: 6 })).toBe(
			"0 years 0 mons 0 days 00:00:00.000006",
		);
	});

	it("carries a negative months-axis sign on both years and months (canonical split shares one sign)", () => {
		expect(serializeInterval({ ...ZERO, months: -14 })).toBe(
			"-1 years -2 mons 0 days 00:00:00.000000",
		);
	});

	it("signs the whole time axis from the hours token, even when a negative time axis canonicalizes hours to a nonzero value", () => {
		expect(serializeInterval({ ...ZERO, hours: -2, minutes: -30 })).toBe(
			"0 years 0 mons 0 days -02:30:00.000000",
		);
	});

	it("first canonicalizes before rendering -- a non-canonical input (months >= 12) renders its canonical split, not the raw input", () => {
		expect(serializeInterval({ ...ZERO, months: 25 })).toBe(
			"2 years 1 mons 0 days 00:00:00.000000",
		);
	});

	// Owner decision (D), settled: `parseInterval` (query package, not this
	// file) now `+0`-normalizes every time-axis sub-field, so a negative
	// time axis with a zero hours (or a nonzero hours but a zero minutes/
	// seconds/microseconds) round-trips correctly. The actual round-trip
	// property against the real `parseInterval` lives in
	// `packages/query/test/types/interval-serialize.test.ts` ("beside the
	// parser") -- this file can't call `parseInterval` from core, so it
	// only ever asserted `serializeInterval`'s own text output (see
	// "signs the whole time axis..." above), never the full round trip.
});

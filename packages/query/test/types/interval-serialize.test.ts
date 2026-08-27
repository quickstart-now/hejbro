import { describe, expect, it } from "vitest";
import type { IntervalValue } from "../../src/types/interval";
import {
	canonicalizeInterval,
	parseInterval,
	serializeInterval,
} from "../../src/types/interval";

const ZERO: IntervalValue = {
	years: 0,
	months: 0,
	days: 0,
	hours: 0,
	minutes: 0,
	seconds: 0,
	microseconds: 0,
};

/**
 * The `parse(serialize(v)) = canonicalize(v)` property's generation domain
 * (harden-query-layer #322 task 2.2) — deliberately includes every carry-
 * triggering shape (`minutes`/`seconds`/`microseconds` past their own
 * modulus, `months >= 12`) and cross-axis mixed signs (one axis positive,
 * a different axis negative), including a negative time axis with a
 * zero-valued sub-field (owner decision (D) now fixes `parseInterval`'s
 * own `sign * Number(zeroText)` `-0` defect — these two entries used to be
 * excluded here, named as `it.todo`s, until (D) landed). No
 * `fast-check`/property-testing library exists anywhere in this monorepo
 * yet (checked); this is a hand-curated table covering the same axis
 * combinations a generator would sample, not a justification to add one
 * for a single file.
 */
const roundTripDomain: ReadonlyArray<readonly [string, IntervalValue]> = [
	["zero interval", ZERO],
	[
		"already canonical, every axis populated",
		{
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 7,
		},
	],
	["months-axis carry (>= 12)", { ...ZERO, months: 14 }],
	["months-axis carry, negative", { ...ZERO, months: -14 }],
	["minutes-axis carry (>= 60)", { ...ZERO, minutes: 90 }],
	["seconds-axis carry (>= 60)", { ...ZERO, seconds: 125 }],
	["microseconds-axis carry (>= 1e6)", { ...ZERO, microseconds: 2_500_000 }],
	[
		"combined time-axis carry across minutes/seconds/microseconds at once",
		{ ...ZERO, minutes: 90, seconds: 90, microseconds: 1_500_000 },
	],
	[
		"cross-axis mixed sign: months negative, time positive",
		{ ...ZERO, months: -1, hours: 2 },
	],
	[
		"cross-axis mixed sign: months positive, fully-populated negative time axis (every hours/minutes/seconds/microseconds sub-field nonzero)",
		{
			...ZERO,
			months: 1,
			hours: -1,
			minutes: -2,
			seconds: -3,
			microseconds: -4,
		},
	],
	["days axis negative alone", { ...ZERO, days: -10 }],
	// (D) revival: negative time axis whose own `hours` canonicalizes to 0
	// -- the narrowest shape of the -0 defect, previously the first
	// `it.todo` here.
	[
		"(D revived) months positive, negative time axis whose hours field canonicalizes to 0",
		{ ...ZERO, months: 1, minutes: -5 },
	],
	// (D) revival: negative time axis with a NONZERO hours but a
	// zero-valued minutes/seconds/microseconds sub-field -- the wider
	// shape of the -0 defect this project found while building this
	// table, previously the second `it.todo` here.
	[
		"(D revived) months-axis carry negative, time-axis carry negative (nonzero hours, zero seconds/microseconds)",
		{ ...ZERO, months: -25, minutes: -90 },
	],
];

/**
 * A pure 32-bit integer hash (a standard invertible bit-mixer, same shape
 * as murmurhash3's finalizer) — deterministic, not a stateful PRNG (house
 * style: no `let`/`for`). The same `seed` always produces the same output,
 * so a sweep failure names an exact, re-runnable input via its sample
 * index alone.
 */
const hash32 = (seed: number): number => {
	const a = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
	const b = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
	return (b ^ (b >>> 16)) >>> 0;
};

/** `seed`'s hash, mapped into the inclusive integer range `[min, max]`. */
const randomInRange = (seed: number, min: number, max: number): number =>
	min + (hash32(seed) % (max - min + 1));

/**
 * One field's deterministic pseudo-random value for sweep sample `index`
 * — `index` and `fieldOrdinal` (0-6, one per `IntervalValue` key) are
 * mixed with distinct large primes before hashing so the seven fields of
 * one sample don't correlate with each other or with a neighboring
 * sample's same-ordinal field.
 */
const sweepField = (
	index: number,
	fieldOrdinal: number,
	min: number,
	max: number,
): number =>
	randomInRange(index * 104_729 + fieldOrdinal * 7_919 + 1, min, max);

const SWEEP_SAMPLE_COUNT = 256;

/**
 * One deterministic pseudo-random sweep sample — wide per-axis ranges,
 * negative values included on every axis (months up to ±50, well past the
 * ±12 modulus; the full signed time axis on hours/minutes/seconds/
 * microseconds). (D) revival: this sweep used to generate the time axis
 * non-negative only (`positiveTimeAxisOnlySweepValue`, named so in its own
 * title) while `parseInterval`'s `-0` defect was still parked; owner
 * decision (D) fixed that defect, so the full signed domain is swept here.
 */
const sweepValue = (index: number): IntervalValue => ({
	years: sweepField(index, 0, -5, 5),
	months: sweepField(index, 1, -50, 50),
	days: sweepField(index, 2, -400, 400),
	hours: sweepField(index, 3, -50, 50),
	minutes: sweepField(index, 4, -200, 200),
	seconds: sweepField(index, 5, -200, 200),
	microseconds: sweepField(index, 6, -10_000_000, 10_000_000),
});

const sweepSamples: ReadonlyArray<readonly [number, IntervalValue]> =
	Array.from({ length: SWEEP_SAMPLE_COUNT }, (_entry, index) => [
		index,
		sweepValue(index),
	]);

describe("parseInterval(serializeInterval(v)) round-trip property (#322 task 2.2, design.md Settled Decision 2)", () => {
	it.each(roundTripDomain)("%s", (_label, value) => {
		// structural comparison only (`toEqual`) -- `JSON.stringify(-0) ===
		// "0"`, so any text/JSON-serialized comparison here would pass even
		// if a `-0` silently reached a field it shouldn't have.
		expect(parseInterval(serializeInterval(value))).toEqual(
			canonicalizeInterval(value),
		);
	});

	// A deterministic pseudo-random sweep, not just the hand-curated table
	// above -- the table's own author picked its entries, so it can't by
	// itself prove no passing-only cherry-picking happened (the reviewer's
	// "generation-domain honesty" axis). `it.each` over 256 independently
	// seeded samples names its own failing index (and the exact input is
	// one `sweepValue(index)` call away), so a failure here is as
	// debuggable as a named table entry.
	it.each(sweepSamples)(
		"deterministic sweep sample #%i round-trips",
		(_index, value) => {
			expect(parseInterval(serializeInterval(value))).toEqual(
				canonicalizeInterval(value),
			);
		},
	);

	it("canonicalizeInterval(v) = v on the canonical domain (fixed point) -- every entry in the round-trip table above is unaffected by canonicalizing twice", () => {
		roundTripDomain.forEach(([, value]) => {
			const canonical = canonicalizeInterval(value);
			expect(canonicalizeInterval(canonical)).toEqual(canonical);
		});
	});

	// Axis-INTERNAL mixed sign (both fields on the SAME axis disagree in
	// sign, e.g. `hours: 2, minutes: -30`) is deliberately a separate case
	// from the cross-axis mixed-sign entries in `roundTripDomain` above --
	// canonicalization must *absorb* it into one consistently-signed split,
	// not merely tolerate it.
	it("absorbs an axis-internal mixed sign (hours positive, minutes negative on the same time axis) into one consistently-signed canonical split", () => {
		const value: IntervalValue = { ...ZERO, hours: 2, minutes: -30 };
		expect(canonicalizeInterval(value)).toEqual({
			...ZERO,
			hours: 1,
			minutes: 30,
		});
		expect(parseInterval(serializeInterval(value))).toEqual(
			canonicalizeInterval(value),
		);
	});
});

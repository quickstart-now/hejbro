import type { IntervalValue } from "./ts-type-map";

const MICROSECONDS_PER_SECOND = 1_000_000;
const MICROSECONDS_PER_MINUTE = 60 * MICROSECONDS_PER_SECOND;
const MICROSECONDS_PER_HOUR = 60 * MICROSECONDS_PER_MINUTE;
const MONTHS_PER_YEAR = 12;

/**
 * `+0`-normalizes a number — `-0` is numerically `=== 0` but a distinct
 * bit pattern (`Object.is(-0, 0)` is `false`) that `String()`/template
 * literals render as the literal text `"-0"`. Every axis this module
 * canonicalizes/serializes is `+0`, never `-0` — an integer division or
 * modulo that lands exactly on zero from a negative dividend (e.g.
 * `Math.trunc(-5 / 12)`) produces `-0` in JS, and nothing downstream
 * (`parseInterval`, Postgres itself) has a concept of "negative zero
 * years/months/days" to preserve.
 */
const plusZero = (value: number): number => {
	if (value === 0) {
		return 0;
	}
	return value;
};

/**
 * Folds an {@link IntervalValue}'s three independent Postgres axes
 * (months, days, microseconds — see the type's own doc) into their
 * canonical per-axis split: `years`/`months` from `years * 12 + months`,
 * `days` unchanged, `hours`/`minutes`/`seconds`/`microseconds` from their
 * combined microsecond total. Never converts *across* an axis boundary
 * (months↔days↔time) — Postgres itself can't do that losslessly, and this
 * function doesn't try. Idempotent: canonicalizing an already-canonical
 * value returns an equal value.
 */
export const canonicalizeInterval = (value: IntervalValue): IntervalValue => {
	const totalMonths = value.years * MONTHS_PER_YEAR + value.months;
	const years = plusZero(Math.trunc(totalMonths / MONTHS_PER_YEAR));
	const months = plusZero(totalMonths % MONTHS_PER_YEAR);

	const totalMicroseconds =
		((value.hours * 60 + value.minutes) * 60 + value.seconds) *
			MICROSECONDS_PER_SECOND +
		value.microseconds;
	const hours = plusZero(Math.trunc(totalMicroseconds / MICROSECONDS_PER_HOUR));
	const afterHours = totalMicroseconds % MICROSECONDS_PER_HOUR;
	const minutes = plusZero(Math.trunc(afterHours / MICROSECONDS_PER_MINUTE));
	const afterMinutes = afterHours % MICROSECONDS_PER_MINUTE;
	const seconds = plusZero(Math.trunc(afterMinutes / MICROSECONDS_PER_SECOND));
	const microseconds = plusZero(afterMinutes % MICROSECONDS_PER_SECOND);

	return {
		years,
		months,
		days: plusZero(value.days),
		hours,
		minutes,
		seconds,
		microseconds,
	};
};

/** `Math.abs(value)`, zero-padded to `width` digits — the sign is rendered separately (one shared sign for the whole time-axis token, per-field signs for years/months/days), never baked into this text. */
const padDigits = (value: number, width: number): string =>
	Math.abs(value).toString().padStart(width, "0");

/** `"-"` when `totalMicroseconds` is negative, `""` otherwise — the one shared sign the whole time-axis token carries (on the hours position), no ternary (house style). */
const timeAxisSign = (totalMicroseconds: number): string => {
	if (totalMicroseconds < 0) {
		return "-";
	}
	return "";
};

/**
 * Serializes an {@link IntervalValue} to the always-full Postgres
 * `"postgres"`-style interval literal text {@link parseInterval} consumes
 * (harden-query-layer #322 design.md Settled Decision 2): every axis
 * present, per-axis signs, zero elision branches. `value` is
 * {@link canonicalizeInterval canonicalized} first, so
 * `parseInterval(serializeInterval(v)) === canonicalizeInterval(v)` over
 * the whole domain. (An earlier revision of this comment carved out any
 * time axis that's negative overall with a `0`-valued sub-field —
 * `parseInterval`'s shared-sign time reader produced `-0` there. Owner
 * decision (D) landed with the write-side lift: every parsed field is
 * `+0`-normalized now, and `@hejbro/query`'s `interval-serialize.test.ts`
 * round-trip property sweeps that exact region, so the carve-out is
 * gone; expired here per the comment-expiry convention, #342's PR.)
 *
 * The microseconds fraction is padded on the *left* (`padStart`), the
 * opposite of {@link parseInterval}'s own read-side `padEnd(6, "0")` —
 * `microseconds: 6` renders as `".000006"`, never `".6"`: `".6"` would
 * read back (through the parser's right-pad convention) as `600000`, not
 * `6`.
 */
export const serializeInterval = (value: IntervalValue): string => {
	const canonical = canonicalizeInterval(value);
	const totalMicroseconds =
		((canonical.hours * 60 + canonical.minutes) * 60 + canonical.seconds) *
			MICROSECONDS_PER_SECOND +
		canonical.microseconds;
	const timeSign = timeAxisSign(totalMicroseconds);
	const timeText = `${timeSign}${padDigits(canonical.hours, 2)}:${padDigits(
		canonical.minutes,
		2,
	)}:${padDigits(canonical.seconds, 2)}.${padDigits(canonical.microseconds, 6)}`;
	return `${canonical.years} years ${canonical.months} mons ${canonical.days} days ${timeText}`;
};

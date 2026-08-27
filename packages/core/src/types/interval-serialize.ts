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
 * `parseInterval(serializeInterval(v)) === canonicalizeInterval(v)` for
 * every domain but one: **any time axis that's negative overall with at
 * least one `0`-valued `hours`/`minutes`/`seconds`/`microseconds`
 * sub-field** — `parseInterval`'s own time-part reader multiplies every
 * one of `minutes`/`seconds`/`microseconds` by a shared `sign` read off
 * the hours token (`sign * Number(minutesToken)`, etc.), and `-1 * 0` is
 * `-0` in JS regardless of which sub-field the `0` came from. This is
 * wider than "hours canonicalizes to 0" alone (that's the special case
 * where the sign token itself, `-00`, parses back through `Number("-00")
 * === -0`) — a *nonzero* hours with a zero seconds/microseconds hits the
 * same defect. Tracked separately (owner decision (D) pending), not fixed
 * here; a fully negative time axis with every sub-field nonzero is
 * unaffected.
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

import type { IntervalValue } from "@hejbro/core";

/**
 * The TypeScript shape an `interval` column surfaces as (D4) — a
 * structured value, not `unknown`. **Every field is required, not
 * optional** (owner decision, overriding this task's own original D8-based
 * proposal): D8's `col?: T` convention governs *insert input* shape, not a
 * value read back from the database, and {@link parseInterval} always
 * returns a normalized value with every axis present (`0` for one it
 * didn't parse), never a sparse object. Two otherwise-identical intervals
 * that happen to mention different axes in their source text — `"1 day"`
 * and `"1 day 0 mons"` both mean the same interval — would be
 * *structurally different* objects if a missing axis were `undefined`
 * instead of `0`; equality checks and serialization need one canonical
 * shape per value, not one shape per how the text happened to be written.
 *
 * The type itself now lives in `@hejbro/core` (`ts-type-map.ts`, D94: core
 * owns the declaration DSL's type surface — `.$type<T>()`'s narrowing
 * constraint needs to see it without core importing `@hejbro/query`) and
 * is only re-exported here for backward-compatible imports; this parser
 * (task 3.8) is what actually builds a normalized value.
 *
 * **Why these seven fields, and why they're safe.** Postgres stores an
 * interval as exactly three independent values — `months`, `days`,
 * `microseconds` (`src/backend/utils/adt/timestamp.c`'s `Interval`
 * struct; `years`/`weeks` are pure input/output sugar, never stored on
 * their own). Critically, **months and days do not convert into one
 * another** — a month is 28–31 days depending on which month, so there is
 * no fixed "days per month" this type could use, and it never tries to
 * compute one. Every field maps onto exactly one of those three Postgres
 * axes, additively, and never crosses an axis boundary:
 *
 * - `years`, `months` → Postgres's `months` axis only
 *   (`totalMonths = years * 12 + months`). This is exactly how Postgres's
 *   own "postgres"-style output already splits one stored integer into
 *   "N years M mons" for display (`years = totalMonths / 12`,
 *   `months = totalMonths % 12`) — parsing that text back (task 3.8) is
 *   the reverse of the same arithmetic, so this direction is lossless.
 * - `days` → Postgres's `days` axis only, unmodified. There is no `weeks`
 *   field: Postgres never *outputs* weeks (`interval '2 weeks'` is input
 *   sugar for `days: 14`; nothing round-trips through a stored "weeks"
 *   value), so a `weeks` field here would be write-only and is omitted.
 * - `hours`, `minutes`, `seconds`, `microseconds` → Postgres's
 *   `microseconds` axis only (`totalMicroseconds = (((hours * 60 +
 *   minutes) * 60 + seconds) * 1_000_000) + microseconds`). Postgres's own
 *   text output for this axis is a single `HH:MM:SS.ffffff` field with up
 *   to *microsecond* precision — stopping at `milliseconds` here would
 *   silently drop the last three digits on round-trip, which is exactly
 *   the silent-precision-loss failure mode this group's house rule
 *   (fail-fast, D3) rejects elsewhere; `microseconds` alone carries the
 *   full sub-second remainder instead, so no separate `milliseconds`
 *   field is needed (and none is offered, to avoid two fields that could
 *   double-count the same microseconds).
 *
 * None of the three axes is ever combined with either of the other two —
 * that is the one operation Postgres itself cannot do losslessly, and
 * this type structurally cannot express it either (there is no single
 * "total days" or "total seconds" field spanning axes). Building/reading
 * a value is a pure function per axis (task 3.8), never a type-level
 * computation, per this group's "no distributive tricks" guidance.
 */
export type { IntervalValue };

/** The zero interval — every axis `0`. `parseInterval`'s starting point before it fills in whatever the source text actually mentioned. */
const ZERO_INTERVAL: IntervalValue = {
	years: 0,
	months: 0,
	days: 0,
	hours: 0,
	minutes: 0,
	seconds: 0,
	microseconds: 0,
};

/** A single `<number> <unit>` date-part pair, e.g. `"2 mons"` — the unit spellings Postgres's default ("postgres" style) `IntervalStyle` renders. */
const dateUnitNames: Record<string, "years" | "months" | "days"> = {
	year: "years",
	years: "years",
	mon: "months",
	mons: "months",
	day: "days",
	days: "days",
};

/** A signed integer token, e.g. `"-3"` — Postgres never emits a fractional date-part count. */
const INTEGER_TOKEN = /^[+-]?\d+$/;

/** A time-of-day part, e.g. `"-04:05:06.789123"` — one leading sign on the whole thing (Postgres's own convention; minutes/seconds are never independently signed), fractional seconds optional, up to microsecond precision. */
const TIME_PART = /^([+-]?\d+):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

/** Builds the `unparsable-interval`-coded, enriched plain `Error` this module throws (D3's kebab-case-code convention for `@hejbro/query`, not `HejbroError` — that stays a core-only type). Always throws, never returns a partial `IntervalValue`: every call site here is a guard-clause `return` of this call, so a reject aborts parsing immediately. */
const throwUnparsableInterval = (raw: string, reason: string): never => {
	throw Object.assign(
		new Error(
			`interval text ${JSON.stringify(raw)} could not be parsed (${reason}). Next: pass a Postgres "postgres"-style interval text (the connection's default IntervalStyle) — e.g. "1 year 2 mons 3 days 04:05:06.789123".`,
		),
		{ code: "unparsable-interval" },
	);
};

/** `true` once `.trim()`ped down to nothing — Postgres never renders an empty interval string (the zero interval is `"00:00:00"`). */
const isBlank = (value: string): boolean => value.length === 0;

/** The date-part substring of `trimmed`, given whether its trailing token was consumed as the time part. No ternary (house style): each case is its own guard clause. */
const resolveDatePartString = (
	trimmed: string,
	lastSpaceIndex: number,
	timePartConsumed: boolean,
): string => {
	if (!timePartConsumed) {
		return trimmed;
	}
	if (lastSpaceIndex === -1) {
		return "";
	}
	return trimmed.slice(0, lastSpaceIndex).trim();
};

/** One `[numberToken, unitToken]` date-part pair — `Array.from` over `tokens`' pair count (no `for`, house style). */
const datePairs = (
	tokens: ReadonlyArray<string>,
): ReadonlyArray<readonly [string, string]> =>
	Array.from({ length: tokens.length / 2 }, (_entry, index) => {
		const numberToken = tokens[index * 2];
		const unitToken = tokens[index * 2 + 1];
		return [numberToken ?? "", unitToken ?? ""] as const;
	});

/** One validated `[unit, value]` date-part entry — throws on a non-integer count or an unrecognized unit. Kept separate from duplicate-checking so `parseDatePart` can validate each pair once via `.map()` (no accumulating spread, house-style perf lint) before a second, cheap pass checks for repeats. */
const toDateEntry = (
	raw: string,
	numberToken: string,
	unitToken: string,
): readonly ["years" | "months" | "days", number] => {
	if (!INTEGER_TOKEN.test(numberToken)) {
		return throwUnparsableInterval(
			raw,
			`date component "${numberToken} ${unitToken}" doesn't start with a whole number`,
		);
	}
	const unit = dateUnitNames[unitToken];
	if (unit === undefined) {
		return throwUnparsableInterval(
			raw,
			`unknown date unit "${unitToken}" (expected year(s)/mon(s)/day(s))`,
		);
	}
	return [unit, Number(numberToken)];
};

/** The first unit `entries` names twice, or `undefined` if every unit is distinct. */
const firstDuplicateUnit = (
	entries: ReadonlyArray<readonly [string, number]>,
): string | undefined => {
	const units = entries.map(([unit]) => unit);
	return units.find((unit, index) => units.indexOf(unit) !== index);
};

/** Folds `datePartString`'s `<number> <unit>` pairs into the `years`/`months`/`days` slice of an `IntervalValue` — every pair validated (integer count, known unit, no repeats) before any of them is accepted; the first bad pair throws (`.map`/the duplicate check abort immediately, no partial result). */
const parseDatePart = (
	raw: string,
	datePartString: string,
): Partial<IntervalValue> => {
	if (isBlank(datePartString)) {
		return {};
	}
	const tokens = datePartString.split(/\s+/);
	if (tokens.length % 2 !== 0) {
		return throwUnparsableInterval(
			raw,
			`date part ${JSON.stringify(datePartString)} has an odd number of tokens`,
		);
	}
	const entries = datePairs(tokens).map(([numberToken, unitToken]) =>
		toDateEntry(raw, numberToken, unitToken),
	);
	const duplicate = firstDuplicateUnit(entries);
	if (duplicate !== undefined) {
		return throwUnparsableInterval(
			raw,
			`date unit "${duplicate}" appears more than once`,
		);
	}
	return Object.fromEntries(entries);
};

/** `-1` when `hoursToken` carries the leading sign, `1` otherwise — the one sign Postgres's time part ever has, applied to hours/minutes/seconds/microseconds alike. */
const signOf = (hoursToken: string): 1 | -1 => {
	if (hoursToken.startsWith("-")) {
		return -1;
	}
	return 1;
};

/** Parses `timeToken` (already confirmed to match {@link TIME_PART}) into the `hours`/`minutes`/`seconds`/`microseconds` slice of an `IntervalValue` — the fractional-seconds group, when present, is right-padded to a full six digits before becoming `microseconds`, so `".7"` reads as `700000`µs, never `7`µs. */
const parseTimePart = (timeToken: string): Partial<IntervalValue> => {
	// biome-ignore lint/style/noNonNullAssertion: timeToken already matched TIME_PART at the call site; these three groups are mandatory in that pattern.
	const match = TIME_PART.exec(timeToken)!;
	const [, hoursToken, minutesToken, secondsToken, fractionToken] = match;
	const sign = signOf(hoursToken as string);
	const withoutFraction: Partial<IntervalValue> = {
		hours: Number(hoursToken),
		minutes: sign * Number(minutesToken),
		seconds: sign * Number(secondsToken),
	};
	if (fractionToken === undefined) {
		return withoutFraction;
	}
	return {
		...withoutFraction,
		microseconds: sign * Number(fractionToken.padEnd(6, "0")),
	};
};

/** `parseTimePart(timeToken)` when `timePartConsumed`, else `{}` — no ternary (house style). */
const resolveTimeFields = (
	timeToken: string,
	timePartConsumed: boolean,
): Partial<IntervalValue> => {
	if (!timePartConsumed) {
		return {};
	}
	return parseTimePart(timeToken);
};

/**
 * Parses a Postgres interval's default (`"postgres"`-style `IntervalStyle`)
 * text output into a structured {@link IntervalValue} — a pure function,
 * fail-fast (D3): any text this can't confidently place on one of the
 * three Postgres axes (`years`/`months`, `days`, `hours`–`microseconds`)
 * throws rather than guessing or returning a partial value. Wiring this
 * into row mapping from a live connection is group 4's task.
 */
export const parseInterval = (raw: string): IntervalValue => {
	const trimmed = raw.trim();
	if (isBlank(trimmed)) {
		return throwUnparsableInterval(raw, "empty");
	}
	const lastSpaceIndex = trimmed.lastIndexOf(" ");
	const lastToken = trimmed.slice(lastSpaceIndex + 1);
	const timePartConsumed = TIME_PART.test(lastToken);
	const datePartString = resolveDatePartString(
		trimmed,
		lastSpaceIndex,
		timePartConsumed,
	);
	const dateFields = parseDatePart(raw, datePartString);
	const timeFields = resolveTimeFields(lastToken, timePartConsumed);
	if (
		Object.keys(dateFields).length === 0 &&
		Object.keys(timeFields).length === 0
	) {
		return throwUnparsableInterval(raw, "no recognizable interval components");
	}
	// normalize: every axis present, 0 for one the source text never
	// mentioned -- "1 day" and "1 day 0 mons" read back as the identical
	// object, not two structurally different ones.
	return { ...ZERO_INTERVAL, ...dateFields, ...timeFields };
};

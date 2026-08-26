import type { NumericMode } from "@hejbro/core";

/** Builds the `numeric-mode-overflow`-coded, enriched plain `Error` this module throws (D3's kebab-case-code convention for `@hejbro/query`, not `HejbroError` — that stays a core-only type). */
const throwNumericModeOverflow = (raw: string, mode: "number"): never => {
	throw Object.assign(
		new Error(
			`numeric text ${JSON.stringify(raw)} is beyond Number.MAX_SAFE_INTEGER (mode ${JSON.stringify(mode)} would silently lose precision). Next: use mode: 'bigint' (exact) or mode: 'string' (exact, the default) for a column that can hold values this large.`,
		),
		{ code: "numeric-mode-overflow" },
	);
};

/** Builds the `numeric-mode-fraction-loss`-coded, enriched plain `Error` this module throws when `'bigint'` mode would otherwise silently drop a nonzero fractional part. */
const throwNumericModeFractionLoss = (raw: string, mode: "bigint"): never => {
	throw Object.assign(
		new Error(
			`numeric text ${JSON.stringify(raw)} has a nonzero fractional part (mode ${JSON.stringify(mode)} would silently drop it). Next: use mode: 'string' (exact, the default) or mode: 'number' (exact within Number.MAX_SAFE_INTEGER), or only declare mode: 'bigint' on a column with scale 0.`,
		),
		{ code: "numeric-mode-fraction-loss" },
	);
};

/** Builds the `unparsable-numeric-text`-coded, enriched plain `Error` this module throws for input that isn't decimal numeric text at all — including empty or whitespace-only text, which would otherwise silently become `0`/`0n`, a value indistinguishable from real data (worse than `NaN`, which at least looks wrong). Shared by all three modes (checked before any mode branches). */
const throwUnparsableNumericText = (raw: string, mode: NumericMode): never => {
	throw Object.assign(
		new Error(
			`numeric text ${JSON.stringify(raw)} could not be converted for mode ${JSON.stringify(mode)}. Next: check the value came from an int8/numeric column — this conversion only accepts the driver's own decimal text.`,
		),
		{ code: "unparsable-numeric-text" },
	);
};

/** `true` for text `BigInt`/`Number` can convert exactly: an optional leading `-`, at least one digit, and an optional `.` followed by at least one more digit. Empty and whitespace-only text fail this (deliberately — see {@link throwUnparsableNumericText}). */
const NUMERIC_TEXT_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * The text before `raw`'s first `.`, or all of `raw` if it has none. Only
 * ever called once {@link hasNonzeroFraction} has confirmed there is
 * nothing meaningful past the `.` to drop — this only ever strips a
 * fraction already known to be all zeros (or absent), never a real one.
 */
const integerPartText = (raw: string): string => {
	const dotIndex = raw.indexOf(".");
	if (dotIndex === -1) {
		return raw;
	}
	return raw.slice(0, dotIndex);
};

/** `true` when `raw` has a `.` followed by at least one non-`0` digit — an `int8` value never does (no `.` ever appears), but a `numeric` value can. */
const hasNonzeroFraction = (raw: string): boolean => {
	const dotIndex = raw.indexOf(".");
	if (dotIndex === -1) {
		return false;
	}
	return !/^0*$/.test(raw.slice(dotIndex + 1));
};

/**
 * Converts an `int8`/`numeric` column's raw driver text to the TS value its
 * resolved `NumericMode` (task 3.4) promises — a pure function, fail-fast
 * (D3) in both directions: `'number'` throws beyond
 * `Number.MAX_SAFE_INTEGER` rather than losing precision silently, and
 * `'bigint'` throws on a nonzero fractional part rather than truncating it
 * away silently — truncation drops information exactly as quietly as an
 * overflow would, so both modes reject instead of guessing. A value that's
 * merely *written* with a fraction but equal to an integer (`'42.000'`)
 * still converts normally; nothing is lost there. `'string'` is always
 * exact — it's the raw text back, unchanged. Every mode shares one
 * upfront contract, checked before any mode-specific branch: input that
 * isn't decimal numeric text — including empty or whitespace-only text —
 * throws `unparsable-numeric-text` rather than silently becoming `0`/`0n`
 * (`'string'` mode included, even though it merely returns text back —
 * "always exact" only holds for text that was numeric to begin with).
 * Wiring this into a live row's actual column (reading `columnState.mode`
 * off the declaration) is group 4's task.
 */
export const convertNumericText = (
	raw: string,
	mode: NumericMode,
): bigint | number | string => {
	if (!NUMERIC_TEXT_PATTERN.test(raw)) {
		return throwUnparsableNumericText(raw, mode);
	}
	if (mode === "string") {
		return raw;
	}
	if (mode === "number") {
		const value = Number(raw);
		if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
			return throwNumericModeOverflow(raw, mode);
		}
		return value;
	}
	if (hasNonzeroFraction(raw)) {
		return throwNumericModeFractionLoss(raw, mode);
	}
	return BigInt(integerPartText(raw));
};

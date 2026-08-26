/**
 * Mirrors core's `NumericMode` (task 3.4) by value, not by import — a
 * plain three-literal union needs no coupling to core's public surface,
 * and this file only ever receives the mode a caller already resolved
 * from a `bigint({mode})`/`numeric({mode})` declaration.
 */
export type NumericConversionMode = "bigint" | "number" | "string";

/** Builds the `numeric-mode-overflow`-coded, enriched plain `Error` this module throws (D3's kebab-case-code convention for `@hejbro/query`, not `HejbroError` — that stays a core-only type). */
const throwNumericModeOverflow = (raw: string, mode: "number"): never => {
	throw Object.assign(
		new Error(
			`numeric text ${JSON.stringify(raw)} is beyond Number.MAX_SAFE_INTEGER (mode ${JSON.stringify(mode)} would silently lose precision). Next: use mode: 'bigint' (exact) or mode: 'string' (exact, the default) for a column that can hold values this large.`,
		),
		{ code: "numeric-mode-overflow" },
	);
};

/** Builds the `unparsable-numeric-text`-coded, enriched plain `Error` this module throws for input `BigInt(...)` itself can't parse (defensive: real int8/numeric driver text is never malformed this way). */
const throwUnparsableNumericText = (raw: string, mode: "bigint"): never => {
	throw Object.assign(
		new Error(
			`numeric text ${JSON.stringify(raw)} could not be converted for mode ${JSON.stringify(mode)}. Next: check the value came from an int8/numeric column — this conversion only accepts the driver's own decimal text.`,
		),
		{ code: "unparsable-numeric-text" },
	);
};

/**
 * The text before `raw`'s first `.`, or all of `raw` if it has none —
 * `'bigint'` mode's truncation (group 4/D3): an `int8` value is already an
 * integer (no `.` ever appears), a `numeric` value's fractional part is
 * dropped, never rounded, mirroring `Math.trunc`'s own toward-zero
 * direction for the sign this produces.
 */
const truncatedIntegerText = (raw: string): string => {
	const dotIndex = raw.indexOf(".");
	if (dotIndex === -1) {
		return raw;
	}
	return raw.slice(0, dotIndex);
};

/**
 * Converts an `int8`/`numeric` column's raw driver text to the TS value its
 * resolved `NumericMode` (task 3.4) promises — a pure function, fail-fast
 * (D3): `'number'` throws beyond `Number.MAX_SAFE_INTEGER` rather than
 * losing precision silently, and `'bigint'` truncates toward zero rather
 * than rounding (an implicit, undocumented rounding rule would be its own
 * silent-precision surprise). `'string'` is always exact — it's the raw
 * text back, unchanged. Wiring this into a live row's actual column
 * (reading `columnState.mode` off the declaration) is group 4's task.
 */
export const convertNumericText = (
	raw: string,
	mode: NumericConversionMode,
): bigint | number | string => {
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
	try {
		return BigInt(truncatedIntegerText(raw));
	} catch {
		return throwUnparsableNumericText(raw, mode);
	}
};

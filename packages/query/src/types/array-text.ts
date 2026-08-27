/**
 * A pure parser for Postgres's own array-literal text output (`array_out`) —
 * the same text a driver hands back, unmodified, for any array column whose
 * element type has no dedicated client-side text parser wired ahead of it
 * (task 1.2 wires `interval[]` through this; moded numeric/bigint arrays
 * never reach here at all, since `pg` already splits those into a JS array
 * of decimal-text elements before this module ever sees them).
 *
 * Postgres quotes an element when it contains the delimiter (`,`), a
 * curly brace, a double quote, a backslash, leading/trailing whitespace, is
 * empty, or spells `NULL` case-sensitively without meaning the SQL null —
 * `array_out`'s own quoting rule (`src/backend/utils/adt/arrayfuncs.c`).
 * This parser mirrors that rule in reverse: an unquoted `NULL` token is the
 * SQL null (`null`), a quoted `"NULL"` is the three-letter string, and a
 * quoted element un-escapes `\"`/`\\` back to `"`/`\`. One level of nesting
 * only — multi-dimensional array text is out of scope (design.md
 * Non-Goals); this never recurses into a nested `{...}` element.
 */

/** Builds the `unparsable-array-text`-coded, enriched plain `Error` this module throws (D3's kebab-case-code convention for `@hejbro/query`, matching `interval.ts`'s `throwUnparsableInterval`). Always throws, never returns a partial array: every call site here is a guard-clause `return` of this call, so a reject aborts parsing immediately. */
const throwUnparsableArrayText = (raw: string, reason: string): never => {
	throw Object.assign(
		new Error(
			`array text ${JSON.stringify(raw)} could not be parsed (${reason}). Next: pass a Postgres array-literal text (the driver's own \`array_out\` text) — e.g. '{1,2,3}', '{"a,b",NULL,"c\\"d"}'.`,
		),
		{ code: "unparsable-array-text" },
	);
};

/** One parsed element plus the index just past it in the source text. */
type ElementResult = {
	readonly value: string | null;
	readonly nextIndex: number;
};

/** The elements parsed so far plus the index just past the closing `}`. */
type ElementsResult = {
	readonly elements: ReadonlyArray<string | null>;
	readonly nextIndex: number;
};

/** A quoted element's contents: any run of escaped-pair (`\\.`) or non-quote-non-backslash characters, between a `"` pair. */
const QUOTED_ELEMENT = /^"((?:\\.|[^"\\])*)"/;

/** An unquoted element's text: any run of characters that isn't a delimiter or brace — Postgres never lets an unquoted element contain `,`, `{`, or `}`. */
const UNQUOTED_ELEMENT = /^[^{},]*/;

/** Un-escapes a quoted element's inner text: `\"` → `"`, `\\` → `\` (and, permissively, any other `\x` → `x`, matching `array_out`'s own escaping, which only ever emits those two pairs). */
const unescapeQuoted = (inner: string): string => inner.replace(/\\(.)/g, "$1");

/** Parses the quoted element starting at `raw[index]` (already confirmed to be `"`). */
const parseQuotedElement = (raw: string, index: number): ElementResult => {
	const match = QUOTED_ELEMENT.exec(raw.slice(index));
	if (match === null) {
		return throwUnparsableArrayText(
			raw,
			`unterminated quoted element starting at index ${index}`,
		);
	}
	return {
		value: unescapeQuoted(match[1] ?? ""),
		nextIndex: index + match[0].length,
	};
};

/** Parses the unquoted element starting at `raw[index]` — an unquoted `NULL` token is the SQL null; any other token is its own literal text. */
const parseUnquotedElement = (raw: string, index: number): ElementResult => {
	const token = UNQUOTED_ELEMENT.exec(raw.slice(index))?.[0] ?? "";
	if (token.length === 0) {
		return throwUnparsableArrayText(
			raw,
			`expected an element at index ${index}, found none (empty element text is never valid unquoted)`,
		);
	}
	if (token === "NULL") {
		return { value: null, nextIndex: index + token.length };
	}
	return { value: token, nextIndex: index + token.length };
};

/** One element, quoted or not, starting at `raw[index]`. */
const parseOneElement = (raw: string, index: number): ElementResult => {
	if (raw[index] === '"') {
		return parseQuotedElement(raw, index);
	}
	return parseUnquotedElement(raw, index);
};

/** Parses one element then recurses on what follows it: a `,` means at least one more element, a `}` ends the list. Recursion, not `for`/`while` (house style) — one call frame per element, bounded by the source text's own length. */
const parseElementsFrom = (raw: string, index: number): ElementsResult => {
	const element = parseOneElement(raw, index);
	const separator = raw[element.nextIndex];
	if (separator === ",") {
		const rest = parseElementsFrom(raw, element.nextIndex + 1);
		return {
			elements: [element.value, ...rest.elements],
			nextIndex: rest.nextIndex,
		};
	}
	if (separator === "}") {
		return { elements: [element.value], nextIndex: element.nextIndex + 1 };
	}
	return throwUnparsableArrayText(
		raw,
		`expected "," or "}" at index ${element.nextIndex}, found ${JSON.stringify(separator ?? "<end of text>")}`,
	);
};

/** The element list starting just past the outer `{` at `startIndex` — `{}` (nothing before the closing brace) is the empty array, never a call into {@link parseElementsFrom}. */
const parseElements = (raw: string, startIndex: number): ElementsResult => {
	if (raw[startIndex] === "}") {
		return { elements: [], nextIndex: startIndex + 1 };
	}
	return parseElementsFrom(raw, startIndex);
};

/**
 * Parses a Postgres array-literal text (`array_out`'s own output) into a
 * flat list of `string | null` elements — a pure function, fail-fast (D3):
 * unparsable text (no opening brace, an unterminated quote, a missing
 * delimiter, or trailing content after the closing brace) throws rather
 * than returning a partial array. Element-level type conversion (numeric
 * mode, `interval`) is the caller's job (task 1.2) — every element here is
 * still raw text, or `null` for an unquoted `NULL`.
 */
export const parseArrayText = (raw: string): ReadonlyArray<string | null> => {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("{")) {
		return throwUnparsableArrayText(raw, 'missing opening "{"');
	}
	const result = parseElements(trimmed, 1);
	if (result.nextIndex !== trimmed.length) {
		return throwUnparsableArrayText(
			raw,
			`trailing content after the closing "}" at index ${result.nextIndex}`,
		);
	}
	return result.elements;
};

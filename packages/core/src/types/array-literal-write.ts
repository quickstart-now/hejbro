import { throwHejbroError } from "../error";
import type { SqlTypeFamily } from "../expr/type-family";
import { familyOfTypeNode } from "../expr/type-family";
import { serializeInterval } from "./interval-serialize";
import type { IntervalValue } from "./ts-type-map";
import type { TypeNode } from "./type-node";

/**
 * `true` when `text` needs Postgres array-literal quoting — empty,
 * containing a structural or whitespace character (`"`, `\`, `,`, `{`,
 * `}`, any whitespace), or case-insensitively the bare word `"NULL"` (a
 * corner case this writer's own inverse, the array-text *parser*, relies
 * on: an unquoted `NULL` token means a SQL `null` element, so the
 * three-letter *string* `"NULL"` must be quoted to read back as itself,
 * not as `null`).
 */
const needsArrayQuoting = (text: string): boolean => {
	if (text === "") {
		return true;
	}
	if (/^null$/i.test(text)) {
		return true;
	}
	return /["\\,{}\s]/.test(text);
};

/** Quotes `text` for one array element — backslashes doubled, then quotes escaped, matching the same order every other Postgres text-literal quoter in this codebase uses. */
const quoteArrayElement = (text: string): string =>
	`"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** `text`, quoted only if {@link needsArrayQuoting} says so — most numeric/boolean elements never need it. */
const renderArrayElementText = (text: string): string => {
	if (needsArrayQuoting(text)) {
		return quoteArrayElement(text);
	}
	return text;
};

const throwUnsupportedArrayElement = (family: string): never =>
	throwHejbroError(
		"ambiguous-literal",
		`got an array element of family "${family}" — hejbro has no compile-time-lifted write path for this element type. Next: wrap the whole value explicitly (e.g. sql\`…\`), or declare the array with a supported element type (numeric modes, interval, text, uuid, boolean, datetime).`,
	);

const elementValueForNumeric = (value: unknown): string => {
	if (typeof value === "bigint") {
		return value.toString();
	}
	return String(value);
};

const elementValueForBoolean = (value: unknown): string => {
	if (value) {
		return "t";
	}
	return "f";
};

const elementValueForDatetime = (value: unknown): string => {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return String(value);
};

/**
 * One handler per approved array-element family (harden-query-layer #322):
 * numeric (every mode), interval, text, uuid, boolean, datetime — a
 * `Partial` map, not `Record<SqlTypeFamily, …>`: `json`/`bytea`/`net`/
 * `array` (a nested array) genuinely have no handler, routed to
 * {@link throwUnsupportedArrayElement} instead of a `tsc`-forced no-op
 * entry. Split into its own map (rather than one function's own if-chain)
 * to keep {@link elementValueText} itself at a single lookup-and-call,
 * the same CRAP-discipline shape `expr/literal.ts`'s `literalLiftHandlers`
 * uses (D71/#154 ratchet-5).
 */
const elementValueHandlers: Partial<
	Record<SqlTypeFamily, (value: unknown) => string>
> = {
	interval: (value) => serializeInterval(value as IntervalValue),
	numeric: elementValueForNumeric,
	boolean: elementValueForBoolean,
	datetime: elementValueForDatetime,
	text: (value) => String(value),
	uuid: (value) => String(value),
};

/**
 * One non-`null` element's own text form, given its declared element
 * `TypeNode` — dispatches on the element's {@link familyOfTypeNode family}
 * (reused, not a new mapping table) via {@link elementValueHandlers}.
 * Anything outside the approved scope (`json`, `bytea`, `net`, a nested
 * `array`) has no handler and throws the same `ambiguous-literal` a raw
 * scalar of that shape already does.
 */
const elementValueText = (
	value: unknown,
	elementTypeNode: TypeNode,
): string => {
	const family = familyOfTypeNode(elementTypeNode);
	const handler = elementValueHandlers[family];
	if (handler === undefined) {
		return throwUnsupportedArrayElement(family);
	}
	return handler(value);
};

/**
 * Serializes a JS array to the canonical Postgres array literal text
 * `{elem1,elem2,…}` a bind parameter carries verbatim (harden-query-layer
 * #322 task 2.3) — a single text parameter, never `array[$1,$2,…]`
 * (a variadic SQL text shape whose own length would vary with the
 * array's, violating this project's compiler-determinism contract) and
 * never delegated to the driver's own array serialization (which would
 * need a `driver-contract` spec sentence this group doesn't own, G1's
 * file). `null` elements render as the bare, unquoted token `NULL`; every
 * other element is quoted only when {@link needsArrayQuoting} says its own
 * text needs it. An empty array renders as `{}`.
 */
export const serializeArrayLiteral = (
	elements: ReadonlyArray<unknown>,
	elementTypeNode: TypeNode,
): string => {
	const rendered = elements.map((element) => {
		if (element === null) {
			return "NULL";
		}
		return renderArrayElementText(elementValueText(element, elementTypeNode));
	});
	return `{${rendered.join(",")}}`;
};

/** A JSON value restricted to the shapes hejbro ever serializes. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| ReadonlyArray<JsonValue>
	| { readonly [key: string]: JsonValue };

const isJsonObject = (
	value: JsonValue,
): value is { readonly [key: string]: JsonValue } =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Byte-order key comparator — never `localeCompare`, which is locale-dependent and thus non-deterministic across machines. */
const compareKeys = (a: string, b: string): number => {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
};

const sortValue = (value: JsonValue): JsonValue => {
	if (Array.isArray(value)) {
		return value.map(sortValue);
	}
	if (isJsonObject(value)) {
		const sortedEntries = Object.entries(value)
			.sort(([a], [b]) => compareKeys(a, b))
			.map(([key, entryValue]) => [key, sortValue(entryValue)] as const);
		return Object.fromEntries(sortedEntries);
	}
	return value;
};

/**
 * Renders `value` as JSON with object keys sorted recursively (array order
 * preserved), tab-indented, and terminated by a trailing newline. Two calls
 * on structurally equal values always produce byte-identical output —
 * hejbro's determinism guarantee for snapshots and diffing.
 */
export const stableJson = (value: JsonValue): string =>
	`${JSON.stringify(sortValue(value), null, "\t")}\n`;

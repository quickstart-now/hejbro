import type { JsonValue } from "../snapshot/stable-json";
import { stableJson } from "../snapshot/stable-json";

/** The result of diffing two keyed collections of the same value type. */
export type KeyedDiff<TValue> = {
	readonly added: ReadonlyArray<{
		readonly key: string;
		readonly value: TValue;
	}>;
	readonly removed: ReadonlyArray<{
		readonly key: string;
		readonly value: TValue;
	}>;
	readonly changed: ReadonlyArray<{
		readonly key: string;
		readonly previous: TValue;
		readonly next: TValue;
	}>;
};

/** True when `a` and `b` are structurally equal JSON values (compared as stably serialized bytes). */
export const sameJson = (a: JsonValue, b: JsonValue): boolean =>
	stableJson(a) === stableJson(b);

const compareKeys = (a: string, b: string): number => {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
};

/**
 * Diffs two keyed collections into additions, removals, and changes.
 * Equality is `sameJson` byte equality. Entries present in both with equal
 * values are omitted from every list. Input order never affects the
 * result: outputs are always sorted by key.
 */
export const diffByKey = <TValue extends JsonValue>(
	previous: ReadonlyArray<{ readonly key: string; readonly value: TValue }>,
	next: ReadonlyArray<{ readonly key: string; readonly value: TValue }>,
): KeyedDiff<TValue> => {
	const previousByKey = new Map(
		previous.map((entry) => [entry.key, entry.value] as const),
	);
	const nextByKey = new Map(
		next.map((entry) => [entry.key, entry.value] as const),
	);

	const added = next
		.filter((entry) => !previousByKey.has(entry.key))
		.map((entry) => ({ key: entry.key, value: entry.value }))
		.sort((a, b) => compareKeys(a.key, b.key));

	const removed = previous
		.filter((entry) => !nextByKey.has(entry.key))
		.map((entry) => ({ key: entry.key, value: entry.value }))
		.sort((a, b) => compareKeys(a.key, b.key));

	const changed = previous
		.filter((entry) => nextByKey.has(entry.key))
		.flatMap((entry) => {
			const nextValue = nextByKey.get(entry.key);
			if (nextValue === undefined || sameJson(entry.value, nextValue)) {
				return [];
			}
			return [{ key: entry.key, previous: entry.value, next: nextValue }];
		})
		.sort((a, b) => compareKeys(a.key, b.key));

	return { added, removed, changed };
};

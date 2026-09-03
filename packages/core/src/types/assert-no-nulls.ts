import { throwHejbroError } from "../error";

/**
 * Narrows a `ReadonlyArray<T | null>` to `ReadonlyArray<T>` with a runtime
 * check (design decision 5, add-array-ergonomics): an assertion, not a
 * filter — it never drops elements, and a `null` element throws rather
 * than silently passing one through. Pairs with
 * `.array().notNullElements()` (constraint-backed, at declaration time)
 * for the one-off, consumption-side case where the column itself is a
 * plain nullable-element array.
 *
 * The trailing cast is sound, not a type-safety hole: the only path to
 * the `return` below is having already scanned every element and thrown
 * on the first `null` found (see the `indexOf` guard above it, a strict
 * `===` comparison so `undefined` elements are left alone) — by the time
 * the cast runs, `elements` provably contains no `null`.
 */
export const assertNoNulls = <T>(
	elements: ReadonlyArray<T | null>,
): ReadonlyArray<T> => {
	const nullIndex = elements.indexOf(null);
	if (nullIndex !== -1) {
		return throwHejbroError(
			"null-array-element",
			`array element at index ${nullIndex} is null, so this array cannot be narrowed to non-null elements. Next: filter the nulls out before calling assertNoNulls, or declare the column .array().notNullElements() so the database rejects null elements at write time.`,
		);
	}
	return elements as ReadonlyArray<T>;
};

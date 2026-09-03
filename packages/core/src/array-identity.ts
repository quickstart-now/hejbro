/**
 * `original` itself when a `.map` pass changed nothing across every
 * element, else the freshly mapped array — `Array.prototype.map` always
 * allocates a new array even when every mapped entry comes back unchanged,
 * so a caller that wants to short-circuit on `=== node` after mapping a
 * child array (joins, `WITH` entries, set-op branches, ...) needs this to
 * decide whether the mapped array can be thrown away in favor of the
 * original one.
 *
 * Single copy (add-ctes, task 4.6 — a third near-identical copy had
 * already drifted: one caller delegated to its own `sameByIndex` helper,
 * two others inlined the same `.every` check, all three the same contract
 * by coincidence, not by sharing it). Deliberately ignorant of any node
 * shape or traversal — the "different traversals don't share code" rule
 * this repository otherwise follows is a statement about *callers*, not
 * about a utility that knows nothing about what it is comparing.
 */
export const arrayWithIdentityPreserved = <T>(
	mapped: ReadonlyArray<T>,
	original: ReadonlyArray<T>,
): ReadonlyArray<T> => {
	if (mapped.every((item, index) => item === original[index])) {
		return original;
	}
	return mapped;
};

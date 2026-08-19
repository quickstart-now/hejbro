/**
 * Compares two strings by byte order (UTF-16 code unit order). Never
 * `localeCompare`, which is locale-dependent and therefore non-deterministic
 * across machines — determinism is hejbro's core guarantee for snapshots,
 * diffs, and generated SQL.
 */
export const compareKeys = (a: string, b: string): number => {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
};

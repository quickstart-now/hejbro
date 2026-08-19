/**
 * A hejbro-specific error. Every message states why the failure happened
 * and what the caller should do about it (spec §7).
 */
export type HejbroError = {
	readonly code: string;
	readonly message: string;
	readonly declaredAt: string | null;
};

/**
 * Builds a {@link HejbroError} carrying a machine-readable `code` and a
 * human-readable `message`. `declaredAt` is left `null` here; callers that
 * track declaration source locations attach it themselves.
 */
export const hejbroError = (code: string, message: string): HejbroError => ({
	code,
	message,
	declaredAt: null,
});

/**
 * Throws a {@link HejbroError} built from `code` and `message`. Provided so
 * call sites can throw in an expression position without an intermediate
 * variable.
 */
export const throwHejbroError = (code: string, message: string): never => {
	throw hejbroError(code, message);
};

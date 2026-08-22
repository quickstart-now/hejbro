/**
 * A hejbro-specific error. Every message states why the failure happened
 * and what the caller should do about it (spec §7).
 *
 * A real `Error` subclass (not a plain object) so callers can reliably
 * tell a hejbro error apart from anything else that lands in a `catch`
 * clause's `unknown` value via `instanceof HejbroError` — duck-typing on
 * "has a `code` and a `message`" misidentifies any Node runtime error
 * that also carries a `.code` (e.g. `ERR_MODULE_NOT_FOUND`), see #125.
 */
export class HejbroError extends Error {
	readonly code: string;
	readonly declaredAt: string | null;

	constructor(code: string, message: string, declaredAt: string | null = null) {
		super(message);
		this.name = "HejbroError";
		this.code = code;
		this.declaredAt = declaredAt;
	}
}

/**
 * Builds a {@link HejbroError} carrying a machine-readable `code` and a
 * human-readable `message`. `declaredAt` defaults to `null`; callers that
 * track a declaration's source location (spec §7 decision A8) pass it
 * through.
 */
export const hejbroError = (
	code: string,
	message: string,
	declaredAt: string | null = null,
): HejbroError => new HejbroError(code, message, declaredAt);

/**
 * Throws a {@link HejbroError} built from `code`, `message`, and an optional
 * `declaredAt`. Provided so call sites can throw in an expression position
 * without an intermediate variable.
 */
export const throwHejbroError = (
	code: string,
	message: string,
	declaredAt: string | null = null,
): never => {
	throw hejbroError(code, message, declaredAt);
};

/**
 * Runs `fn`, re-wrapping any exception it throws that ISN'T already a
 * `HejbroError` into one — so a malformed snapshot node (a real
 * possibility once a hand-edited or corrupted file reaches an internal
 * field access it doesn't validate, #26) surfaces as a diagnostic
 * instead of a raw crash. `HejbroError`s pass through unchanged: they're
 * already a deliberate diagnostic, not the failure this guards against.
 *
 * The wrapped message can't tell a malformed snapshot apart from a bug
 * in hejbro's own code — both look identical from here, a raw exception
 * with no `code` — so it states both possibilities and points at
 * `hejbro verify` as the one tool that can actually distinguish them
 * (spec §7 / #87: match the medium, and give a real next action rather
 * than presuming the user's file is at fault).
 */
export const guardSnapshotRead = <T>(describe: string, fn: () => T): T => {
	try {
		return fn();
	} catch (error) {
		if (error instanceof HejbroError) {
			throw error;
		}
		return throwHejbroError(
			"malformed-snapshot-node",
			`hejbro failed while ${describe} — this is either a malformed entry in the snapshot file or a bug in hejbro. Next: run \`hejbro verify\` to check whether the snapshot and migration chain agree; if verify passes, the snapshot is intact and this is a hejbro bug — please report it along with the detail above.`,
		);
	}
};

/**
 * Exhaustiveness helper: call in a `default` branch after every known case
 * of a union has been handled explicitly. If reached, `value`'s type is
 * `never` — TypeScript flags any missing case at compile time.
 */
export const assertNever = (value: never): never =>
	throwHejbroError(
		"unreachable",
		`unexpected value: ${JSON.stringify(value)}.`,
	);

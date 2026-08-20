import type { HejbroDeclaration } from "../kind/object-kind";
import type { Snapshot } from "../snapshot/snapshot";

/** A {@link Diagnostic}'s severity — `"error"` joins `errors` and blocks generation, `"warning"` surfaces in `result.warnings` only. */
export type DiagnosticSeverity = "warning" | "error";

/**
 * A preset-supplied observation about a declaration set (D37). Shares
 * `HejbroError`'s shape (`code`/`message`/`declaredAt`) plus a `severity`
 * that decides whether it blocks generation or only warns.
 */
export type Diagnostic = {
	readonly severity: DiagnosticSeverity;
	readonly code: string;
	readonly message: string;
	readonly declaredAt: string | null;
};

/**
 * A pure preset check: given the built next snapshot and the normalized
 * declaration set, returns zero or more {@link Diagnostic}s. Passed to
 * `generateMigration({ validators })` (D37).
 */
export type Validator = (
	snapshot: Snapshot,
	declarations: ReadonlyArray<HejbroDeclaration>,
) => ReadonlyArray<Diagnostic>;

/**
 * Builds a {@link Diagnostic}. `declaredAt` defaults to `null`, matching
 * `hejbroError`'s convention.
 */
export const diagnostic = (
	severity: DiagnosticSeverity,
	code: string,
	message: string,
	declaredAt: string | null = null,
): Diagnostic => ({ severity, code, message, declaredAt });

/**
 * Runs `validators` in order over `snapshot`/`declarations` and returns
 * their diagnostics flattened, preserving validator order and each
 * validator's own emission order.
 */
export const runValidators = (
	validators: ReadonlyArray<Validator>,
	snapshot: Snapshot,
	declarations: ReadonlyArray<HejbroDeclaration>,
): ReadonlyArray<Diagnostic> =>
	validators.flatMap((validator) => validator(snapshot, declarations));

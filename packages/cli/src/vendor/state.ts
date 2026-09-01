import { throwHejbroError } from "@hejbro/core";
import { resolveStrictMode } from "../tty";
import type { LockResolvedBy } from "./lock";

const NON_DEFAULT_REF_MESSAGE =
	"hejbro.lock was resolved from an explicit ref, not the remote's default branch.";

const strictNamedSuffix =
	"Next: pass --strict to fail here on purpose, or --no-strict to keep this as a warning.";

/**
 * Member (of the ten): "the lock was resolved from somewhere other than
 * the default branch". At `vendor` itself ("advisory locally"):
 * resolving from an explicit `--ref` on this run is the caller's own
 * deliberate request — never blocked here, only noted, regardless of
 * `--strict`.
 *
 * A sibling situation — "a local replacement is active where it is
 * forbidden" — was deliberately dropped from the enumeration rather
 * than built here: that situation belongs to `replace` (a committed
 * source overridden locally by an uncommitted, gitignored file), and
 * this change does not build `replace` — no caller can reach it yet
 * ("a situation earns a place only if it is reachable by some caller in
 * this change", the enumeration's own qualifying rule). A committed
 * `source` that happens to be a local filesystem path is a legitimate
 * configuration (a monorepo-neighbor checkout), not a replacement, and
 * this suite's own fixtures rely on exactly that shape. Returns to the
 * enumeration when `replace` lands.
 */
export const warnIfNonDefaultRef = (
	resolvedBy: LockResolvedBy,
	onWarn: (message: string) => void,
): void => {
	if (resolvedBy !== "default-branch") {
		onWarn(
			`${NON_DEFAULT_REF_MESSAGE} Next: \`vendor --check\` refuses this by default (pass --no-strict there to keep it a warning), so re-vendor from the default branch before committing if that wasn't intended.`,
		);
	}
};

/**
 * At `vendor --check` ("refused at the boundary"): `--check` is already
 * this toolchain's boundary gate (member 8's own note — offline, and
 * the one command CI relies on), so `resolveStrictMode` decides whether
 * a committed non-default-branch lock is merely reported or actually
 * fails the check — explicit `--strict`/`--no-strict` always win, and
 * with neither a non-interactive run (CI, or piped output) fails by
 * default.
 */
export const assertBoundaryAtCheck = (
	resolvedBy: LockResolvedBy,
	strictFlag: boolean | undefined,
	onWarn: (message: string) => void,
): void => {
	if (resolvedBy === "default-branch") {
		return;
	}
	if (resolveStrictMode(strictFlag)) {
		throwHejbroError(
			"vendor-lock-non-default-ref",
			`${NON_DEFAULT_REF_MESSAGE} Next: run \`hejbro vendor\` to re-pin from the default branch, or pass \`--no-strict\` to accept this pinned ref for this run.`,
		);
	}
	onWarn(`${NON_DEFAULT_REF_MESSAGE} ${strictNamedSuffix}`);
};

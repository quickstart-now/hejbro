import { throwHejbroError } from "@hejbro/core";
import { resolveStrictMode } from "../tty";
import type { LockResolvedBy } from "./lock";

/** An explicit URI scheme (`https://`, `file://`, `ssh://`, ...). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** git's own scp-like remote syntax (`git@host:org/repo.git`). */
const IS_SCP_LIKE = /^[^/\s]+@[^/\s]+:/;

/**
 * The one-line rule for member 10 ("a local replacement is active where
 * it is forbidden"): a source is a local replacement exactly when it
 * carries no URI scheme and no scp-like host prefix. Anything committed
 * with an explicit scheme — including `file://` — names a real
 * repository reference on purpose; a bare filesystem path is what a
 * developer types to point at whatever happens to be sitting next to
 * them for local iteration. `hejbro.json` is sealed to `{source}` alone
 * (owner decision, 4.13), so reading this value is the only place this
 * can be judged.
 */
export const isLocalSource = (source: string): boolean =>
	!HAS_SCHEME.test(source) && !IS_SCP_LIKE.test(source);

const LOCAL_SOURCE_MESSAGE = (source: string): string =>
	`"${source}" is a local filesystem path, not a git URL — a local replacement for the schema repository.`;

const NON_DEFAULT_REF_MESSAGE =
	"hejbro.lock was resolved from an explicit ref, not the remote's default branch.";

const strictNamedSuffix =
	"Next: pass --strict to fail here on purpose, or --no-strict to keep this as a warning.";

/**
 * Member 10 at `vendor` itself ("warned locally"): a local source never
 * blocks the write command — using one on your own machine for local
 * iteration is exactly what it's for. Always advisory when present.
 */
export const warnIfLocalSource = (
	source: string,
	onWarn: (message: string) => void,
): void => {
	if (isLocalSource(source)) {
		onWarn(
			`${LOCAL_SOURCE_MESSAGE(source)} Next: \`vendor --check\` fails on this by default (pass --no-strict there to keep it a warning), so vendor from the real remote before committing.`,
		);
	}
};

/**
 * Member 11 at `vendor` itself ("advisory locally"): resolving from an
 * explicit `--ref` on this run is the caller's own deliberate request —
 * never blocked here, only noted, regardless of `--strict`.
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
 * Members 10 and 11 at `vendor --check` ("failed"/"refused at the
 * boundary"): `--check` is already this toolchain's boundary gate
 * (member 8's own note — offline, and the one command CI relies on), so
 * `resolveStrictMode` decides whether a committed local source or a
 * committed non-default-branch lock is merely reported or actually
 * fails the check — explicit `--strict`/`--no-strict` always win, and
 * with neither a non-interactive run (CI, or piped output) fails by
 * default.
 */
export const assertBoundaryAtCheck = (
	source: string | null,
	resolvedBy: LockResolvedBy,
	strictFlag: boolean | undefined,
	onWarn: (message: string) => void,
): void => {
	const strict = resolveStrictMode(strictFlag);
	if (source !== null && isLocalSource(source)) {
		const message = `${LOCAL_SOURCE_MESSAGE(source)} ${strictNamedSuffix}`;
		if (strict) {
			throwHejbroError("vendor-local-source-active", message);
		}
		onWarn(message);
	}
	if (resolvedBy !== "default-branch") {
		const message = `${NON_DEFAULT_REF_MESSAGE} ${strictNamedSuffix}`;
		if (strict) {
			throwHejbroError("vendor-lock-non-default-ref", message);
		}
		onWarn(message);
	}
};

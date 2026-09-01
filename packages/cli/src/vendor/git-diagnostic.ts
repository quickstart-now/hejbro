import { HejbroError, throwHejbroError } from "@hejbro/core";
import { isGitBinaryMissing } from "../git";

/** The first line only — a git subprocess failure's own stderr can carry
 * a multi-line hint block (`fatal: ...` plus an "Are you sure..."
 * follow-up); the first line alone is what names the actual problem,
 * the same "first line only" convention `loader.ts`'s own
 * `firstLine` follows for a different subprocess failure. */
const firstLine = (text: string): string => text.split("\n")[0] ?? text;

/** Node's `execFileSync` own failure shape when `encoding` is given — `stderr` is the string git itself wrote, when it ran at all. */
type ExecFileError = {
	readonly stderr?: string;
	readonly message: string;
};

const isExecFileError = (error: unknown): error is ExecFileError =>
	typeof error === "object" &&
	error !== null &&
	"message" in error &&
	typeof (error as { readonly message: unknown }).message === "string";

/** Git's own stderr when captured, else the raw error's own message — never nothing, so the diagnostic always names *something* concrete. */
const gitFailureReason = (error: unknown): string => {
	if (!isExecFileError(error)) {
		return "the subprocess failed with no further detail";
	}
	if (typeof error.stderr === "string" && error.stderr.trim() !== "") {
		return firstLine(error.stderr.trim());
	}
	return firstLine(error.message);
};

/**
 * Wraps a git call so two failure shapes are told apart from a raw
 * crash: a missing `git` binary (`vendor-git-missing`, the same shape
 * `check`'s missing-driver diagnostic already uses, R2-G4 4.10), and
 * every other git failure reaching the remote — a bad URL, an
 * unreachable host, an authentication failure (schema-vendoring spec,
 * member 2 of the eleven, "The remote cannot be reached or does not
 * exist") — as `vendor-remote-unreachable`, naming the source and git's
 * own stderr rather than letting a raw subprocess error crash the
 * process (the same leak `@hejbro/core`'s own errors used to have
 * before `asHejbroError`'s own discriminator, applied here to this
 * package's own git seam). Shared by `vendor` and `outdated`, the two
 * commands that reach a remote at all, so the wording and the codes
 * never drift between them.
 */
export const withGitDiagnostic = <T>(
	commandName: string,
	source: string,
	run: () => T,
): T => {
	try {
		return run();
	} catch (error) {
		// A `HejbroError` from inside `run()` (e.g. `resolveExport`'s own
		// `vendor-export-missing`/`vendor-ref-not-found`) already names its
		// own, more specific situation -- never re-coded as a generic
		// unreachable-remote failure.
		if (error instanceof HejbroError) {
			throw error;
		}
		if (isGitBinaryMissing(error)) {
			return throwHejbroError(
				"vendor-git-missing",
				`hejbro ${commandName} needs git installed to reach "${source}", and it is not on PATH. Next: install git, then rerun \`hejbro ${commandName}\`.`,
			);
		}
		return throwHejbroError(
			"vendor-remote-unreachable",
			`hejbro ${commandName} could not reach "${source}": ${gitFailureReason(error)}. Next: check the URL or path, your network, and your git credentials for this remote, then rerun \`hejbro ${commandName}\`.`,
		);
	}
};

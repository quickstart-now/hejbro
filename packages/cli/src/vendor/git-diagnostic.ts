import { throwHejbroError } from "@hejbro/core";
import { isGitBinaryMissing } from "../git";

/** Wraps a git call so a missing `git` binary is told so, rather than
 * shown a raw `ENOENT` subprocess failure — the same shape `check`'s
 * missing-driver diagnostic already uses (R2-G4, 4.10). Shared by
 * `vendor` and `outdated`, the two commands that reach a remote at all,
 * so the wording and the code never drift between them. */
export const withGitDiagnostic = <T>(
	commandName: string,
	source: string,
	run: () => T,
): T => {
	try {
		return run();
	} catch (error) {
		if (isGitBinaryMissing(error)) {
			return throwHejbroError(
				"vendor-git-missing",
				`hejbro ${commandName} needs git installed to reach "${source}", and it is not on PATH. Next: install git, then rerun \`hejbro ${commandName}\`.`,
			);
		}
		throw error;
	}
};

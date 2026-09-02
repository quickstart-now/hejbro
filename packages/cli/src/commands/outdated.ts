import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { resolveRemoteHead } from "../git";
import { identityFromMessage } from "../identity";
import { withGitDiagnostic } from "../vendor/git-diagnostic";
import { assertLockNamesACommit, readLock } from "../vendor/lock";
import { readSourceFile } from "../vendor/source-file";

const OUTDATED_DESCRIPTION =
	"Report whether the linked source has a newer commit than the vendored lock — advisory, never fails.";

export type OutdatedResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/**
 * Being behind is advice, not failure (schema-vendoring spec): this
 * always exits 0 once it can compare at all — the two refusals below
 * are about not having anything to compare (no source linked, never
 * vendored), not about the comparison's own result.
 */
export const runOutdated = (cwd: string): OutdatedResult => {
	const fallbackIdentity = "outdated";
	try {
		const sourceFile = readSourceFile(cwd);
		if (sourceFile === null) {
			throwHejbroError(
				"vendor-source-not-linked",
				"hejbro outdated needs a linked source. Next: run `hejbro link <repository>` first.",
			);
		}
		const lock = readLock(cwd);
		if (lock === null) {
			throwHejbroError(
				"vendor-not-yet-vendored",
				"hejbro outdated has nothing to compare against: this repository has never been vendored. Next: run `hejbro vendor` first.",
			);
		}
		assertLockNamesACommit(lock, "hejbro outdated");
		if (lock.commit === undefined) {
			throwHejbroError(
				"vendor-not-yet-vendored",
				"hejbro outdated has nothing to compare against: this repository has never been vendored. Next: run `hejbro vendor` first.",
			);
		}
		const source = sourceFile.source;
		const head = withGitDiagnostic("outdated", source, () =>
			resolveRemoteHead(cwd, source),
		);
		if (head.commit === lock.commit) {
			return { exitCode: 0, stdout: ["up to date"], stderr: null };
		}
		return {
			exitCode: 0,
			stdout: [
				`a newer commit is available: ${head.commit} (${head.branch}), vendored at ${lock.commit}. Next: run \`hejbro vendor\` to update.`,
			],
			stderr: null,
		};
	} catch (error) {
		const hejbroError = asHejbroError(error);
		const diagnostic = fromHejbroError(
			hejbroError,
			identityFromMessage(hejbroError.message, fallbackIdentity),
		);
		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics([diagnostic], null),
		};
	}
};

export const outdatedCommand = defineCommand({
	meta: {
		name: "outdated",
		description: OUTDATED_DESCRIPTION,
	},
	run: async () => {
		const result = runOutdated(process.cwd());
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

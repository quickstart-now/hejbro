import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { identityFromMessage } from "../identity";
import { assertLockWritable, writeLock } from "../vendor/lock";

const LINK_DESCRIPTION =
	"Record the git repository this project vendors its schema from.";

export type LinkResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/**
 * `link` records the source repository alone — no branch, no ref, no
 * commit (schema-vendoring spec, "Linking records the repository
 * alone") — into `hejbro.lock` at the repository root (owner decision):
 * `source` is `link`'s own field there and `vendor` never touches it;
 * `vendor` rewrites every other field (`commit`/`resolvedFrom`/
 * `descriptionFormat`/the two hashes) on every run. Intent and truth
 * stay separated by *who writes what*, in the same file, rather than by
 * splitting them across two files.
 */
export const runLink = (
	cwd: string,
	argv: ReadonlyArray<string>,
): LinkResult => {
	const fallbackIdentity = "link";
	try {
		const force = argv.includes("--force");
		const [source] = argv.filter((token) => !token.startsWith("-"));
		if (source === undefined) {
			throwHejbroError(
				"link-source-required",
				"hejbro link needs the source repository (a git URL or local path). Next: run `hejbro link <repository>`.",
			);
		}
		assertLockWritable(cwd, force);
		writeLock(cwd, { source });
		return {
			exitCode: 0,
			stdout: [`linked "${source}"`],
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

export const linkCommand = defineCommand({
	meta: {
		name: "link",
		description: LINK_DESCRIPTION,
	},
	args: {
		source: {
			type: "positional",
			description:
				"the repository that owns the schema (a git URL or local path)",
			required: false,
		},
		force: {
			type: "boolean",
			description: "overwrite a lock this tool did not write",
		},
	},
	run: async (ctx) => {
		const result = runLink(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

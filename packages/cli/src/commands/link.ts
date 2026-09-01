import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { identityFromMessage } from "../identity";

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
 * alone"). The source lives in `hejbro.config.ts`'s own `schemaSource`
 * field (owner decision: intent belongs in the committed config
 * surface, never in the resolved `hejbro.lock`, and this project
 * already has one config file — a second one is exactly the
 * configuration-duplication risk this pivot's own review flagged).
 *
 * PROVISIONAL (R2-G4): this prints the field to add rather than editing
 * `hejbro.config.ts` itself — this package has no precedent for writing
 * back into a hand-authored TypeScript config, and mutating one safely
 * (preserving a caller's own formatting/comments) needs more than a
 * text-based insert. Awaiting a ruling on whether `link` should write
 * the file automatically; until then this is the safe default.
 */
export const runLink = (argv: ReadonlyArray<string>): LinkResult => {
	const fallbackIdentity = "link";
	try {
		const [source] = argv.filter((token) => !token.startsWith("-"));
		if (source === undefined) {
			throwHejbroError(
				"link-source-required",
				"hejbro link needs the source repository (a git URL or local path). Next: run `hejbro link <repository>`.",
			);
		}
		return {
			exitCode: 0,
			stdout: [
				`Next: add this to hejbro.config.ts and commit it:`,
				``,
				`  schemaSource: "${source}",`,
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
	},
	run: async (ctx) => {
		const result = runLink(ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

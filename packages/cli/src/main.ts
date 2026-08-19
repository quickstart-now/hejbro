import { defineCommand } from "citty";

/**
 * The root `hejbro` command. Subcommands are registered as each lands:
 * `init` (Task 12, this PR), `generate` (Task 13, PR C), `verify`
 * (Task 17, PR D).
 *
 * `meta.description` below is a draft — Task 15 (PR C) pins the
 * owner-approved golden text for `hejbro --help`; it must end
 * "…for the --rename/--confirm-drop flags." (decision ④). Verified via
 * `citty`'s source (0.2.2) that `renderUsage` never re-wraps this string —
 * it renders on one line as given, so no custom `showUsage` is needed for
 * determinism (Task 8 finding (c)).
 */
export const main = defineCommand({
	meta: {
		name: "hejbro",
		version: "0.0.0",
		description:
			"Declare your Postgres schema in TypeScript and generate deterministic migration SQL. Run `hejbro <command> --help` for the --rename/--confirm-drop flags.",
	},
	subCommands: {},
});

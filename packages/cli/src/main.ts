import { defineCommand } from "citty";
import { checkCommand } from "./commands/check";
import { baselineCommand, generateCommand } from "./commands/generate";
import { historyCommand } from "./commands/history";
import { initCommand } from "./commands/init";
import { linkCommand } from "./commands/link";
import { migrateCommand } from "./commands/migrate";
import { outdatedCommand } from "./commands/outdated";
import { raiseCommand } from "./commands/raise";
import { resetCommand } from "./commands/reset";
import { restoreCommand } from "./commands/restore";
import { statusCommand } from "./commands/status";
import { vendorCommand } from "./commands/vendor";
import { verifyCommand } from "./commands/verify";
import { CLI_VERSION } from "./version";

/**
 * The root `hejbro` command. Subcommands: `init` (Task 12), `generate`
 * (Task 13), `verify` (Task 17).
 *
 * `meta.description` is the owner-approved golden text for `hejbro --help`
 * (Task 15, relayed verbatim) — it must end "…for the --rename/--confirm-
 * drop flags." (decision ④). Verified via `citty`'s source (0.2.2) that
 * `renderUsage` never re-wraps this string — it renders on one line as
 * given, so no custom `showUsage` is needed for determinism (Task 8
 * finding (c)).
 */
export const main = defineCommand({
	meta: {
		name: "hejbro",
		version: CLI_VERSION,
		description:
			"Declare your Postgres schema in TypeScript, generate deterministic migration SQL. Renames are handled non-interactively — run `hejbro generate --help` for the --rename/--confirm-drop flags.",
	},
	subCommands: {
		init: initCommand,
		baseline: baselineCommand,
		generate: generateCommand,
		verify: verifyCommand,
		check: checkCommand,
		history: historyCommand,
		restore: restoreCommand,
		migrate: migrateCommand,
		status: statusCommand,
		reset: resetCommand,
		raise: raiseCommand,
		link: linkCommand,
		vendor: vendorCommand,
		outdated: outdatedCommand,
	},
});

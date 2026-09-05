import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	parseBannerHashes,
	parseBannerUpgradedFrom,
	throwHejbroError,
} from "@hejbro/core";
import { defineCommand } from "citty";
import { requireConfigFields } from "../config-required";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import {
	isGitRepository,
	migrationAddedCommits,
	NOT_A_GIT_REPOSITORY_WHY,
	remoteUrl,
} from "../git";
import { computeMigrationState } from "../history-state";
import type { HistoryRow } from "../history-table";
import { renderHistoryTable } from "../history-table";
import { identityFromMessage } from "../identity";
import { configFlagFrom, loadConfig } from "../loader";
import { listMigrationFiles } from "../snapshot-file";
import type { LinkMode } from "../tty";
import { shouldUseLinks } from "../tty";

const HISTORY_DESCRIPTION =
	"List every migration and whether its declaration state still exists in git.";

const HISTORY_ARGS = {
	config: {
		type: "string",
		description: "path to hejbro.config.ts (default: ./hejbro.config.ts)",
	},
	links: {
		type: "boolean",
		description:
			"always render plain migration-url/commit-url columns (github.com/gitlab.com remotes only)",
	},
	"no-links": {
		type: "boolean",
		description: "never render links, even in an interactive terminal",
	},
} as const;

/** `--no-links` wins over `--links` if a caller somehow passes both — the safer of the two conflicting instructions (never producing a link a script didn't ask for beats occasionally omitting one a script did). */
const parseLinksFlag = (
	rawArgs: ReadonlyArray<string>,
): boolean | undefined => {
	if (rawArgs.includes("--no-links")) {
		return false;
	}
	if (rawArgs.includes("--links")) {
		return true;
	}
	return undefined;
};

const remoteUrlForLinkMode = (
	cwd: string,
	linkMode: LinkMode,
): string | null => {
	if (linkMode === "none") {
		return null;
	}
	return remoteUrl(cwd);
};

export type HistoryResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/** `parseBannerHashes` returns `null` for a pre-hash-chain migration file (predates Phase 5) — no banner hash to compare against git at all, so it can never resolve past `lost`/`rewritten`/`uncommitted`; `""` never equals a real `"sha256:..."` string, so {@link computeMigrationState} falls through correctly without a special case of its own. */
const bannerCurrentHashOf = (fileContent: string): string => {
	const hashes = parseBannerHashes(fileContent);
	if (hashes === null) {
		return "";
	}
	return hashes.current;
};

/**
 * `hejbro history` (#130 spec §1/§2/§9): one row per migration file
 * (oldest first, matching `listMigrationFiles`'s own sorted order),
 * each resolved via {@link computeMigrationState} against one shared
 * `migrationAddedCommits` call — never per-file, since that's a single
 * git log invocation covering every migration this run examines.
 */
export const runHistory = async (
	cwd: string,
	rawArgs: ReadonlyArray<string>,
): Promise<HistoryResult> => {
	const fallbackIdentity = "hejbro.config.ts";
	try {
		const configFlag = configFlagFrom(rawArgs);
		const { config } = await loadConfig(cwd, configFlag);
		requireConfigFields(config, "history", ["migrationsDir", "snapshotPath"]);
		if (!isGitRepository(cwd)) {
			throwHejbroError(
				"not-a-git-repository",
				NOT_A_GIT_REPOSITORY_WHY +
					' Next: run this command from inside a git-tracked hejbro project; if it hasn\'t been committed yet, run `git init && git add -A && git commit -m "initial commit"` first.',
			);
		}
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = listMigrationFiles(cwd, config.migrationsDir);
		const addedCommits = migrationAddedCommits(cwd, config.migrationsDir);
		const rows: ReadonlyArray<HistoryRow> = fileNames.map((fileName, index) => {
			const fileContent = readFileSync(
				join(migrationsDirPath, fileName),
				"utf8",
			);
			const bannerCurrentHash = bannerCurrentHashOf(fileContent);
			const entry = computeMigrationState(
				cwd,
				config.migrationsDir,
				config.snapshotPath,
				bannerCurrentHash,
				parseBannerUpgradedFrom(fileContent),
				addedCommits,
				fileName,
			);
			return {
				number: index + 1,
				migrationFileName: fileName,
				state: entry.state,
				commit: entry.commit,
				snapshotHash: bannerCurrentHash,
			};
		});
		const linkMode = shouldUseLinks(parseLinksFlag(rawArgs));
		const remote = remoteUrlForLinkMode(cwd, linkMode);
		const table = renderHistoryTable(rows, {
			linkMode,
			remote,
			migrationsDirRelative: config.migrationsDir,
		});
		return { exitCode: 0, stdout: [table], stderr: null };
	} catch (error) {
		const hejbroErr = asHejbroError(error);
		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics(
				[
					fromHejbroError(
						hejbroErr,
						identityFromMessage(hejbroErr.message, fallbackIdentity),
					),
				],
				null,
			),
		};
	}
};

/** The `hejbro history` citty subcommand — see {@link runHistory}. */
export const historyCommand = defineCommand({
	meta: {
		name: "history",
		description: HISTORY_DESCRIPTION,
	},
	args: HISTORY_ARGS,
	run: async (ctx) => {
		const result = await runHistory(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

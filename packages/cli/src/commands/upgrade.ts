import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainEntry } from "@hejbro/core";
import {
	HEJBRO_SNAPSHOT_VERSION,
	requiredKeysByKind,
	rewriteTipSnapshotHash,
	upgradeSnapshot,
} from "@hejbro/core";
import { defineCommand } from "citty";
import { requireConfigFields } from "../config-required";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { sha256Hex } from "../hash";
import { identityFromMessage } from "../identity";
import { configFlagFrom, loadConfig } from "../loader";
import { buildRegistry } from "../presets";
import { listMigrationFiles, readSnapshotFileText } from "../snapshot-file";
import { chainTipMismatchError, readChainEntries } from "./verify";

const UPGRADE_DESCRIPTION =
	"Re-encode a committed snapshot from an older released format into the current one, re-chaining the tip migration onto it.";

/** `<migrationsDir>/<fileName>`, config-relative -- matching every other command's own output/`Next:` convention (verify.ts's own `migrationPath`, never re-exported since this is a one-line join, not diagnostic text at risk of drifting). */
const migrationConfigPath = (migrationsDir: string, fileName: string): string =>
	`${migrationsDir}/${fileName}`;

export type UpgradeResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/**
 * The precondition (design Q3): the tip's recorded hash must equal the
 * hash of the snapshot exactly as it is stored on disk right now, in
 * whatever format that is -- never the re-encoded bytes. `generate`
 * writes the snapshot file as `renderSnapshot(finalSnapshot)` verbatim
 * and hashes those exact same bytes for the tip's own `snapshot:` line,
 * so hashing the raw file text directly reproduces that hash regardless
 * of format; `verify`'s own `normalizedSnapshotHash` can't be reused
 * here since it parses through today's `parseSnapshot`, which refuses a
 * released older format outright. Throws {@link chainTipMismatchError} --
 * the exact `chain-tip-mismatch` error verify's own check 4 raises for
 * the same break -- an already-broken chain is verify's business, and
 * upgrading over it would hide the break.
 */
const assertTipMatchesStoredSnapshot = (
	tipEntry: ChainEntry | null,
	diskText: string,
	migrationsDir: string,
	snapshotPath: string,
): void => {
	if (tipEntry === null) {
		return;
	}
	const storedHash = `sha256:${sha256Hex(diskText)}`;
	if (tipEntry.current === storedHash) {
		return;
	}
	throw chainTipMismatchError(
		migrationConfigPath(migrationsDir, tipEntry.fileName),
		snapshotPath,
	);
};

/** Rewrites the tip migration's own two banner lines in place (#413) when a tip exists, reporting the file it touched; a project with no migrations re-chains nothing, matching design Q5's "snapshot alone" output. */
const reChainTip = (
	migrationsDirPath: string,
	migrationsDir: string,
	tipEntry: ChainEntry | null,
	newSnapshotHash: string,
): ReadonlyArray<string> => {
	if (tipEntry === null) {
		return [];
	}
	const tipFsPath = join(migrationsDirPath, tipEntry.fileName);
	const tipText = readFileSync(tipFsPath, "utf8");
	writeFileSync(tipFsPath, rewriteTipSnapshotHash(tipText, newSnapshotHash));
	return [
		`re-chained ${migrationConfigPath(migrationsDir, tipEntry.fileName)}`,
	];
};

/**
 * `hejbro upgrade` (#413): re-encodes a committed snapshot written by a
 * released older hejbro into the current format, and re-chains the tip
 * migration onto the new bytes. A current-format snapshot is a no-op
 * (exit 0, nothing written); every other refusal ({@link
 * upgradeSnapshot}'s own diagnostics for a format below the release
 * floor or above current, `snapshot-lost`/`snapshot-not-found` from
 * {@link readSnapshotFileText}, `chain-tip-mismatch` for an
 * already-broken chain) reuses the exact code and text the rest of the
 * CLI already gives for it.
 */
export const runUpgrade = async (
	cwd: string,
	rawArgs: ReadonlyArray<string> = [],
): Promise<UpgradeResult> => {
	const fallbackIdentity = "hejbro.config.ts";
	try {
		const configFlag = configFlagFrom(rawArgs);
		const { config } = await loadConfig(cwd, configFlag);
		requireConfigFields(config, "upgrade", ["snapshotPath", "migrationsDir"]);
		const registry = buildRegistry(config);

		const diskText = readSnapshotFileText(cwd, config, "upgrade");
		const upgrade = upgradeSnapshot(
			diskText,
			registry,
			requiredKeysByKind(registry),
		);

		if (upgrade.fromVersion === HEJBRO_SNAPSHOT_VERSION) {
			return {
				exitCode: 0,
				stdout: [`snapshot is already at format ${HEJBRO_SNAPSHOT_VERSION}`],
				stderr: null,
			};
		}

		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = listMigrationFiles(cwd, config.migrationsDir);
		const entries = readChainEntries(migrationsDirPath, fileNames);
		const tipEntry = entries.at(-1) ?? null;

		assertTipMatchesStoredSnapshot(
			tipEntry,
			diskText,
			config.migrationsDir,
			config.snapshotPath,
		);

		writeFileSync(join(cwd, config.snapshotPath), upgrade.text);
		const newSnapshotHash = `sha256:${sha256Hex(upgrade.text)}`;

		const stdout = [
			`upgraded ${config.snapshotPath}: format ${upgrade.fromVersion} → ${HEJBRO_SNAPSHOT_VERSION}`,
			...reChainTip(
				migrationsDirPath,
				config.migrationsDir,
				tipEntry,
				newSnapshotHash,
			),
		];
		return { exitCode: 0, stdout, stderr: null };
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

/** The `hejbro upgrade` citty subcommand -- see {@link runUpgrade}. */
export const upgradeCommand = defineCommand({
	meta: {
		name: "upgrade",
		description: UPGRADE_DESCRIPTION,
	},
	args: {
		config: {
			type: "string",
			description: "path to hejbro.config.ts (default: ./hejbro.config.ts)",
		},
	},
	run: async (ctx) => {
		const result = await runUpgrade(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

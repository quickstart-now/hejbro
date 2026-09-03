import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { emptySnapshot, renderSnapshot } from "@hejbro/core";
import { defineCommand } from "citty";
import type { HejbroConfig } from "../config";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { identityFromMessage } from "../identity";
import { loadConfig } from "../loader";

const CONFIG_FILE_NAME = "hejbro.config.ts";
const DEFAULT_MIGRATIONS_DIR = "migrations";
const DEFAULT_SNAPSHOT_PATH = "hejbro.snapshot.json";

const CONFIG_FILE_CONTENT = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [],
});
`;

/** `hejbro init`'s per-artifact report (decision U7), extended (#687) with
 * the house `exitCode`/`stderr` shape `commands/link.ts` already uses:
 * `runInit` mints no diagnostic code of its own, it only relays
 * `loadConfig`'s. */
export type InitResult = {
	readonly report: ReadonlyArray<string>;
	readonly exitCode: 0 | 1;
	readonly stderr: string | null;
};

type FileArtifact = {
	readonly kind: "file";
	readonly label: string;
	readonly path: string;
	readonly content: string;
};

type DirArtifact = {
	readonly kind: "dir";
	readonly label: string;
	readonly path: string;
};

type Artifact = FileArtifact | DirArtifact;

const createArtifact = (artifact: Artifact): void => {
	if (artifact.kind === "dir") {
		mkdirSync(artifact.path, { recursive: true });
		return;
	}
	// A configured snapshotPath can name a nested file (D2) whose parent
	// directory the migrations-directory scaffolding never created.
	mkdirSync(dirname(artifact.path), { recursive: true });
	writeFileSync(artifact.path, artifact.content);
};

const applyArtifact = (artifact: Artifact): string => {
	if (existsSync(artifact.path)) {
		return `skipped ${artifact.label} (exists)`;
	}
	createArtifact(artifact);
	return `created ${artifact.label}`;
};

/** A directory's report label carries exactly one trailing slash (D1),
 * independent of how the configured value itself was spelled
 * (`relative` already drops any leading/trailing slash noise `join`
 * preserved). */
const dirLabel = (cwd: string, path: string): string =>
	`${relative(cwd, path)}/`;

const fileLabel = (cwd: string, path: string): string => relative(cwd, path);

/**
 * Resolves where the migrations directory and the snapshot file go:
 * `config`'s own fields when present (D2 pin — `join(cwd, value)`, the
 * same resolution `generate`/`history`/`status` already use, never
 * `resolve`), the scaffolded defaults otherwise. A field the
 * configuration omits falls back the same way a missing configuration
 * does.
 */
const resolveDestinations = (
	cwd: string,
	config: {
		readonly migrationsDir?: string;
		readonly snapshotPath?: string;
	} | null,
): {
	readonly migrationsDirPath: string;
	readonly snapshotFilePath: string;
} => ({
	migrationsDirPath: join(cwd, config?.migrationsDir ?? DEFAULT_MIGRATIONS_DIR),
	snapshotFilePath: join(cwd, config?.snapshotPath ?? DEFAULT_SNAPSHOT_PATH),
});

/** `null` when no `hejbro.config.ts` sits at `cwd` -- the only case `runInit` scaffolds at the default paths (D3). */
const readExistingConfig = async (
	cwd: string,
	configFilePath: string,
): Promise<HejbroConfig | null> => {
	if (!existsSync(configFilePath)) {
		return null;
	}
	const { config } = await loadConfig(cwd, undefined);
	return config;
};

/**
 * `hejbro init` (decision U7, extended #687): scaffolds `hejbro.config.ts`
 * (via `defineConfig`, with the documented defaults), the migrations
 * directory, and an empty snapshot file (`renderSnapshot(emptySnapshot)`
 * — a `Snapshot` value, not a function call the user would need to run).
 * A `hejbro.config.ts` already on disk is read through `loadConfig` — the
 * loader every other command uses, no second reader — so the last two
 * artifacts land at its `migrationsDir`/`snapshotPath` when it names
 * them, never at a default path `generate` will not read. Idempotent:
 * any artifact that already exists is left byte-untouched and reported
 * as skipped, at the path it was found at; always exits 0, so it doubles
 * as a safe "repair missing pieces" command.
 */
export const runInit = async (cwd: string): Promise<InitResult> => {
	const fallbackIdentity = "init";
	const configFilePath = join(cwd, CONFIG_FILE_NAME);
	try {
		const config = await readExistingConfig(cwd, configFilePath);
		const { migrationsDirPath, snapshotFilePath } = resolveDestinations(
			cwd,
			config,
		);
		const artifacts: ReadonlyArray<Artifact> = [
			{
				kind: "file",
				label: CONFIG_FILE_NAME,
				path: configFilePath,
				content: CONFIG_FILE_CONTENT,
			},
			{
				kind: "dir",
				label: dirLabel(cwd, migrationsDirPath),
				path: migrationsDirPath,
			},
			{
				kind: "file",
				label: fileLabel(cwd, snapshotFilePath),
				path: snapshotFilePath,
				content: renderSnapshot(emptySnapshot),
			},
		];
		const report = artifacts.map((artifact) => applyArtifact(artifact));
		return { report, exitCode: 0, stderr: null };
	} catch (error) {
		const hejbroError = asHejbroError(error);
		const diagnostic = fromHejbroError(
			hejbroError,
			identityFromMessage(hejbroError.message, fallbackIdentity),
		);
		return {
			report: [],
			exitCode: 1,
			stderr: renderDiagnostics([diagnostic], null),
		};
	}
};

/** The `hejbro init` citty subcommand — prints {@link runInit}'s report, one line per artifact. */
export const initCommand = defineCommand({
	meta: {
		name: "init",
		description:
			"Scaffold hejbro.config.ts, the migrations directory, and an empty snapshot file.",
	},
	run: async () => {
		const result = await runInit(process.cwd());
		result.report.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

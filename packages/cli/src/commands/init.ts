import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptySnapshot, renderSnapshot } from "@hejbro/core";
import { defineCommand } from "citty";

const CONFIG_FILE_NAME = "hejbro.config.ts";
const MIGRATIONS_DIR_NAME = "migrations";
const SNAPSHOT_FILE_NAME = "hejbro.snapshot.json";

const CONFIG_FILE_CONTENT = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

/** `hejbro init`'s per-artifact report + always-0 exit code (decision U7). */
export type InitResult = {
	readonly report: ReadonlyArray<string>;
	readonly exitCode: 0;
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
	writeFileSync(artifact.path, artifact.content);
};

const applyArtifact = (artifact: Artifact): string => {
	if (existsSync(artifact.path)) {
		return `skipped ${artifact.label} (exists)`;
	}
	createArtifact(artifact);
	return `created ${artifact.label}`;
};

/**
 * `hejbro init` (decision U7): scaffolds `hejbro.config.ts` (via
 * `defineConfig`, with the documented defaults), the migrations
 * directory, and an empty snapshot file (`renderSnapshot(emptySnapshot)`
 * — a `Snapshot` value, not a function call the user would need to run).
 * Idempotent: any artifact that already exists is left byte-untouched and
 * reported as skipped; always exits 0, so it doubles as a safe
 * "repair missing pieces" command.
 */
export const runInit = (cwd: string): InitResult => {
	const artifacts: ReadonlyArray<Artifact> = [
		{
			kind: "file",
			label: CONFIG_FILE_NAME,
			path: join(cwd, CONFIG_FILE_NAME),
			content: CONFIG_FILE_CONTENT,
		},
		{
			kind: "dir",
			label: `${MIGRATIONS_DIR_NAME}/`,
			path: join(cwd, MIGRATIONS_DIR_NAME),
		},
		{
			kind: "file",
			label: SNAPSHOT_FILE_NAME,
			path: join(cwd, SNAPSHOT_FILE_NAME),
			content: renderSnapshot(emptySnapshot),
		},
	];
	const report = artifacts.map((artifact) => applyArtifact(artifact));
	return { report, exitCode: 0 };
};

/** The `hejbro init` citty subcommand — prints {@link runInit}'s report, one line per artifact. */
export const initCommand = defineCommand({
	meta: {
		name: "init",
		description:
			"Scaffold hejbro.config.ts, the migrations directory, and an empty snapshot file.",
	},
	run: () => {
		const result = runInit(process.cwd());
		result.report.map((line) => console.log(line));
		process.exitCode = result.exitCode;
	},
});

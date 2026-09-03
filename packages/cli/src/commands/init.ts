import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { emptySnapshot, renderSnapshot, throwHejbroError } from "@hejbro/core";
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
	readonly fieldName: string;
};

type DirArtifact = {
	readonly kind: "dir";
	readonly label: string;
	readonly path: string;
	readonly fieldName: string;
};

type Artifact = FileArtifact | DirArtifact;

type NodeKind = "file" | "directory";

const expectedKindOf = (artifact: Artifact): NodeKind => {
	if (artifact.kind === "dir") {
		return "directory";
	}
	return "file";
};

const kindAt = (path: string): NodeKind => {
	if (statSync(path).isDirectory()) {
		return "directory";
	}
	return "file";
};

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` (lead-approved): a configured path exists but holds the
 * wrong kind of node for what it's supposed to be. Nothing is ever
 * replaced, so this stops the run rather than reporting the path as
 * already present. Names `label` (relative to `cwd`, D57/Task 14 --
 * this CLI's own diagnostics never print an absolute path), not the
 * resolved absolute path `checkPathKind` actually stat'd. */
function throwPathConflict(
	label: string,
	fieldName: string,
	expectedKind: NodeKind,
	actualKind: NodeKind,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" was expected to be a ${expectedKind} for ${fieldName}, but a ${actualKind} is there. Next: move or remove the existing ${actualKind} at "${label}", then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a file artifact whose own configured path is
 * spelled with a trailing slash -- a directory spelling for a field
 * that needs a file, refused before even checking what (if anything)
 * exists there: writing a file to such a path fails with a raw,
 * confusing filesystem error instead of this named one. Names `label`
 * (relative to `cwd`), same reasoning as {@link throwPathConflict}. */
function throwSpelledAsDirectory(label: string, fieldName: string): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" names a directory (a trailing "/"), but ${fieldName} needs a file. Next: drop the trailing slash from ${fieldName} in hejbro.config.ts, or point it at a file path.`,
	);
}

/** Refuses before creating anything (checked for every planned artifact
 * before any of them is created): a file artifact whose own path is
 * spelled as a directory, or an existing path that is the wrong kind
 * of node for what `artifact` names. init resolves the same way
 * `generate` does and never normalizes the configured value away --
 * a trailing separator on a file field is refused, not trimmed. */
const checkPathKind = (cwd: string, artifact: Artifact): void => {
	const expectedKind = expectedKindOf(artifact);
	if (expectedKind === "file" && artifact.path.endsWith("/")) {
		// `artifact.label` (`relative()`-derived) has already lost the
		// trailing slash the message needs to show; `dirLabel` keeps it.
		throwSpelledAsDirectory(dirLabel(cwd, artifact.path), artifact.fieldName);
	}
	if (!existsSync(artifact.path)) {
		return;
	}
	const actualKind = kindAt(artifact.path);
	if (actualKind !== expectedKind) {
		throwPathConflict(
			artifact.label,
			artifact.fieldName,
			expectedKind,
			actualKind,
		);
	}
};

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
 * preserved) -- `./` when the resolved path is `cwd` itself (an empty
 * relative path would otherwise render as a bare slash). */
const dirLabel = (cwd: string, path: string): string => {
	const rel = relative(cwd, path);
	if (rel === "") {
		return "./";
	}
	return `${rel}/`;
};

const fileLabel = (cwd: string, path: string): string => relative(cwd, path);

/** A configured field's destination: `resolved` when the configuration
 * names it (or there is no configuration at all, which falls back to
 * the scaffolded default), `not-configured` when a configuration
 * exists but is silent about this one field -- that field then gets no
 * artifact at all (D3 revision, lead-approved): the commands that write
 * migrations refuse without it, so a directory or file created for it
 * would be one nothing reads. */
type DestinationField =
	| { readonly kind: "resolved"; readonly path: string }
	| { readonly kind: "not-configured" };

const resolveField = (
	cwd: string,
	configPresent: boolean,
	value: string | undefined,
	defaultValue: string,
): DestinationField => {
	if (!configPresent) {
		return { kind: "resolved", path: join(cwd, defaultValue) };
	}
	if (value === undefined) {
		return { kind: "not-configured" };
	}
	return { kind: "resolved", path: join(cwd, value) };
};

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

const buildMigrationsArtifact = (
	cwd: string,
	field: DestinationField,
): Artifact | null => {
	if (field.kind === "not-configured") {
		return null;
	}
	return {
		kind: "dir",
		label: dirLabel(cwd, field.path),
		path: field.path,
		fieldName: "migrationsDir",
	};
};

const buildSnapshotArtifact = (
	cwd: string,
	field: DestinationField,
): Artifact | null => {
	if (field.kind === "not-configured") {
		return null;
	}
	return {
		kind: "file",
		label: fileLabel(cwd, field.path),
		path: field.path,
		content: renderSnapshot(emptySnapshot),
		fieldName: "snapshotPath",
	};
};

/** `applyArtifact`'s report line for a field's own artifact, or the
 * "not configured" line when the configuration was silent about it
 * (there is no artifact to apply in that case). */
const reportLineFor = (
	artifact: Artifact | null,
	notConfiguredLine: string,
): string => {
	if (artifact === null) {
		return notConfiguredLine;
	}
	return applyArtifact(artifact);
};

/**
 * `hejbro init` (decision U7, extended #687): scaffolds `hejbro.config.ts`
 * (via `defineConfig`, with the documented defaults), the migrations
 * directory, and an empty snapshot file (`renderSnapshot(emptySnapshot)`
 * — a `Snapshot` value, not a function call the user would need to run).
 * A `hejbro.config.ts` already on disk is read through `loadConfig` — the
 * loader every other command uses, no second reader — so the last two
 * artifacts land at its `migrationsDir`/`snapshotPath` when it names
 * them, never at a default path `generate` will not read. A field the
 * configuration omits gets no artifact and a "not configured" report
 * line instead of a default-path fallback (D3 revision). Idempotent:
 * any artifact that already exists is left byte-untouched and reported
 * as skipped, at the path it was found at; a path holding the wrong
 * kind of node refuses instead of being treated as present. Always
 * exits 0 on success, so it doubles as a safe "repair missing pieces"
 * command.
 */
export const runInit = async (cwd: string): Promise<InitResult> => {
	const fallbackIdentity = "init";
	const configFilePath = join(cwd, CONFIG_FILE_NAME);
	try {
		const config = await readExistingConfig(cwd, configFilePath);
		const configPresent = config !== null;
		const migrationsField = resolveField(
			cwd,
			configPresent,
			config?.migrationsDir,
			DEFAULT_MIGRATIONS_DIR,
		);
		const snapshotField = resolveField(
			cwd,
			configPresent,
			config?.snapshotPath,
			DEFAULT_SNAPSHOT_PATH,
		);

		const configArtifact: Artifact = {
			kind: "file",
			label: CONFIG_FILE_NAME,
			path: configFilePath,
			content: CONFIG_FILE_CONTENT,
			fieldName: "hejbro.config.ts",
		};
		const migrationsArtifact = buildMigrationsArtifact(cwd, migrationsField);
		const snapshotArtifact = buildSnapshotArtifact(cwd, snapshotField);

		// Every planned artifact's path kind is checked before any of
		// them is created -- a conflict discovered on the snapshot must
		// not leave a just-created config file or migrations directory
		// behind it.
		const plannedArtifacts: ReadonlyArray<Artifact> = [
			configArtifact,
			migrationsArtifact,
			snapshotArtifact,
		].filter((artifact): artifact is Artifact => artifact !== null);
		plannedArtifacts.map((artifact) => checkPathKind(cwd, artifact));

		const report = [
			applyArtifact(configArtifact),
			reportLineFor(migrationsArtifact, "migrationsDir not configured"),
			reportLineFor(snapshotArtifact, "snapshotPath not configured"),
		];
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

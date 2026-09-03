import {
	existsSync,
	mkdirSync,
	type Stats,
	statSync,
	writeFileSync,
} from "node:fs";
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

const kindOfStat = (stat: Stats): NodeKind => {
	if (stat.isDirectory()) {
		return "directory";
	}
	return "file";
};

/** A configured path's trailing `/`s dropped before it is stat'd -- POSIX
 * `stat()` on a path spelled with a trailing separator refuses with
 * `ENOTDIR` when the node there is a file (D106 R1 B1), which made
 * `existsSync` report "nothing there" and let a later `mkdirSync` throw a
 * raw, uncoded stack instead of this command's own diagnostic. */
const stripTrailingSeparators = (path: string): string =>
	path.replace(/\/+$/, "");

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` (lead-approved): a configured path exists but holds the
 * wrong kind of node for what it's supposed to be. Nothing is ever
 * replaced, so this stops the run rather than reporting the path as
 * already present. The header and the main sentence name `label`
 * exactly as the user configured it (relative to `cwd`, D57/Task 14 --
 * this CLI's own diagnostics never print an absolute path); the `Next:`
 * clause names the real node instead (D106 R1, lead-approved option A):
 * a directory-style label always carries a trailing separator
 * (`dirLabel`) even when the node found there is a file, and a file
 * cannot be "at" a path spelled with one, so the actionable path in
 * `Next:` drops it. */
function throwPathConflict(
	label: string,
	fieldName: string,
	expectedKind: NodeKind,
	actualKind: NodeKind,
): never {
	const realLabel = stripTrailingSeparators(label);
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" was expected to be a ${expectedKind} for ${fieldName}, but a ${actualKind} is there. Next: move or remove the existing ${actualKind} at "${realLabel}", then rerun \`hejbro init\`.`,
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

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a file sitting in a planned artifact's own ancestor
 * chain (D106 R1 N1) -- distinct wording from {@link throwPathConflict}
 * (`to hold ${fieldName}` rather than `for ${fieldName}`) because
 * `label` here is an ancestor of the field's own configured path, not
 * that path itself. */
function throwAncestorConflict(
	label: string,
	fieldName: string,
	actualKind: NodeKind,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" was expected to be a directory to hold ${fieldName}, but a ${actualKind} is there. Next: move or remove the existing ${actualKind} at "${label}", then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a `stat` failure other than "nothing is there"
 * (D106 R1 B1) -- an `EACCES`/`ELOOP`/etc, named by the operating
 * system's own code instead of the raw Node stack this CLI's
 * diagnostics never print (D57). */
function throwStatFailed(
	label: string,
	fieldName: string,
	code: string,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" could not be checked for ${fieldName} (${code}). Next: check permissions on "${label}", then rerun \`hejbro init\`.`,
	);
}

/** The operating system's own error code off a caught `fs` failure, or
 * `"unknown"` when the thrown value carries none -- never the raw error
 * object, which a diagnostic must not print (D57). */
const errorCode = (error: unknown): string => {
	if (error !== null && typeof error === "object" && "code" in error) {
		return String((error as NodeJS.ErrnoException).code);
	}
	return "unknown";
};

type StatOutcome =
	| { readonly kind: "absent" }
	| { readonly kind: "present"; readonly actualKind: NodeKind }
	| { readonly kind: "stat-failed"; readonly code: string };

/** `stat`'s own three outcomes at `path` (already trailing-separator-
 * stripped by the caller, D106 R1 B1): the node's kind, "nothing is
 * there" (`ENOENT` only), or any other failure, carried as data instead
 * of being decided by a bare `existsSync` that a trailing separator can
 * make silently `false` for a file that is really there. */
const statOutcomeAt = (path: string): StatOutcome => {
	try {
		return { kind: "present", actualKind: kindOfStat(statSync(path)) };
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT") {
			return { kind: "absent" };
		}
		return { kind: "stat-failed", code };
	}
};

type AncestorOutcome =
	| { readonly kind: "ok" }
	| {
			readonly kind: "conflict";
			readonly path: string;
			readonly actualKind: NodeKind;
	  }
	| {
			readonly kind: "stat-failed";
			readonly path: string;
			readonly code: string;
	  };

/** Walks `path`'s own chain of parents upward (never `path` itself --
 * callers pass an artifact's `dirname`), continuing past both `ENOENT`
 * ("nothing there yet") and `ENOTDIR` (a `stat` below a file ancestor
 * fails this way too, D106 R1 N1 -- stopping there instead of
 * continuing up would name the deepest segment tried, not the file
 * actually blocking the chain) until a `stat` succeeds. Recursive,
 * never a loop (`check:bans`); `dirname` of the filesystem root is
 * itself, which ends the recursion even in the case nothing on the way
 * up ever exists. */
const walkAncestors = (path: string): AncestorOutcome => {
	try {
		const stat = statSync(path);
		if (stat.isDirectory()) {
			return { kind: "ok" };
		}
		return { kind: "conflict", path, actualKind: "file" };
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT" || code === "ENOTDIR") {
			const parent = dirname(path);
			if (parent === path) {
				return { kind: "ok" };
			}
			return walkAncestors(parent);
		}
		return { kind: "stat-failed", path, code };
	}
};

/** Refuses before creating anything: a file sitting somewhere in a
 * planned artifact's own directory chain, not just at its leaf
 * (D106 R1 N1). Runs before {@link checkPathKind}: a leaf whose own
 * `stat` also fails with `ENOTDIR` (because an ancestor, not the leaf,
 * is the file) is named here by the ancestor that actually blocks it,
 * instead of by the leaf with a bare OS code. Labelled with
 * {@link fileLabel} (no trailing separator, D106 R1 lead-approved
 * option A extended to ancestors): unlike a leaf's own field, no user
 * ever spelled this path with a trailing slash for this function to
 * preserve -- it is derived from a nested field's own value, so both
 * the quote and the `Next:` clause name the one real path. */
const checkAncestors = (cwd: string, artifact: Artifact): void => {
	const outcome = walkAncestors(dirname(artifact.path));
	if (outcome.kind === "ok") {
		return;
	}
	const label = fileLabel(cwd, outcome.path);
	if (outcome.kind === "conflict") {
		throwAncestorConflict(label, artifact.fieldName, outcome.actualKind);
	}
	throwStatFailed(label, artifact.fieldName, outcome.code);
};

/** Refuses before creating anything (checked for every planned artifact
 * before any of them is created): a file artifact whose own path is
 * spelled as a directory, or an existing path that is the wrong kind
 * of node for what `artifact` names. init resolves the same way
 * `generate` does and never normalizes the configured value away --
 * a trailing separator on a file field is refused, not trimmed. The
 * presence/kind check itself does strip trailing separators before
 * stat'ing (D106 R1 B1): a directory field honours `"mig/"` the same as
 * `"mig"`, so the check that path is inspected under must too, or a file
 * sitting there escapes it and reaches a raw `mkdirSync` crash instead. */
const checkPathKind = (cwd: string, artifact: Artifact): void => {
	const expectedKind = expectedKindOf(artifact);
	if (expectedKind === "file" && artifact.path.endsWith("/")) {
		// `artifact.label` (`relative()`-derived) has already lost the
		// trailing slash the message needs to show; `dirLabel` keeps it.
		throwSpelledAsDirectory(dirLabel(cwd, artifact.path), artifact.fieldName);
	}
	const outcome = statOutcomeAt(stripTrailingSeparators(artifact.path));
	if (outcome.kind === "absent") {
		return;
	}
	if (outcome.kind === "stat-failed") {
		throwStatFailed(artifact.label, artifact.fieldName, outcome.code);
	}
	if (outcome.kind === "present" && outcome.actualKind !== expectedKind) {
		throwPathConflict(
			artifact.label,
			artifact.fieldName,
			expectedKind,
			outcome.actualKind,
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

/** A file's report/refusal label -- `./` when the resolved path is
 * `cwd` itself (`snapshotPath: ""`/`"."`), same reasoning as
 * {@link dirLabel}: an empty relative path names nothing on its own,
 * and a refusal naming it needs a real identifier to print (D57-enriched
 * messages carry a short one, never an empty string). */
const fileLabel = (cwd: string, path: string): string => {
	const rel = relative(cwd, path);
	if (rel === "") {
		return "./";
	}
	return rel;
};

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
		// behind it. The ancestor chain (D106 R1 N1) is checked before
		// the leaf's own kind (3.1/checkPathKind): a leaf blocked by a
		// file ancestor is named by that ancestor, not by the leaf.
		const plannedArtifacts: ReadonlyArray<Artifact> = [
			configArtifact,
			migrationsArtifact,
			snapshotArtifact,
		].filter((artifact): artifact is Artifact => artifact !== null);
		plannedArtifacts.forEach((artifact) => {
			checkAncestors(cwd, artifact);
			checkPathKind(cwd, artifact);
		});

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

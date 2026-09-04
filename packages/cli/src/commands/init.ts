import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { emptySnapshot, renderSnapshot, throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import type { HejbroConfig } from "../config";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { identityFromMessage } from "../identity";
import { configFlagFrom, loadConfig, resolveConfigPath } from "../loader";
import {
	errorCode,
	type NodeKind,
	probePath,
	stripTrailingSeparators,
} from "../path-probe";

const CONFIG_FILE_NAME = "hejbro.config.ts";
const DEFAULT_MIGRATIONS_DIR = "migrations";
const DEFAULT_SNAPSHOT_PATH = "hejbro.snapshot.json";

const INIT_ARGS = {
	config: {
		type: "string",
		description: "path to hejbro.config.ts (default: ./hejbro.config.ts)",
	},
} as const;

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

const expectedKindOf = (artifact: Artifact): NodeKind => {
	if (artifact.kind === "dir") {
		return "directory";
	}
	return "file";
};

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
 * `HejbroError` for two configured fields whose resolved paths are the
 * same node (D106 R1 N2): creating the first would make the second's
 * own `existsSync` check report it as already present -- "tells a
 * repair run that a broken project is whole", the very thing this
 * command's idempotence promise forbids. Labelled with {@link fileLabel}
 * (D106 R1 lead-approved option A extended, same reasoning as
 * {@link throwAncestorConflict}): no user spelled this one shared path
 * for both fields at once, so there is no single field's own spelling
 * to preserve. */
function throwDuplicatePath(
	label: string,
	firstField: string,
	secondField: string,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" is named by both ${firstField} and ${secondField}. Next: point them at two different paths, then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a planned file whose own path would have to hold
 * another planned artifact (#766, D3): a planned file cannot hold a
 * planned node, and `checkNoDuplicatePaths`'s equality check does not
 * see containment. Both labels via {@link fileLabel} -- the directory
 * field's usual trailing-slash label would misstate a path that is
 * being refused, not created. */
function throwNestedPathConflict(
	fileNodeLabel: string,
	fileFieldName: string,
	otherLabel: string,
	otherFieldName: string,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${fileNodeLabel}" is named by ${fileFieldName}, and ${otherFieldName} ("${otherLabel}") would have to be created inside it — a file cannot hold a directory. Next: point ${fileFieldName} at a file outside ${otherFieldName}, then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a `stat` failure other than "nothing is there"
 * (D106 R1 B1) -- an `EACCES`/`ELOOP`/etc, named by the operating
 * system's own code instead of the raw Node stack this CLI's
 * diagnostics never print (D57). `culprit` is the node whose permissions
 * actually block the check (#768, D4) -- equal to `label` for every
 * non-permission failure, which keeps today's one-sentence wording;
 * different from it only when a permission failure was traced to an
 * ancestor, which adds the sentence naming that ancestor. `stat`'s
 * `EACCES` is always a directory on the way, never the leaf. The
 * non-permission branch's own `Next:` names what the failing node
 * *points at*, not its permissions (#767 review, D8 non-blocking 3): a
 * loop (`ELOOP`) is never a permission problem. */
function throwStatFailed(
	label: string,
	fieldName: string,
	code: string,
	culprit: string,
): never {
	if (culprit === label) {
		return throwHejbroError(
			"init-path-conflict",
			`"${label}" could not be checked for ${fieldName} (${code}). Next: check what "${label}" points at, then rerun \`hejbro init\`.`,
		);
	}
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" could not be checked for ${fieldName} (${code}): "${culprit}" does not let this process look inside it. Next: check permissions on "${culprit}", then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for an absent artifact whose deepest existing ancestor
 * denies this process permission to *write* into it (#767 review, D6
 * check side) -- distinct wording from {@link throwStatFailed} (`cannot
 * be created for` / `write into it`, not `could not be checked for` /
 * `look inside it`): the stat pass proves the tree's shape, not that
 * this process may add to it. */
function throwNotWritable(
	label: string,
	fieldName: string,
	code: string,
	culprit: string,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" cannot be created for ${fieldName} (${code}): "${culprit}" does not let this process write into it. Next: check permissions on "${culprit}", then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a creation that fails for a reason other than
 * permissions (#767 review, D6 create side) -- `ENOSPC`, `EDQUOT`, etc.
 * Names the node the operating system itself named, since there is no
 * ancestor to blame the way {@link throwNotWritable} does. */
function throwCreateDiskFailed(
	label: string,
	fieldName: string,
	code: string,
	path: string,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" cannot be created for ${fieldName} (${code}): "${path}" refused it. Next: check the disk and permissions at "${path}", then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a dangling symbolic link at an artifact's own leaf
 * (#767 review, D8): `statSync` follows a link, so a dangling one reads
 * as absent and a write would go straight through it to a target the
 * report never named. Judged by what it points at, not treated as
 * absent. */
function throwDanglingLink(
	label: string,
	fieldName: string,
	expectedKind: NodeKind,
	target: string,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" was expected to be a ${expectedKind} for ${fieldName}, but a dangling symbolic link is there, pointing at "${target}". Next: remove the link or create its target, then rerun \`hejbro init\`.`,
	);
}

/** Builds and throws the `init-path-conflict`-coded, enriched plain
 * `HejbroError` for a dangling symbolic link sitting in a planned
 * artifact's own ancestor chain (#767 review, D8) -- distinct wording
 * from {@link throwDanglingLink}, same reasoning as
 * {@link throwAncestorConflict} vs {@link throwPathConflict}. */
function throwAncestorDanglingLink(
	label: string,
	fieldName: string,
	target: string,
): never {
	return throwHejbroError(
		"init-path-conflict",
		`"${label}" was expected to be a directory to hold ${fieldName}, but a dangling symbolic link is there, pointing at "${target}". Next: remove the link or create its target, then rerun \`hejbro init\`.`,
	);
}

/** The operating system's own `path` off a caught `fs` failure, or
 * `fallback` when the thrown value carries none (#767 review, D6 create
 * side) -- never the raw error object (D57). */
const errorPath = (error: unknown, fallback: string): string => {
	if (error !== null && typeof error === "object" && "path" in error) {
		const path = (error as NodeJS.ErrnoException).path;
		if (typeof path === "string") {
			return path;
		}
	}
	return fallback;
};

type ArtifactPair = readonly [Artifact, Artifact];

/** Every unordered pair of `artifacts`, each appearing once, in the
 * artifacts' own relative order -- built with `flatMap`/`slice`, never
 * a nested loop (`check:bans`). */
const artifactPairs = (
	artifacts: ReadonlyArray<Artifact>,
): ReadonlyArray<ArtifactPair> =>
	artifacts.flatMap((artifact, index) =>
		artifacts.slice(index + 1).map((other): ArtifactPair => [artifact, other]),
	);

/** Refuses before creating anything: two planned artifacts whose
 * resolved paths are the same node (D106 R1 N2). Compared after
 * stripping trailing separators -- the comparison is of resolved
 * paths, not of spellings (`"mig/"` and `"mig"` name the same path). */
const checkNoDuplicatePaths = (
	cwd: string,
	artifacts: ReadonlyArray<Artifact>,
): void => {
	const duplicate = artifactPairs(artifacts).find(
		([a, b]) =>
			stripTrailingSeparators(a.path) === stripTrailingSeparators(b.path),
	);
	if (duplicate === undefined) {
		return;
	}
	const [first, second] = duplicate;
	throwDuplicatePath(
		fileLabel(cwd, first.path),
		first.fieldName,
		second.fieldName,
	);
};

/** Whether `filePath` (a planned file artifact's own path, separator-
 * stripped) is a strict ancestor of `otherPath` (also stripped): a
 * planned file cannot hold a planned node, and the equality check above
 * does not see containment (#766, D3). `relative` returning a segment
 * that neither escapes (`..`) nor is itself absolute means `otherPath`
 * sits somewhere inside `filePath`. */
const isStrictAncestor = (filePath: string, otherPath: string): boolean => {
	const rel = relative(
		stripTrailingSeparators(filePath),
		stripTrailingSeparators(otherPath),
	);
	return rel !== "" && !isAbsolute(rel) && !rel.startsWith("..");
};

type NestedConflict = { readonly file: Artifact; readonly other: Artifact };

/** `pair` labelled as a nested conflict when either side is a file
 * artifact whose own path would have to hold the other's -- checked in
 * both orientations, since `artifactPairs` fixes no kind to either
 * position. */
const nestedConflictIn = (pair: ArtifactPair): NestedConflict | null => {
	const [a, b] = pair;
	if (a.kind === "file" && isStrictAncestor(a.path, b.path)) {
		return { file: a, other: b };
	}
	if (b.kind === "file" && isStrictAncestor(b.path, a.path)) {
		return { file: b, other: a };
	}
	return null;
};

/** Refuses before creating anything, and before any disk-based check
 * (D3, lead ruling): a planned file that would have to hold another
 * planned path is a fault in the configuration itself, so it answers
 * whatever already sits on disk -- the same priority the duplicate
 * check above already gives an equal-path fault over a wrong-kind one. */
const checkNoNestedPaths = (
	cwd: string,
	artifacts: ReadonlyArray<Artifact>,
): void => {
	const conflict = artifactPairs(artifacts)
		.map(nestedConflictIn)
		.find((candidate): candidate is NestedConflict => candidate !== null);
	if (conflict === undefined) {
		return;
	}
	throwNestedPathConflict(
		fileLabel(cwd, conflict.file.path),
		conflict.file.fieldName,
		fileLabel(cwd, conflict.other.path),
		conflict.other.fieldName,
	);
};

/** Refuses before creating anything (checked for every planned artifact,
 * the configuration artifact included, before any of them is created):
 * ancestors first -- a file, a dangling link or a blocked directory on
 * the way is named as that node, never as the leaf with a bare
 * operating-system code (D106 R1 N1, #768 D4) -- then the leaf's own
 * kind, judged by what it points at when it is a symbolic link (#767
 * review, D8). One `probePath` call (#846 D2) replaces the ancestor walk
 * and the leaf stat this used to be two separate functions for. init
 * resolves the same way `generate` does and never normalizes the
 * configured value away. A `snapshotPath` spelled as a directory never
 * reaches this check at all (#846 D1): `parseConfig` refuses that
 * spelling when the configuration is read, before `init` builds any
 * artifact from it. The presence/kind check itself does strip trailing
 * separators before stat'ing (D106 R1 B1): a directory field honours
 * `"mig/"` the same as `"mig"`, so the path probed under must too, or a
 * file sitting there escapes it and reaches a raw `mkdirSync` crash
 * instead. */
const checkArtifactPath = (cwd: string, artifact: Artifact): void => {
	const expectedKind = expectedKindOf(artifact);
	const strippedPath = stripTrailingSeparators(artifact.path);
	const outcome = probePath(cwd, strippedPath);
	if (outcome.kind === "absent") {
		return;
	}
	if (outcome.kind === "present") {
		if (outcome.actualKind !== expectedKind) {
			throwPathConflict(
				artifact.label,
				artifact.fieldName,
				expectedKind,
				outcome.actualKind,
			);
		}
		return;
	}
	if (outcome.kind === "dangling") {
		throwDanglingLink(
			artifact.label,
			artifact.fieldName,
			expectedKind,
			outcome.target,
		);
	}
	if (outcome.kind === "ancestor-file") {
		throwAncestorConflict(
			fileLabel(cwd, outcome.path),
			artifact.fieldName,
			"file",
		);
	}
	if (outcome.kind === "ancestor-dangling") {
		throwAncestorDanglingLink(
			fileLabel(cwd, outcome.path),
			artifact.fieldName,
			outcome.target,
		);
	}
	if (outcome.kind === "blocked") {
		throwStatFailed(
			artifact.label,
			artifact.fieldName,
			outcome.code,
			fileLabel(cwd, outcome.culprit),
		);
	}
	// "stat-failed" is shared by the ancestor walk and the leaf's own
	// stat (#846 D2): the leaf when its own path is the one that failed,
	// an ancestor otherwise. `probePath` itself already resolves an
	// `EACCES`/`EPERM` to "blocked" (above, #846 D2 step 0), so every
	// outcome that reaches here is a non-permission code (`ELOOP` and the
	// rest) -- its culprit is always the same node the message names,
	// never a walked one.
	if (outcome.path === strippedPath) {
		throwStatFailed(
			artifact.label,
			artifact.fieldName,
			outcome.code,
			artifact.label,
		);
	}
	const label = fileLabel(cwd, outcome.path);
	throwStatFailed(label, artifact.fieldName, outcome.code, label);
};

/** Refuses before creating anything (#767 review, D6 check side; runs
 * after the kind/ancestor pass, over every planned artifact): an absent
 * artifact whose deepest existing ancestor (`probePath`'s own `parent`
 * for an absent outcome, #846 D2) denies this process permission to
 * write into it. The stat pass above proves the tree's shape, not that
 * this process may add to it. An artifact already present is never
 * checked -- it will be skipped, not created. */
const checkWritable = (
	cwd: string,
	artifacts: ReadonlyArray<Artifact>,
): void => {
	artifacts.forEach((artifact) => {
		const outcome = probePath(cwd, stripTrailingSeparators(artifact.path));
		if (outcome.kind !== "absent") {
			// Already present, or already refused by checkArtifactPath,
			// above -- unreachable for anything but "absent".
			return;
		}
		try {
			accessSync(outcome.parent, constants.W_OK);
		} catch (error) {
			throwNotWritable(
				artifact.label,
				artifact.fieldName,
				errorCode(error),
				fileLabel(cwd, outcome.parent),
			);
		}
	});
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

/** The first node this run's own creation of `artifact` would add
 * (#767 review, D6 create side): the deepest existing ancestor
 * (`probePath`'s own `parent` for an absent outcome, already proven
 * writable by {@link checkWritable}) joined with the next path segment
 * on the way to `artifact.path` -- computed before creating anything,
 * since a `mkdirSync(recursive)` that fails part-way reports nothing
 * about which segments it made. That single node is what a rollback
 * removes: `rmSync(..., { recursive: true })` clears everything under
 * it. */
const firstNodeToCreate = (cwd: string, artifact: Artifact): string => {
	const outcome = probePath(cwd, stripTrailingSeparators(artifact.path));
	if (outcome.kind !== "absent") {
		// Already refused by checkArtifactPath/checkWritable -- unreachable.
		return artifact.path;
	}
	const remainder = relative(outcome.parent, artifact.path);
	const firstSegment = remainder.split("/")[0] ?? remainder;
	return join(outcome.parent, firstSegment);
};

/** Builds and throws the coded failure for a creation that still fails
 * after every check (#767 review, D6 create side): `access` can be
 * wrong (ACLs, immutable flags, a disk that fills, a race), so the
 * create step is the one place a failure can still surface raw. For
 * `EACCES`/`EPERM` the culprit is the directory that refused the write
 * -- `dirname(error.path)` -- in {@link throwNotWritable}'s own
 * sentence; any other code names `error.path` itself through
 * {@link throwCreateDiskFailed}. */
const throwCreateFailed = (
	cwd: string,
	artifact: Artifact,
	error: unknown,
): never => {
	const code = errorCode(error);
	const rawPath = errorPath(error, artifact.path);
	if (code === "EACCES" || code === "EPERM") {
		throwNotWritable(
			artifact.label,
			artifact.fieldName,
			code,
			fileLabel(cwd, dirname(rawPath)),
		);
	}
	throwCreateDiskFailed(
		artifact.label,
		artifact.fieldName,
		code,
		fileLabel(cwd, rawPath),
	);
};

/** Removes every node this run created, deepest (most recently created)
 * first (#767 review, D6 create side) -- `force: true` makes removing a
 * node that was never actually created (the check-side `access` proved
 * wrong before anything reached disk) a silent no-op rather than a
 * second error hiding the first. */
const rollbackCreated = (created: ReadonlyArray<string>): void => {
	[...created].reverse().forEach((path) => {
		rmSync(path, { recursive: true, force: true });
	});
};

/** One line of `runInit`'s report: either a fixed line (a field the
 * configuration was silent about) or a planned artifact to apply. */
type ReportStep =
	| { readonly kind: "fixed"; readonly line: string }
	| { readonly kind: "artifact"; readonly artifact: Artifact };

const reportStepFor = (
	artifact: Artifact | null,
	notConfiguredLine: string,
): ReportStep => {
	if (artifact === null) {
		return { kind: "fixed", line: notConfiguredLine };
	}
	return { kind: "artifact", artifact };
};

/** The apply pass's own running state: the report built so far, and
 * every node *this run* has created (#767 review, D6 create side) -- an
 * artifact found already present never joins `created`, so a rollback
 * never removes something the run didn't make. */
type ApplyState = {
	readonly report: ReadonlyArray<string>;
	readonly created: ReadonlyArray<string>;
};

/** Applies one `ReportStep` against `state`, returning the next state --
 * `runInit`'s own `reduce` step (#767 review, D6 create side; never a
 * loop, `check:bans`). On a creation that still fails, rolls back every
 * node accumulated in `state.created` *and* this step's own first node
 * (a partially-made `mkdirSync(recursive)` tree included) before
 * throwing the coded failure -- a refused run leaves the project as it
 * found it. */
const applyStep = (
	cwd: string,
	state: ApplyState,
	step: ReportStep,
): ApplyState => {
	if (step.kind === "fixed") {
		return { report: [...state.report, step.line], created: state.created };
	}
	const { artifact } = step;
	if (existsSync(artifact.path)) {
		return {
			report: [...state.report, `skipped ${artifact.label} (exists)`],
			created: state.created,
		};
	}
	const firstNode = firstNodeToCreate(cwd, artifact);
	const created = [...state.created, firstNode];
	try {
		createArtifact(artifact);
	} catch (error) {
		rollbackCreated(created);
		throwCreateFailed(cwd, artifact, error);
	}
	return { report: [...state.report, `created ${artifact.label}`], created };
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

/** `null` when nothing sits at `configFilePath` -- the only case `runInit`
 * scaffolds at the default paths (D3). `configFlag` is passed through to
 * `loadConfig` unchanged (#741, D1): it resolves the same path a second
 * time internally, which is the one resolver (`resolveConfigPath`) every
 * command shares, never a second one. */
const readExistingConfig = async (
	cwd: string,
	configFilePath: string,
	configFlag: string | undefined,
): Promise<HejbroConfig | null> => {
	if (!existsSync(configFilePath)) {
		return null;
	}
	const { config } = await loadConfig(cwd, configFlag);
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
export const runInit = async (
	cwd: string,
	rawArgs: ReadonlyArray<string> = [],
): Promise<InitResult> => {
	const fallbackIdentity = "init";
	const configFlag = configFlagFrom(rawArgs);
	try {
		// `resolveConfigPath` itself refuses an empty --config value
		// (#846 D5) -- inside the try so that refusal renders through the
		// same coded-diagnostic path as every other one here, instead of
		// escaping as a raw, unrendered throw.
		const configFilePath = resolveConfigPath(cwd, configFlag);
		const configArtifact: Artifact = {
			kind: "file",
			label: fileLabel(cwd, configFilePath),
			path: configFilePath,
			content: CONFIG_FILE_CONTENT,
			fieldName: CONFIG_FILE_NAME,
		};
		// The configuration's own kind is checked before it is loaded
		// (D106 R1 N3): the requirement already names the configuration
		// among the artifacts whose wrong-kind path stops the run, but
		// the loader would otherwise answer first, with a config-load-
		// failed diagnostic about import resolution instead of this one.
		checkArtifactPath(cwd, configArtifact);
		const config = await readExistingConfig(cwd, configFilePath, configFlag);
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

		const migrationsArtifact = buildMigrationsArtifact(cwd, migrationsField);
		const snapshotArtifact = buildSnapshotArtifact(cwd, snapshotField);

		// Every planned artifact's path is checked before any of them is
		// created -- a conflict discovered on the snapshot must not leave
		// a just-created config file or migrations directory behind it.
		// Two fields resolving to the same path (D106 R1 N2) are checked
		// first: creating one would make the other's own existsSync check
		// see it as already present. checkArtifactPath itself judges the
		// ancestor chain (D106 R1 N1) before the leaf's own kind (#846
		// D2): a leaf blocked by a file ancestor is named by that
		// ancestor, not by the leaf.
		const plannedArtifacts: ReadonlyArray<Artifact> = [
			configArtifact,
			migrationsArtifact,
			snapshotArtifact,
		].filter((artifact): artifact is Artifact => artifact !== null);
		checkNoDuplicatePaths(cwd, plannedArtifacts);
		checkNoNestedPaths(cwd, plannedArtifacts);
		plannedArtifacts.forEach((artifact) => {
			checkArtifactPath(cwd, artifact);
		});
		checkWritable(cwd, plannedArtifacts);

		const reportSteps: ReadonlyArray<ReportStep> = [
			{ kind: "artifact", artifact: configArtifact },
			reportStepFor(migrationsArtifact, "migrationsDir not configured"),
			reportStepFor(snapshotArtifact, "snapshotPath not configured"),
		];
		const { report } = reportSteps.reduce<ApplyState>(
			(state, step) => applyStep(cwd, state, step),
			{ report: [], created: [] },
		);
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
	args: INIT_ARGS,
	run: async (ctx) => {
		const result = await runInit(process.cwd(), ctx.rawArgs);
		result.report.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

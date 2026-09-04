import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	type Stats,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { emptySnapshot, renderSnapshot, throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import type { HejbroConfig } from "../config";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";
import { identityFromMessage } from "../identity";
import { loadConfig, resolveConfigPath } from "../loader";

const CONFIG_FILE_NAME = "hejbro.config.ts";
const DEFAULT_MIGRATIONS_DIR = "migrations";
const DEFAULT_SNAPSHOT_PATH = "hejbro.snapshot.json";

const INIT_ARGS = {
	config: {
		type: "string",
		description: "path to hejbro.config.ts (default: ./hejbro.config.ts)",
	},
} as const;

const lastFlagValue = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): string | undefined => {
	const values = rawArgs.flatMap((token, index) => {
		if (token !== flagName) {
			return [];
		}
		const value = rawArgs[index + 1];
		if (value === undefined) {
			return [];
		}
		return [value];
	});
	return values.at(-1);
};

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

/** The operating system's own error code off a caught `fs` failure, or
 * `"unknown"` when the thrown value carries none -- never the raw error
 * object, which a diagnostic must not print (D57). */
const errorCode = (error: unknown): string => {
	if (error !== null && typeof error === "object" && "code" in error) {
		return String((error as NodeJS.ErrnoException).code);
	}
	return "unknown";
};

/** `readlinkSync(path)`'s own target, printed relative to `cwd` when the
 * link was written as an absolute path (D57 -- this CLI's diagnostics
 * never print an absolute path); a relative target is printed exactly
 * as the link spells it, which is also how POSIX resolves it (from the
 * link's own directory, not `cwd`). */
const symlinkTargetLabel = (cwd: string, path: string): string => {
	const target = readlinkSync(path);
	if (isAbsolute(target)) {
		return relative(cwd, target);
	}
	return target;
};

type StatOutcome =
	| { readonly kind: "absent" }
	| { readonly kind: "present"; readonly actualKind: NodeKind }
	| { readonly kind: "dangling"; readonly target: string }
	| { readonly kind: "stat-failed"; readonly code: string };

/** `stat`'s own outcomes at `path` (already trailing-separator-stripped
 * by the caller, D106 R1 B1): the node's kind, "nothing is there"
 * (`ENOENT` only), a dangling symbolic link (#767 review, D8 -- `stat`
 * follows a link and a dangling one also fails `ENOENT`, indistinguish-
 * able from "nothing there" without `lstat`ing first), or any other
 * failure. `lstat`s first: a non-link node's `lstat` already carries its
 * kind, so only a link needs the second, following `stat`. Carried as
 * data instead of being decided by a bare `existsSync` that a trailing
 * separator can make silently `false` for a file that is really there. */
const statOutcomeAt = (cwd: string, path: string): StatOutcome => {
	try {
		const lstat = lstatSync(path);
		if (!lstat.isSymbolicLink()) {
			return { kind: "present", actualKind: kindOfStat(lstat) };
		}
		try {
			return { kind: "present", actualKind: kindOfStat(statSync(path)) };
		} catch (error) {
			const code = errorCode(error);
			if (code === "ENOENT") {
				return { kind: "dangling", target: symlinkTargetLabel(cwd, path) };
			}
			return { kind: "stat-failed", code };
		}
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT") {
			return { kind: "absent" };
		}
		return { kind: "stat-failed", code };
	}
};

/** A dangling symbolic link at `path`, or `null` when `path` isn't one
 * (including "nothing there at all") -- {@link walkAncestors}'s own
 * probe for the same fault {@link statOutcomeAt} detects at a leaf,
 * since `statSync` alone can't tell "dangling link" from "absent"
 * (#767 review, D8). */
const danglingLinkTargetAt = (cwd: string, path: string): string | null => {
	try {
		const lstat = lstatSync(path);
		if (!lstat.isSymbolicLink()) {
			return null;
		}
		return symlinkTargetLabel(cwd, path);
	} catch {
		return null;
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
			readonly kind: "dangling";
			readonly path: string;
			readonly target: string;
	  }
	| {
			readonly kind: "stat-failed";
			readonly path: string;
			readonly code: string;
	  }
	| {
			readonly kind: "blocked";
			readonly culprit: string;
			readonly code: string;
	  };

/** `path`'s own chain of parents, one level up (never `path` itself). */
const parentOf = (path: string): string => dirname(path);

/** Walks `path`'s own chain of parents upward (never `path` itself --
 * callers pass an artifact's `dirname`), continuing past `ENOENT`
 * ("nothing there yet", unless a dangling symbolic link sits there --
 * #767 review, D8, which conflicts instead), `ENOTDIR` (a `stat` below a
 * file ancestor fails this way too, D106 R1 N1 -- stopping there instead
 * of continuing up would name the deepest segment tried, not the file
 * actually blocking the chain) and `EACCES`/`EPERM` (#768, D4 -- `stat`
 * fails this way for a directory it cannot search into, never for the
 * leaf itself, so the node it finally does stat successfully is the one
 * that blocks the lookup) until a `stat` succeeds. `permissionCode`
 * carries the first permission failure seen on the way up (or is seeded
 * by a caller that already knows its own leaf failed that way); once a
 * `stat` succeeds while carrying one, that node is the blocking one, not
 * an "ok" ancestor. Recursive, never a loop (`check:bans`); `dirname` of
 * the filesystem root is itself, which ends the recursion even when
 * nothing on the way up ever exists. */
const walkAncestors = (
	cwd: string,
	path: string,
	permissionCode?: string,
): AncestorOutcome => {
	try {
		const stat = statSync(path);
		if (stat.isDirectory()) {
			if (permissionCode !== undefined) {
				return { kind: "blocked", culprit: path, code: permissionCode };
			}
			return { kind: "ok" };
		}
		return { kind: "conflict", path, actualKind: "file" };
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT") {
			const danglingTarget = danglingLinkTargetAt(cwd, path);
			if (danglingTarget !== null) {
				return { kind: "dangling", path, target: danglingTarget };
			}
			const parent = parentOf(path);
			if (parent === path) {
				if (permissionCode !== undefined) {
					return { kind: "blocked", culprit: path, code: permissionCode };
				}
				return { kind: "ok" };
			}
			return walkAncestors(cwd, parent, permissionCode);
		}
		if (code === "ENOTDIR") {
			const parent = parentOf(path);
			if (parent === path) {
				if (permissionCode !== undefined) {
					return { kind: "blocked", culprit: path, code: permissionCode };
				}
				return { kind: "ok" };
			}
			return walkAncestors(cwd, parent, permissionCode);
		}
		if (code === "EACCES" || code === "EPERM") {
			const parent = parentOf(path);
			if (parent === path) {
				return { kind: "blocked", culprit: path, code };
			}
			return walkAncestors(cwd, parent, code);
		}
		return { kind: "stat-failed", path, code };
	}
};

/** Refuses before creating anything: a file sitting somewhere in a
 * planned artifact's own directory chain, not just at its leaf
 * (D106 R1 N1), or a directory on the way that denies this process
 * permission to look inside it (#768, D4). Runs before
 * {@link checkPathKind}: a leaf whose own `stat` also fails with
 * `ENOTDIR`/`EACCES` (because an ancestor, not the leaf, is the file or
 * the blocked directory) is named here by the ancestor that actually
 * blocks it, instead of by the leaf with a bare OS code. Labelled with
 * {@link fileLabel} (no trailing separator, D106 R1 lead-approved
 * option A extended to ancestors): unlike a leaf's own field, no user
 * ever spelled this path with a trailing slash for this function to
 * preserve -- it is derived from a nested field's own value, so both
 * the quote and the `Next:` clause name the one real path. */
const checkAncestors = (cwd: string, artifact: Artifact): void => {
	const outcome = walkAncestors(cwd, dirname(artifact.path));
	if (outcome.kind === "ok") {
		return;
	}
	if (outcome.kind === "blocked") {
		throwStatFailed(
			artifact.label,
			artifact.fieldName,
			outcome.code,
			fileLabel(cwd, outcome.culprit),
		);
	}
	const label = fileLabel(cwd, outcome.path);
	if (outcome.kind === "conflict") {
		throwAncestorConflict(label, artifact.fieldName, outcome.actualKind);
	}
	if (outcome.kind === "dangling") {
		throwAncestorDanglingLink(label, artifact.fieldName, outcome.target);
	}
	throwStatFailed(label, artifact.fieldName, outcome.code, label);
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

/** The node whose permissions actually block a leaf's own failed `stat`
 * (#768, D4): for `EACCES`/`EPERM`, walk upward from the artifact's own
 * directory, seeded with the leaf's own code, to find the ancestor that
 * blocks it -- `stat`'s `EACCES` is always a directory on the way,
 * never the leaf, so the leaf's own failure means some ancestor above
 * it denies the lookup. `artifact.label` itself for any other code, or
 * on the (untested) chance the seeded walk doesn't resolve to one. */
const culpritFor = (cwd: string, artifact: Artifact, code: string): string => {
	if (code !== "EACCES" && code !== "EPERM") {
		return artifact.label;
	}
	const outcome = walkAncestors(cwd, dirname(artifact.path), code);
	if (outcome.kind === "blocked") {
		return fileLabel(cwd, outcome.culprit);
	}
	return artifact.label;
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
	const outcome = statOutcomeAt(cwd, stripTrailingSeparators(artifact.path));
	if (outcome.kind === "absent") {
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
	if (outcome.kind === "stat-failed") {
		throwStatFailed(
			artifact.label,
			artifact.fieldName,
			outcome.code,
			culpritFor(cwd, artifact, outcome.code),
		);
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
export const runInit = async (
	cwd: string,
	rawArgs: ReadonlyArray<string> = [],
): Promise<InitResult> => {
	const fallbackIdentity = "init";
	const configFlag = lastFlagValue(normalizeEqualsFlags(rawArgs), "--config");
	const configFilePath = resolveConfigPath(cwd, configFlag);
	const configArtifact: Artifact = {
		kind: "file",
		label: fileLabel(cwd, configFilePath),
		path: configFilePath,
		content: CONFIG_FILE_CONTENT,
		fieldName: CONFIG_FILE_NAME,
	};
	try {
		// The configuration's own kind is checked before it is loaded
		// (D106 R1 N3): the requirement already names the configuration
		// among the artifacts whose wrong-kind path stops the run, but
		// the loader would otherwise answer first, with a config-load-
		// failed diagnostic about import resolution instead of this one.
		checkPathKind(cwd, configArtifact);
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

		// Every planned artifact's path kind is checked before any of
		// them is created -- a conflict discovered on the snapshot must
		// not leave a just-created config file or migrations directory
		// behind it. Two fields resolving to the same path (D106 R1 N2)
		// are checked first: creating one would make the other's own
		// existsSync check see it as already present. The ancestor chain
		// (D106 R1 N1) is checked before the leaf's own kind (3.1/
		// checkPathKind): a leaf blocked by a file ancestor is named by
		// that ancestor, not by the leaf.
		const plannedArtifacts: ReadonlyArray<Artifact> = [
			configArtifact,
			migrationsArtifact,
			snapshotArtifact,
		].filter((artifact): artifact is Artifact => artifact !== null);
		checkNoDuplicatePaths(cwd, plannedArtifacts);
		checkNoNestedPaths(cwd, plannedArtifacts);
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

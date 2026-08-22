import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { globSync } from "tinyglobby";
import { listTreeFiles } from "./git";
import { colorize, shouldUseColor } from "./tty";

export type FileDiffMarker = "+" | "~" | "-";

/** One line of `restore`'s own file-diff report (§4/§7, #130) — `path` is cwd-relative, matching `config.entry`'s own relativity. */
export type FileDiffEntry = {
	readonly marker: FileDiffMarker;
	readonly path: string;
};

/**
 * `tinyglobby.globSync` only ever crawls a real filesystem — there is no
 * "match this in-memory path list against a glob" entry point in its own
 * API (checked directly against its type declarations, not assumed). A
 * target commit's tree isn't a real filesystem, so this stages one:
 * every file `git ls-tree` reports for `sha` gets an empty stub written
 * at the same relative path inside a scratch temp dir, and `entry`'s own
 * glob patterns are matched against *that* directory instead — same
 * matching engine, same patterns, a real (if synthetic) filesystem
 * underneath it.
 */
const stubTreeDir = (cwd: string, sha: string): string => {
	const stubDir = mkdtempSync(join(tmpdir(), "hejbro-restore-tree-"));
	const paths = listTreeFiles(cwd, sha, ".");
	paths.forEach((path) => {
		const fullPath = join(stubDir, path);
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, "");
	});
	return stubDir;
};

const matchEntryGlob = (
	cwd: string,
	entry: ReadonlyArray<string>,
): ReadonlyArray<string> => globSync([...entry], { cwd });

/**
 * Every file `entry`'s glob patterns match, split into three groups
 * (§4): present at both `sha` and the current working tree (`~`,
 * overwritten), present only at `sha` (`+`, resurrected), present only
 * in the current working tree (`-`, removed) — sorted `+`, `~`, `-`,
 * alphabetical within each group (§7).
 */
export const computeFileDiff = (
	cwd: string,
	sha: string,
	entry: ReadonlyArray<string>,
): ReadonlyArray<FileDiffEntry> => {
	const stubDir = stubTreeDir(cwd, sha);
	try {
		const targetMatches = new Set(matchEntryGlob(stubDir, entry));
		const currentMatches = new Set(matchEntryGlob(cwd, entry));
		const targetOnly = Array.from(targetMatches)
			.filter((path) => !currentMatches.has(path))
			.sort();
		const both = Array.from(targetMatches)
			.filter((path) => currentMatches.has(path))
			.sort();
		const currentOnly = Array.from(currentMatches)
			.filter((path) => !targetMatches.has(path))
			.sort();
		return [
			...targetOnly.map((path): FileDiffEntry => ({ marker: "+", path })),
			...both.map((path): FileDiffEntry => ({ marker: "~", path })),
			...currentOnly.map((path): FileDiffEntry => ({ marker: "-", path })),
		];
	} finally {
		rmSync(stubDir, { recursive: true, force: true });
	}
};

const diffLineText = (
	entry: FileDiffEntry,
	migrationNumber: number,
): string => {
	if (entry.marker === "+") {
		return `+ restored ${entry.path} (existed at migration ${migrationNumber}, absent now)`;
	}
	if (entry.marker === "~") {
		return `~ restored ${entry.path}`;
	}
	return `- removed ${entry.path} (didn't exist at migration ${migrationNumber})`;
};

const colorFor: Record<FileDiffMarker, "green" | "yellow" | "red"> = {
	"+": "green",
	"~": "yellow",
	"-": "red",
};

/** Renders `entries`'s own report lines (§7) — the full line is colorized when {@link shouldUseColor} says so, otherwise printed plain (byte-stable, no ANSI at all). */
export const renderFileDiffLines = (
	entries: ReadonlyArray<FileDiffEntry>,
	migrationNumber: number,
): ReadonlyArray<string> => {
	const useColor = shouldUseColor();
	return entries.map((entry) => {
		const text = diffLineText(entry, migrationNumber);
		if (!useColor) {
			return text;
		}
		return colorize(text, colorFor[entry.marker]);
	});
};

const UNDO_GUTTER = "     ";

const pathsWithMarker = (
	entries: ReadonlyArray<FileDiffEntry>,
	marker: FileDiffMarker,
): ReadonlyArray<string> =>
	entries.filter((entry) => entry.marker === marker).map((entry) => entry.path);

const removedUndoLine = (
	paths: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (paths.length === 0) {
		return [];
	}
	return [
		`git checkout HEAD -- ${paths.join(" ")}${UNDO_GUTTER}# bring back the removed file`,
	];
};

const resurrectedUndoLine = (
	paths: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (paths.length === 0) {
		return [];
	}
	return [
		`rm ${paths.join(" ")}${UNDO_GUTTER}# remove the resurrected file (didn't exist before restore)`,
	];
};

const modifiedUndoLine = (
	paths: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (paths.length === 0) {
		return [];
	}
	return [
		`git checkout HEAD -- ${paths.join(" ")}${UNDO_GUTTER}# revert the modified files`,
	];
};

/** The `restore never commits — everything above is undoable:` block (§7) — one line per non-empty group, omitted entirely when `entries` is empty (nothing was written). */
export const renderUndoBlock = (
	entries: ReadonlyArray<FileDiffEntry>,
): ReadonlyArray<string> => {
	if (entries.length === 0) {
		return [];
	}
	return [
		"restore never commits — everything above is undoable:",
		...removedUndoLine(pathsWithMarker(entries, "-")),
		...resurrectedUndoLine(pathsWithMarker(entries, "+")),
		...modifiedUndoLine(pathsWithMarker(entries, "~")),
	];
};

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * #744: a `_tmp-*` directory is created and torn down by another test
 * (`declare-emit-callback-shadow.test.ts`'s own fixture, `.uo-contract`'s
 * cache) while this scan's own vitest workers run in parallel -- if the
 * scan lists a file under one of these and reads it later, the file can
 * vanish between the two steps. The fix is to never list them at all:
 * a skipped directory's files are never seen downstream, so they can
 * never be opened.
 */
const isScratchDir = (name: string): boolean =>
	name.startsWith("_tmp-") || name === ".uo-contract";

/** Every `.ts` file under `dir`, recursively, skipping any directory `isScratchDir` names. */
export const listTsFilesRecursively = (dir: string): ReadonlyArray<string> => {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			return isScratchDir(entry.name)
				? []
				: listTsFilesRecursively(join(dir, entry.name));
		}
		return entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [];
	});
};

/** Every package/example's own `test` directory under `repoRoot`, given a workspace group directory (`packages`, `examples`). */
export const testDirsUnder = (
	repoRoot: string,
	groupDir: string,
): ReadonlyArray<string> =>
	readdirSync(join(repoRoot, groupDir), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(repoRoot, groupDir, entry.name, "test"));

export type Violation = {
	readonly file: string;
	readonly line: number;
};

/** Injectable so a test can drive `violationsIn`/`parseGapsIn` without touching disk, and can record which paths were actually read. */
export type ReadFile = (filePath: string) => string;

export const readUtf8: ReadFile = (filePath) => readFileSync(filePath, "utf8");

const isEnoent = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { code?: unknown }).code === "ENOENT";

/** `undefined` if `filePath` vanished between listing and reading -- a race with another test's own cleanup, not a violation. */
const readIfPresent = (
	filePath: string,
	readFile: ReadFile,
): string | undefined => {
	try {
		return readFile(filePath);
	} catch (error) {
		if (isEnoent(error)) {
			return undefined;
		}
		throw error;
	}
};

/**
 * An argument-array literal whose *first* element is `"rm"` (or
 * `'rm'`/`` `rm` ``) -- anchored to right after `[` (only whitespace
 * between), not merely "contains `rm` somewhere before the next `]`":
 * a bare `[` earlier in a file (inside an unrelated string like
 * `"error["`, or a doc comment's own `[<code>]`) is not an array
 * literal at all, and an unanchored scan matched forward past it to
 * whatever `]` came next -- confirmed as a false positive against
 * `support/cli-runner.ts`'s own `startsWith("error[")` while writing
 * this test. `[^\]]` already excludes `]` but not newlines, so a
 * literal spanning several lines is still captured without needing the
 * `s` flag; none of the real instances nest a `[` inside (plain
 * strings and identifiers only).
 */
const RM_ARRAY = /\[\s*["'`]rm["'`][^\]]*\]/g;
const HAS_V_FLAG = /["'`]-v["'`]/;

const lineOf = (content: string, index: number): number =>
	content.slice(0, index).split("\n").length;

export const violationsIn = (
	filePath: string,
	readFile: ReadFile = readUtf8,
): ReadonlyArray<Violation> => {
	const content = readIfPresent(filePath, readFile);
	if (content === undefined) {
		return [];
	}
	return [...content.matchAll(RM_ARRAY)]
		.filter((match) => !HAS_V_FLAG.test(match[0]))
		.map((match) => ({
			file: filePath,
			line: lineOf(content, match.index ?? 0),
		}));
};

/**
 * `RM_ARRAY`'s own `[^\]]*` excludes `]` but not `[`, so a call whose
 * arguments contain another array's own indexing expression inline
 * (a names array indexed before the real closing bracket) ends the
 * match early -- at that inner expression's own closing bracket, never
 * the call's real one. That truncated match still contains the `"rm"`
 * literal (never simply *missing*), but whatever comes after the inner
 * bracket -- including a `-v` flag placed there -- falls outside it.
 * A truncated match is detectable on its own terms: its own bracket
 * count is unbalanced (an extra `[` from the inner reference with no
 * `]` inside the match left to close it), since a genuine, un-nested
 * call always matches exactly one `[` and one `]`.
 */
const isBalanced = (text: string): boolean =>
	(text.match(/\[/g) ?? []).length === (text.match(/\]/g) ?? []).length;

export const parseGapsIn = (
	filePath: string,
	readFile: ReadFile = readUtf8,
): ReadonlyArray<Violation> => {
	const content = readIfPresent(filePath, readFile);
	if (content === undefined) {
		return [];
	}
	return [...content.matchAll(RM_ARRAY)]
		.filter((match) => !isBalanced(match[0]))
		.map((match) => ({
			file: filePath,
			line: lineOf(content, match.index ?? 0),
		}));
};

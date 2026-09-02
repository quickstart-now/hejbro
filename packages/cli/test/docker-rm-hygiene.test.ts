import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #709: `docker rm -f <container>` (no `-v`) removes the container but
 * leaves the official `postgres` image's own declared
 * `VOLUME /var/lib/postgresql/data` behind as an orphaned anonymous
 * volume -- every `*.integration.test.ts` afterAll in this monorepo
 * used that exact form, and the accumulation (1,418 volumes, 84 GB)
 * ate the shared Docker data disk (round 4, D106). This scans the
 * repository's own test sources for the pattern rather than trusting
 * a fixed count, so a 12th offending call added later fails the same
 * way the first 17 did.
 */

/** This file's own path, resolved from `import.meta.url` (not `cwd`) so the scan finds the same repo root and the same answer no matter where `vitest` is invoked from. */
const THIS_FILE = fileURLToPath(import.meta.url);

const hasWorkspaceMarker = (dir: string): boolean =>
	existsSync(join(dir, "pnpm-workspace.yaml"));

const findRepoRoot = (dir: string): string => {
	if (hasWorkspaceMarker(dir)) {
		return dir;
	}
	const parent = dirname(dir);
	if (parent === dir) {
		throw new Error(
			`could not find the repository root (a directory with pnpm-workspace.yaml) walking up from ${THIS_FILE}`,
		);
	}
	return findRepoRoot(parent);
};

const REPO_ROOT = findRepoRoot(dirname(THIS_FILE));

/** Every `.ts` file under `dir`, recursively -- `packages/nile/test/integration/…` is two levels deep, so a single-level `readdir` would miss it. */
const listTsFilesRecursively = (dir: string): ReadonlyArray<string> => {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			return listTsFilesRecursively(full);
		}
		if (entry.name.endsWith(".ts")) {
			return [full];
		}
		return [];
	});
};

/** Every package/example's own `test` directory -- `pnpm-workspace.yaml`'s own two globs (`packages/*`, `examples/*`), scoped to the `test` subdirectory each may or may not have. */
const testDirsUnder = (groupDir: string): ReadonlyArray<string> =>
	readdirSync(join(REPO_ROOT, groupDir), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(REPO_ROOT, groupDir, entry.name, "test"));

const candidateFiles: ReadonlyArray<string> = [
	...testDirsUnder("packages"),
	...testDirsUnder("examples"),
].flatMap(listTsFilesRecursively);

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
 * literal spanning several lines (`["rm",\n\t"-f",\n\tCONTAINER]`) is
 * still captured without needing the `s` flag; none of the 17 real
 * instances nest a `[` inside (plain strings and identifiers only).
 */
const RM_ARRAY = /\[\s*["'`]rm["'`][^\]]*\]/g;
const HAS_V_FLAG = /["'`]-v["'`]/;

type Violation = {
	readonly file: string;
	readonly line: number;
};

const lineOf = (content: string, index: number): number =>
	content.slice(0, index).split("\n").length;

const violationsIn = (filePath: string): ReadonlyArray<Violation> => {
	const content = readFileSync(filePath, "utf8");
	return [...content.matchAll(RM_ARRAY)]
		.filter((match) => !HAS_V_FLAG.test(match[0]))
		.map((match) => ({
			file: filePath,
			line: lineOf(content, match.index ?? 0),
		}));
};

describe("docker rm hygiene / #709", () => {
	it("every docker rm array literal in packages/*/test and examples/*/test carries -v", () => {
		// This file's own rule-description prose above contains the literal
		// "rm" in quotes several times -- excluded by identity, not by a
		// narrower regex, since the rule itself must stay simple.
		const scanned = candidateFiles.filter((file) => file !== THIS_FILE);
		expect(scanned.length).toBeGreaterThan(0);

		const violations = scanned.flatMap(violationsIn);
		const report = violations
			.map((v) => `${v.file}:${v.line}`)
			.sort()
			.join("\n");

		expect(violations, `docker rm without -v at:\n${report}`).toEqual([]);
	});
});

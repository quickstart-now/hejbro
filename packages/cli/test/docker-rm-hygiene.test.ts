import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	listTsFilesRecursively,
	parseGapsIn,
	type ReadFile,
	testDirsUnder,
	violationsIn,
} from "./support/repo-test-file-scan";

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

/** The extracted scan module's own path -- excluded by identity for the same reason as `THIS_FILE`: it must stay free to document the pattern without a future one-line example turning it into a self-reported violation. */
const SCAN_MODULE_FILE = join(
	dirname(THIS_FILE),
	"support",
	"repo-test-file-scan.ts",
);

/** `pnpm-workspace.yaml`'s own two globs (`packages/*`, `examples/*`), scoped to the `test` subdirectory each may or may not have. */
const candidateFiles: ReadonlyArray<string> = [
	...testDirsUnder(REPO_ROOT, "packages"),
	...testDirsUnder(REPO_ROOT, "examples"),
].flatMap(listTsFilesRecursively);

describe("docker rm hygiene / #709", () => {
	// Excluded by identity so this file and the scan module it drives
	// stay free to describe the rule in prose without every future edit
	// having to keep re-checking themselves against their own pattern.
	const scanned = candidateFiles.filter(
		(file) => file !== THIS_FILE && file !== SCAN_MODULE_FILE,
	);

	it("every docker rm array literal in packages/*/test and examples/*/test carries -v", () => {
		expect(scanned.length).toBeGreaterThan(0);

		const violations = scanned.flatMap((file) => violationsIn(file));
		const report = violations
			.map((v) => `${v.file}:${v.line}`)
			.sort()
			.join("\n");

		expect(violations, `docker rm without -v at:\n${report}`).toEqual([]);
	});

	it("the -v rule parses every docker rm call it can see -- no nested-] blind spot", () => {
		const gaps = scanned.flatMap((file) => parseGapsIn(file));
		const report = gaps
			.map((g) => `${g.file}:${g.line}`)
			.sort()
			.join("\n");

		expect(
			gaps,
			`the -v rule could not parse this docker rm call -- simplify the array literal or extend the rule:\n${report}`,
		).toEqual([]);
	});
});

/**
 * #744: `declare-emit-callback-shadow.test.ts` builds its own fixture
 * inside `packages/cli/test/_tmp-callback-shadow-*` and tears it down at
 * the end of its run; under parallel vitest workers, the describe above
 * can list one of those files and then find it gone by the time it
 * reads it. These cases drive the extracted scan functions directly,
 * against a disposable root outside the scanned tree, so the race never
 * has to actually happen to prove the fix.
 */
describe("repo-test-file-scan skip & ENOENT tolerance / #744", () => {
	let scratchRoot: string;

	beforeEach(() => {
		scratchRoot = mkdtempSync(join(tmpdir(), "repo-test-file-scan-"));
	});

	afterEach(() => {
		rmSync(scratchRoot, { recursive: true, force: true });
	});

	const writeFixture = (relativePath: string, content: string): string => {
		const full = join(scratchRoot, relativePath);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content, "utf8");
		return full;
	};

	// Built at runtime, never as a literal array in this file's own
	// source: this file lives inside the tree the describe above scans,
	// so a non-compliant array written directly here would flag itself.
	const rmCallText = (rest: ReadonlyArray<string>): string =>
		`${"["}${JSON.stringify("rm")}, ${rest
			.map((entry) => JSON.stringify(entry))
			.join(", ")}${"]"}`;

	const withoutVFlag = rmCallText(["-f", "container"]);
	const withVFlag = rmCallText(["-f", "-v", "container"]);

	const enoentRead: ReadFile = () => {
		throw Object.assign(new Error("ENOENT: no such file or directory"), {
			code: "ENOENT",
		});
	};

	it.each([
		{
			name: "(i) a plain compliant call reports no violation",
			content: withVFlag,
			readFile: undefined,
			expectedCount: 0,
		},
		{
			name: "(v) a plain non-compliant call reports exactly one violation -- the skip does not over-eat",
			content: withoutVFlag,
			readFile: undefined,
			expectedCount: 1,
		},
		{
			name: "(iv) a listed file gone by read time is treated as absent, not a violation",
			content: withoutVFlag,
			readFile: enoentRead,
			expectedCount: 0,
		},
	])("$name", ({ content, readFile, expectedCount }) => {
		const file = writeFixture("test/case.ts", content);
		expect(violationsIn(file, readFile)).toHaveLength(expectedCount);
		expect(parseGapsIn(file, readFile)).toHaveLength(0);
	});

	it("a non-ENOENT read error still propagates -- the tolerance is narrow, not a catch-all", () => {
		const file = writeFixture("test/other-error.ts", withoutVFlag);
		const throwingRead: ReadFile = () => {
			throw new Error("EACCES: permission denied");
		};
		expect(() => violationsIn(file, throwingRead)).toThrow(/permission denied/);
	});

	it("(ii)/(iii) a file under _tmp-* or .uo-contract is never listed, so it is never opened", () => {
		writeFixture("test/_tmp-shadow-abc/fixture.ts", withoutVFlag);
		writeFixture("test/.uo-contract/cache.ts", withoutVFlag);
		writeFixture("test/plain.ts", withVFlag);

		const opened: string[] = [];
		const recordingRead: ReadFile = (filePath) => {
			opened.push(filePath);
			return withVFlag;
		};

		const files = listTsFilesRecursively(join(scratchRoot, "test"));
		files.flatMap((file) => violationsIn(file, recordingRead));

		expect(files.some((file) => file.includes("_tmp-shadow-abc"))).toBe(false);
		expect(files.some((file) => file.includes(".uo-contract"))).toBe(false);
		expect(opened.some((file) => file.includes("_tmp-shadow-abc"))).toBe(false);
		expect(opened.some((file) => file.includes(".uo-contract"))).toBe(false);
		expect(opened).toContain(join(scratchRoot, "test", "plain.ts"));
	});
});

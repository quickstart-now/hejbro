import { execFileSync } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { migrationVersionOf } from "@hejbro/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";
import { GIT_TEST_ENV } from "./support/git-fixture";

beforeAll(assertBuiltCli);

// Group 4's own CLI-level coverage of the generator's split: a run that
// adds an enum value and, in the same run, emits that value into an
// expression outside a function body writes two migrations instead of
// one. Pure-function coverage of the split *decision* itself lives in
// `packages/core/test/split.test.ts` -- these tests drive the built CLI
// end to end (file naming, the written banners, the report).

const configSource = (
	prefixStrategy: "timestamp" | "index" | "unix",
): string => `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "${prefixStrategy}",
});
`;

const SCHEMA_V1 = `import { pgEnum, schema, table, uuid } from "hejbro";

export const app = schema("app");

export const mood = pgEnum(app, "mood", ["ok"]);

export const items = table(app, "items", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

const SCHEMA_V2 = `import { pgEnum, schema, table, uuid } from "hejbro";

export const app = schema("app");

export const mood = pgEnum(app, "mood", ["ok", "great"]);

export const items = table(app, "items", {
	id: uuid().primaryKey().defaultRandom(),
	flag: mood.column().default("great"),
});
`;

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const writeSchema = (source: string): Promise<void> =>
	writeFixtureFile(cwd, "src/app.schema.ts", source);

const writeConfig = (
	prefixStrategy: "timestamp" | "index" | "unix",
): Promise<void> =>
	writeFixtureFile(cwd, "hejbro.config.ts", configSource(prefixStrategy));

const sqlFileNames = async (): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(join(cwd, "migrations"));
	return entries.filter((name) => name.endsWith(".sql")).sort();
};

/**
 * `generateThenTriggerSplit` always runs `generate` twice -- once for
 * `SCHEMA_V1` (which itself writes a file: creating the enum and table),
 * once for `SCHEMA_V2` (which splits). So a repo this helper set up
 * always has three files, and the split pair is the *last* two by
 * version -- never the first two, and never "however many exist" (which
 * would pass vacuously the moment an earlier run leaves files behind).
 */
const splitPairFileNames = async (): Promise<readonly [string, string]> => {
	const fileNames = await sqlFileNames();
	expect(fileNames).toHaveLength(3);
	const [, first, second] = fileNames;
	if (first === undefined || second === undefined) {
		throw new Error("unreachable — checked length above");
	}
	return [first, second];
};

/** Sets up an empty repo, runs the enum-only generation, then rewrites the schema to the split-triggering version -- every test in this file shares this shape, only the config (prefix strategy / `--name`) differs. */
const generateThenTriggerSplit = async (
	extraArgs: ReadonlyArray<string> = [],
): Promise<{
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}> => {
	await runCli(cwd, ["init"]);
	await writeSchema(SCHEMA_V1);
	await runCli(cwd, ["generate"]);
	await writeSchema(SCHEMA_V2);
	return runCli(cwd, ["generate", ...extraArgs]);
};

describe("hejbro generate — split (built CLI, tmp-dir) / 4.3", () => {
	it("emits two migrations whose banners chain", async () => {
		await writeConfig("timestamp");
		const result = await generateThenTriggerSplit();
		expect(result.exitCode).toBe(0);

		const [first, second] = await splitPairFileNames();
		const firstContent = await readFile(
			join(cwd, "migrations", first as string),
			"utf8",
		);
		const secondContent = await readFile(
			join(cwd, "migrations", second as string),
			"utf8",
		);
		const firstSnapshotLine = firstContent
			.split("\n")
			.find((line) => line.startsWith("-- snapshot: "));
		const secondParentLine = secondContent
			.split("\n")
			.find((line) => line.startsWith("-- parent-snapshot: "));
		expect(firstSnapshotLine).toBeDefined();
		expect(secondParentLine).toBeDefined();
		expect(secondParentLine).toBe(
			`-- parent-snapshot: ${(firstSnapshotLine as string).slice("-- snapshot: ".length)}`,
		);
	});
});

describe("hejbro generate — split / 4.4", () => {
	it.each(["timestamp", "index", "unix"] as const)(
		"the two files have different versions under the %s prefix strategy",
		async (prefixStrategy) => {
			await writeConfig(prefixStrategy);
			const result = await generateThenTriggerSplit();
			expect(result.exitCode).toBe(0);

			const [first, second] = await splitPairFileNames();
			const firstVersion = migrationVersionOf(first);
			const secondVersion = migrationVersionOf(second);
			expect(firstVersion).not.toBeNull();
			expect(secondVersion).not.toBeNull();
			expect(firstVersion).not.toBe(secondVersion);
		},
	);
});

describe("hejbro generate — split / 4.5", () => {
	it("a named split writes two files with different versions", async () => {
		await writeConfig("timestamp");
		const result = await generateThenTriggerSplit(["--name", "add_mood"]);
		expect(result.exitCode).toBe(0);

		// Guard against a vacuous pass: this schema's very first `generate`
		// (SCHEMA_V1) already wrote one file, so "two exist" alone would
		// pass even if the split silently wrote nothing new.
		const fileNames = await sqlFileNames();
		expect(fileNames).toHaveLength(3);
		const splitPair = fileNames.filter((name) => name.includes("add_mood"));
		expect(splitPair).toHaveLength(2);
		const [first, second] = splitPair;
		const firstVersion = migrationVersionOf(first as string);
		const secondVersion = migrationVersionOf(second as string);
		expect(firstVersion).not.toBeNull();
		expect(secondVersion).not.toBe(firstVersion);
	});
});

describe("hejbro generate — split / 4.6", () => {
	it("reports both migrations when a run splits", async () => {
		await writeConfig("timestamp");
		const result = await generateThenTriggerSplit();
		expect(result.exitCode).toBe(0);

		const [first, second] = await splitPairFileNames();
		expect(result.stdout).toContain(`wrote migrations/${first}`);
		expect(result.stdout).toContain(`wrote migrations/${second}`);
	});
});

// git environment variable names below, not a naming choice of this codebase's own
const FIXED_COMMIT_DATE_ENV = {
	...GIT_TEST_ENV,
	// biome-ignore lint/style/useNamingConvention: git environment variable name
	GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z",
	// biome-ignore lint/style/useNamingConvention: git environment variable name
	GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z",
};

const git = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: FIXED_COMMIT_DATE_ENV,
	});

describe("hejbro generate — split / 4.7", () => {
	it("history explains a split pair without calling it an accident", async () => {
		await writeConfig("index");
		git(cwd, ["init", "-q", "-b", "main"]);
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_V1);
		await runCli(cwd, ["generate"]);
		git(cwd, ["add", "-A"]);
		git(cwd, ["commit", "-q", "-m", "feat: mood"]);

		await writeSchema(SCHEMA_V2);
		const splitResult = await runCli(cwd, ["generate"]);
		expect(splitResult.exitCode).toBe(0);
		// Both split files are committed together, in one commit -- the
		// same "co-added" shape a squash merge also produces, which is
		// exactly the ambiguity this task is about: git alone cannot tell
		// the two apart.
		git(cwd, ["add", "-A"]);
		git(cwd, ["commit", "-q", "-m", "feat: mood value and default"]);

		const historyResult = await runCli(cwd, ["history"]);
		expect(historyResult.exitCode).toBe(0);
		// The first split file's banner names an intermediate snapshot
		// that was never written to disk at all -- history reads that as
		// `lost`, the same as it would a squash-flattened migration.
		expect(historyResult.stdout).toContain("lost");
		// It does NOT get the wrong reason attached to it: git cannot tell
		// a generator split apart from a squash merge (both leave the
		// identical trace, an unmatched hash), so the note states only
		// what git actually observed.
		expect(historyResult.stdout).not.toContain("squash merge");
		expect(historyResult.stdout).toContain(
			"declaration state exists in git. Closest available:",
		);
	});
});

const versionOf = (fileName: string): string =>
	fileName.split("_", 1)[0] as string;
const slugOf = (fileName: string): string =>
	fileName.slice(fileName.indexOf("_") + 1);

/**
 * Renames `fileName` (already in `migrations/`) so its version prefix
 * becomes `newVersion`, keeping the slug and full byte content untouched
 * -- forces two real, validly-hashed migrations to collide on version
 * without depending on real-clock timing. Mirrors `verify.test.ts`'s own
 * `forceMigrationVersion` (#220) exactly; not imported from there because
 * that helper closes over verify.test.ts's own `cwd` variable, not an
 * argument -- duplicating four lines was cheaper than threading a shared
 * one across files for this one use.
 */
const forceMigrationVersion = async (
	fileName: string,
	newVersion: string,
): Promise<string> => {
	const newFileName = `${newVersion}_${slugOf(fileName)}`;
	const content = await readFile(join(cwd, "migrations", fileName), "utf8");
	await rm(join(cwd, "migrations", fileName));
	await writeFixtureFile(cwd, `migrations/${newFileName}`, content);
	return newFileName;
};

describe("hejbro generate — split / 4.9", () => {
	it("a normal split never gives verify --fix anything to do (4.4 already keeps the pair's versions apart)", async () => {
		await writeConfig("index");
		const result = await generateThenTriggerSplit();
		expect(result.exitCode).toBe(0);
		const beforeFix = await sqlFileNames();
		expect(beforeFix).toHaveLength(3);

		const fixResult = await runCli(cwd, ["verify", "--fix"]);
		expect(fixResult.exitCode).toBe(0);

		// Comparing the exact file list before/after (not just a count) is
		// what would catch `--fix` wrongly treating the pair as a collision.
		const afterFix = await sqlFileNames();
		expect(afterFix).toEqual(beforeFix);

		const verifyResult = await runCli(cwd, ["verify"]);
		expect(verifyResult.exitCode).toBe(0);
	});

	it("verify --fix leaves a split pair's own chain intact when an UNRELATED file is forced to collide with one half of the pair", async () => {
		// The adversarial case tasks.md itself flags as unwitnessed: a
		// rename resolving some *other* duplicate-version collision lands
		// on one half of a split pair. Engineered the same way
		// verify.test.ts's own duplicate-version tests do (#220): force a
		// real collision by hand rather than hope two `generate` calls
		// land in the same clock tick.
		await writeConfig("index");
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_V1);
		await runCli(cwd, ["generate", "--name", "unrelated"]);
		await writeSchema(SCHEMA_V2);
		const splitResult = await runCli(cwd, ["generate"]);
		expect(splitResult.exitCode).toBe(0);

		const [unrelated, splitFirst, splitSecond] = await sqlFileNames();
		if (
			unrelated === undefined ||
			splitFirst === undefined ||
			splitSecond === undefined
		) {
			throw new Error("expected three migration files");
		}
		// Force the split pair's SECOND file to collide with the unrelated
		// one -- not with its own sibling (4.4 already guarantees the pair
		// never collides with each other; forcing that would test nothing
		// this suite doesn't already cover).
		const forcedName = await forceMigrationVersion(
			splitSecond,
			versionOf(unrelated),
		);

		const before = await runCli(cwd, ["verify"]);
		expect(before.exitCode).toBe(1);
		expect(before.stderr).toContain("error[duplicate-migration-version]");

		const fixResult = await runCli(cwd, ["verify", "--fix"]);

		// FINDING (4.9), measured rather than guessed: the forced
		// collision's two members are NOT chain-adjacent to each other (the
		// unrelated migration and the split pair's second file share no
		// parent/current link between just the two of them), so
		// `planDuplicateVersionFix` returns `null` for this group (a fork
		// by its own definition -- two members, neither the other's
		// predecessor). `applyGroupFix`'s own contract for a `null` plan
		// (`verify.ts`) is to leave the group's files untouched and record
		// `unresolvedGroupSkipLine` instead, so the group still fails
		// `runCheckDuplicateVersion` afterward with the *same* diagnostic
		// `--fix` would have shown without `--fix` at all -- no rename is
		// attempted, and nothing about the split pair's own relationship is
		// touched. This is neither "breaks" nor "silently fixes": `--fix`
		// refuses to guess, the same as it already does for any other
		// unresolvable group -- a split pair earns no special case.
		expect(fixResult.exitCode).toBe(1);
		expect(fixResult.stderr).toContain("error[duplicate-migration-version]");
		expect(fixResult.stdout).toContain(`skipped: "${versionOf(unrelated)}"`);
		// Neither file was renamed by --fix.
		expect(await sqlFileNames()).toEqual(
			[unrelated, forcedName, splitFirst].sort(),
		);

		// The split pair's OWN chain relationship survives regardless of
		// what happens to the forced collision: chain identity is the
		// banner's parent/current hashes, never the filename, so resolving
		// the forced collision by hand (renaming just that file back to an
		// unused version) restores a fully verifying chain.
		await forceMigrationVersion(forcedName, "9999");
		const afterManualRename = await runCli(cwd, ["verify"]);
		expect(afterManualRename.exitCode).toBe(0);
	});
});

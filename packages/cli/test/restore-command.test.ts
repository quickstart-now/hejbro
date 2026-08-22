import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";
import { GIT_TEST_ENV } from "./support/git-fixture";

beforeAll(assertBuiltCli);

// hejbro restore's own e2e coverage (#130) -- see history-command.test.ts's
// own doc comment for why this uses the built-CLI child_process approach.

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
});
`;

const SCHEMA_V1 = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

const SCHEMA_V2 = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text(),
});
`;

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

describe("hejbro restore", () => {
	it("restore-target-out-of-range: no migrations yet", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await runCli(cwd, ["init"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "chore: init"]);

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[restore-target-out-of-range]");
			expect(result.stderr).toContain("this project has no migrations yet");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("restore-target-out-of-range: target beyond the valid range, or not an integer", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			const outOfRange = await runCli(cwd, ["restore", "5"]);
			expect(outOfRange.exitCode).toBe(1);
			expect(outOfRange.stderr).toContain(
				'restore target "5" is out of range — this project has 1 migration(s) (valid range 1–1)',
			);

			const notAnInteger = await runCli(cwd, ["restore", "abc"]);
			expect(notAnInteger.exitCode).toBe(1);
			expect(notAnInteger.stderr).toContain(
				"error[restore-target-out-of-range]",
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("uncommitted target: exits 0 with the no-op message, no file-diff", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);
			// deliberately not committed

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe(
				"already at migration 1's state (uncommitted) — nothing to restore.",
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("dirty-working-tree: refuses to restore over pending edits, no --force", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);
			await writeFixtureFile(cwd, "untracked.txt", "pending");

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[dirty-working-tree]");
			expect(result.stderr).toContain("There's no --force override for this");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("a real restore overwrites the file back to its recorded state, prints the verified/file-diff/undo output, and exits 0", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V2);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: body column"]);

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("verified: commit ");
			expect(result.stdout).toContain("~ restored src/app.schema.ts");
			expect(result.stdout).toContain(
				"verified: restored declarations reproduce migration 1's recorded snapshot",
			);
			expect(result.stdout).toContain(
				"declarations loaded successfully — ready to review and run `hejbro generate`.",
			);
			expect(result.stdout).toContain(
				"restore never commits — everything above is undoable:",
			);
			expect(result.stdout).toContain(
				"git checkout HEAD -- src/app.schema.ts     # revert the modified files",
			);

			const restoredContent = await readFile(
				join(cwd, "src/app.schema.ts"),
				"utf8",
			);
			expect(restoredContent).toBe(SCHEMA_V1);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("restore-state-lost: a squash-merged PR folds two migrations' declaration state into one commit", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await runCli(cwd, ["init"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "chore: init"]);

			git(cwd, ["checkout", "-qb", "feat-b"]);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V2);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: body column"]);

			git(cwd, ["checkout", "-q", "main"]);
			git(cwd, ["merge", "-q", "--squash", "feat-b"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts and body (#1)"]);
			git(cwd, ["branch", "-qD", "feat-b"]);

			const historyResult = await runCli(cwd, ["history"]);
			expect(historyResult.exitCode).toBe(0);
			expect(historyResult.stdout).toContain(
				"only migration 2's declaration state exists in git (squash merge lost migration 1's). Closest available: `hejbro restore 2`.",
			);

			const restoreResult = await runCli(cwd, ["restore", "1"]);
			expect(restoreResult.exitCode).toBe(1);
			expect(restoreResult.stderr).toContain("error[restore-state-lost]");
			expect(restoreResult.stderr).toContain(
				"it was squashed together with migration 2 into commit",
			);
			expect(restoreResult.stderr).toContain("run `hejbro restore 2`");

			const restoreSurvivor = await runCli(cwd, ["restore", "2"]);
			expect(restoreSurvivor.exitCode).toBe(0);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});

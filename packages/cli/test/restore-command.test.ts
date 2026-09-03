import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash";
import { CLI_VERSION } from "../src/version";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";
import { transcript } from "./support/call-transcript";
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

/**
 * #533 G2.5/G2.3b: unlike `git-fixture.ts`'s own `runGit`, this call was
 * never caught -- a `cwd` not yet (or no longer) a real git repository
 * under parallel workers propagates git's raw stderr as an uncaught
 * `execFileSync` error. Behavior is unchanged (still throws, so no
 * existing assertion here can start passing/failing differently); the
 * call is now recorded into the transcript either way, so a failure this
 * causes carries its own argv/cwd/exit code/stderr in the dump instead
 * of only vitest's own "Error: Command failed" line.
 */
const git = (cwd: string, args: ReadonlyArray<string>): string => {
	try {
		const stdout = execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			env: FIXED_COMMIT_DATE_ENV,
		});
		transcript.record({ argv: ["git", ...args], cwd, exitCode: 0, stdout, stderr: "" });
		return stdout;
	} catch (error) {
		const execError = error as {
			readonly stdout?: string;
			readonly stderr?: string;
			readonly status?: number;
		};
		transcript.record({
			argv: ["git", ...args],
			cwd,
			exitCode: typeof execError.status === "number" ? execError.status : 1,
			stdout: execError.stdout ?? "",
			stderr: execError.stderr ?? String(error),
		});
		throw error;
	}
};

/** The sole `.sql` file under `cwd/migrations` — every fixture below generates exactly one migration before tampering with it. */
const soleMigrationFileName = async (cwd: string): Promise<string> => {
	const entries = await readdir(join(cwd, "migrations"));
	const sqlFiles = entries.filter((name) => name.endsWith(".sql"));
	const [fileName] = sqlFiles;
	if (fileName === undefined) {
		throw new Error("expected exactly one migration file in the fixture");
	}
	return fileName;
};

/** Strips a real `hejbro generate` run's own `-- hejbro: <version>` line — every migration this built-CLI harness generates carries one (#229), so both f-1 (a different, injected version) and f-2 (no version line at all) need to start from a clean slate rather than the real one this harness's own generate already wrote. */
const withRemovedVersionLine = (migrationText: string): string =>
	migrationText.replace(/^-- hejbro: .*\n/m, "");

const withInjectedVersionLine = (
	migrationText: string,
	version: string,
): string =>
	withRemovedVersionLine(migrationText).replace(
		"-- hejbro migration\n",
		`-- hejbro migration\n-- hejbro: ${version}\n`,
	);

/**
 * Mutates the *committed* snapshot file with `mutateParsed`, then rewrites
 * the migration's own `-- snapshot: sha256:...` line to the new content's
 * real hash — self-consistent (`computeMigrationState`'s own commit-blob
 * hash check still passes, so the migration's state stays `ok`) while
 * still diverging from what a fresh `generateMigration` run against the
 * unchanged declarations produces. Corrupting *only* the banner's hash
 * line (leaving the real committed snapshot content alone) was tried
 * first and rejected: `computeMigrationState` hashes the actual committed
 * blob and compares it against the banner line itself, so an
 * inconsistent pair reads as `lost` (no commit's blob matches), never
 * reaching the `restore-state-mismatch` path these fixtures need to
 * exercise at all.
 */
const withMutatedCommittedSnapshot = async (
	cwd: string,
	migrationPath: string,
	mutateParsed: (parsed: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> => {
	const snapshotPath = join(cwd, "hejbro.snapshot.json");
	const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<
		string,
		unknown
	>;
	const mutatedText = JSON.stringify(mutateParsed(parsed));
	await writeFile(snapshotPath, mutatedText);
	const mutatedHash = `sha256:${sha256Hex(mutatedText)}`;
	const migrationText = await readFile(migrationPath, "utf8");
	await writeFile(
		migrationPath,
		migrationText.replace(
			/-- snapshot: sha256:[0-9a-f]+/,
			`-- snapshot: ${mutatedHash}`,
		),
	);
};

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
				"restore never commits — the restored files are staged; everything above is undoable:",
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

	// D81 (#261): before the fix, the post-restore reproduction rebuild used
	// an empty parent, so a mid-declaration column insert (migration 2)
	// rebuilt in *declaration* order while the target commit's snapshot
	// (built with the real parent) recorded *physical* order — the
	// reproduction hash would never match, even on a genuinely
	// undisturbed history. Restoring either migration of a real
	// mid-insert history must still verify.
	it("restores and verifies both sides of a mid-declaration column insert (D81)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(
				cwd,
				"src/app.schema.ts",
				`import { schema, table, text, timestamptz, uuid } from "hejbro";

export const app = schema("app");

export const projects = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	archivedAt: timestamptz(),
});
`,
			);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: projects table"]);

			await writeFixtureFile(
				cwd,
				"src/app.schema.ts",
				`import { schema, table, text, timestamptz, uuid } from "hejbro";

export const app = schema("app");

export const projects = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	description: text(),
	archivedAt: timestamptz(),
});
`,
			);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: description column"]);

			const restoreOldest = await runCli(cwd, ["restore", "1"]);
			expect(restoreOldest.exitCode).toBe(0);
			expect(restoreOldest.stdout).toContain(
				"verified: restored declarations reproduce migration 1's recorded snapshot",
			);
			// restore 1 left src/app.schema.ts staged-but-uncommitted at
			// migration 1's content; clean the working tree back to HEAD
			// (migration 2) before the next restore -- restore refuses to run
			// over pending edits (dirty-working-tree), by design, no --force.
			git(cwd, ["checkout", "-q", "HEAD", "--", "src/app.schema.ts"]);

			const restoreCurrent = await runCli(cwd, ["restore", "2"]);
			expect(restoreCurrent.exitCode).toBe(0);
			expect(restoreCurrent.stdout).toContain(
				"verified: restored declarations reproduce migration 2's recorded snapshot",
			);
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
				"only migration 2's declaration state exists in git. Closest available: `hejbro restore 2`.",
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

	it("restore-state-mismatch: no drift candidates, banner records a hejbro version — names it in the message (f-1)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);

			const fileName = await soleMigrationFileName(cwd);
			const migrationPath = join(cwd, "migrations", fileName);
			await withMutatedCommittedSnapshot(cwd, migrationPath, (parsed) => ({
				...parsed,
				__restoreFixtureMarker: "f-1",
			}));
			const migrationText = await readFile(migrationPath, "utf8");
			await writeFile(
				migrationPath,
				withInjectedVersionLine(migrationText, "0.0.0-test"),
			);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[restore-state-mismatch]");
			expect(result.stderr).toContain(
				`migration 1 was generated by hejbro 0.0.0-test, this build is ${CLI_VERSION}`,
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("restore-state-mismatch: no drift candidates, no version line (pre-#229 migration) — the version-less wording (f-2)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);

			const fileName = await soleMigrationFileName(cwd);
			const migrationPath = join(cwd, "migrations", fileName);
			await withMutatedCommittedSnapshot(cwd, migrationPath, (parsed) => ({
				...parsed,
				__restoreFixtureMarker: "f-2",
			}));
			const withVersionLine = await readFile(migrationPath, "utf8");
			await writeFile(migrationPath, withRemovedVersionLine(withVersionLine));
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[restore-state-mismatch]");
			expect(result.stderr).toContain(
				"This migration predates hejbro recording its own version in the banner (#229)",
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("exits 0 with an older-format-version note (no reproduction check) when the target migration predates the current snapshot format (g)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);

			const fileName = await soleMigrationFileName(cwd);
			const migrationPath = join(cwd, "migrations", fileName);
			await withMutatedCommittedSnapshot(cwd, migrationPath, (parsed) => ({
				...parsed,
				formatVersion: 4,
			}));
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"note: migration 1 was generated under an older snapshot format (v4; this build is v8)",
			);
			expect(result.stdout).toContain(
				"the post-restore snapshot-reproduction check can't run across a format change",
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("restore-history-rewritten: refuses to restore a migration whose add-commit can't be found (renamed after its own commit)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_V1);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			const fileName = await soleMigrationFileName(cwd);
			const renamedFileName = `renamed_${fileName}`;
			renameSync(
				join(cwd, "migrations", fileName),
				join(cwd, "migrations", renamedFileName),
			);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "chore: rename migration file"]);

			const result = await runCli(cwd, ["restore", "1"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[restore-history-rewritten]");
			expect(result.stderr).toContain(`migrations/${renamedFileName}`);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});

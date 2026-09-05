import { execFileSync } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { transcript } from "./support/call-transcript";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";
import { GIT_TEST_ENV } from "./support/git-fixture";

beforeAll(assertBuiltCli);

/**
 * #413, 1.6: `hejbro upgrade` end to end over a real 0.1.1 project.
 *
 * The fixture (`test/fixtures/project-0.1.1/commit-{1,2,3}/`) replays that
 * project's own three real commits verbatim, each vendored via
 * `git show <sha>:<path>` against `hejbro@0.1.1`'s ancestry:
 * `4dc5c486` added migrations 1-4, `f27cbea3` added 5-6 (and regenerated
 * 1-4's own chain), `8b22258d` added 7 (and regenerated 1-6 again, the
 * tag's own final state). Each `commit-N` directory is a fully
 * self-consistent project snapshot -- its own migrations' banner hashes
 * chain onto its own `hejbro.snapshot.json` -- so replaying them as three
 * real commits reproduces the same history a clone of that project would
 * have, including its mixed `ok`/`lost` shape: only a migration whose
 * *current* (final) file content still hashes to *some* commit's own
 * snapshot blob resolves `ok`; every migration a later regeneration moved
 * past without ever being re-committed at the moved-to hash resolves
 * `lost`. This is `history-state.ts`'s ordinary behavior for a batch-
 * committed, repeatedly-regenerated project, unrelated to `upgrade`
 * itself (measured: only migration 7, the tag's own tip, resolves `ok`
 * before `upgrade` ever runs).
 */

const FIXTURE_ROOT = join(import.meta.dirname, "fixtures", "project-0.1.1");

// git environment variable names below, not a naming choice of this codebase's own
const FIXED_COMMIT_DATE_ENV = {
	...GIT_TEST_ENV,
	// biome-ignore lint/style/useNamingConvention: git environment variable name
	GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z",
	// biome-ignore lint/style/useNamingConvention: git environment variable name
	GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z",
};

const git = (cwd: string, args: ReadonlyArray<string>): string => {
	const stdout = execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: FIXED_COMMIT_DATE_ENV,
	});
	transcript.record({
		argv: ["git", ...args],
		cwd,
		exitCode: 0,
		stdout,
		stderr: "",
	});
	return stdout;
};

/** Copies one vendored `commit-N` tree over `cwd` and commits everything it adds/changes -- mirrors that batch's own real-history shape (§ doc comment above). Returns the new commit's full sha. */
const vendorCommit = async (
	cwd: string,
	batch: "commit-1" | "commit-2" | "commit-3",
	message: string,
): Promise<string> => {
	await cp(join(FIXTURE_ROOT, batch), cwd, { recursive: true });
	git(cwd, ["add", "-A"]);
	git(cwd, ["commit", "-q", "-m", message]);
	return git(cwd, ["rev-parse", "HEAD"]).trim();
};

/** One `hejbro history` row's `state`/`commit` columns for migration `fileName`, read from the table's own rendered text -- avoids re-implementing the table's column layout in the test. */
const historyRow = (stdout: string, fileName: string): string => {
	const line = stdout
		.split("\n")
		.find((candidate) => candidate.includes(fileName));
	if (line === undefined) {
		throw new Error(`no history row for ${fileName} in:\n${stdout}`);
	}
	return line;
};

const shortSha = (sha: string): string => sha.slice(0, 7);

describe("hejbro upgrade (#413, 1.6, e2e over a real 0.1.1 project)", () => {
	// Spawns the built CLI (and git) many times over one real repository --
	// heavier than this package's own 30_000ms default; scoped to this test
	// alone, matching examples/cli-smoke's own 120_000ms contended-phase
	// ceiling rather than raising the shared config.
	it("upgrades a real 0.1.1 project's snapshot, re-chains the tip, and every later command resolves it", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await vendorCommit(
				cwd,
				"commit-1",
				"feat(examples): postgres showcase with a local round-trip",
			);
			await vendorCommit(
				cwd,
				"commit-2",
				"feat(core): name and emit primary key / unique constraints deterministically",
			);
			const commit3 = await vendorCommit(
				cwd,
				"commit-3",
				"feat(core): keep schema-wide table grants in step with new tables",
			);

			// verify fails naming upgrade, before anything else runs
			const verifyBefore = await runCli(cwd, ["verify"]);
			expect(verifyBefore.exitCode).toBe(1);
			expect(verifyBefore.stderr).toContain(
				"error[unsupported-snapshot-version]",
			);
			expect(verifyBefore.stderr).toContain("Next: run `hejbro upgrade`");

			// history never parses the snapshot's content (only git blob
			// hashes), so a format-5 snapshot never fails it (#413, B1).
			const historyBefore = await runCli(cwd, ["history"]);
			expect(historyBefore.exitCode).toBe(0);
			// tip already self-consistent (the tag's own final state) --
			// resolves ok at its own real add-commit even pre-upgrade
			expect(
				historyRow(historyBefore.stdout, "0007_add_task_labels.sql"),
			).toContain("ok");
			expect(
				historyRow(historyBefore.stdout, "0007_add_task_labels.sql"),
			).toContain(shortSha(commit3));
			// every other migration was regenerated past by a later batch and
			// never re-committed at the state it moved to -- lost, unrelated
			// to upgrade (measured against the real 0.1.1 history, #413 report)
			const lostFileNamesBefore = [
				"0001_add_app.sql",
				"0002_alter_tasks.sql",
				"0003_alter_projects.sql",
				"0004_add_task_schedules.sql",
				"0005_add_task_tags.sql",
				"0006_alter_task_tags.sql",
			];
			lostFileNamesBefore
				.map((fileName) => historyRow(historyBefore.stdout, fileName))
				.map((row) => expect(row).toContain("lost"));

			// upgrade rewrites the snapshot and re-chains the tip
			const upgrade = await runCli(cwd, ["upgrade"]);
			expect(upgrade.exitCode).toBe(0);
			expect(upgrade.stdout).toContain(
				"upgraded hejbro.snapshot.json: format 5 → 8",
			);
			expect(upgrade.stdout).toContain(
				"re-chained migrations/0007_add_task_labels.sql",
			);

			const verifyAfterUpgrade = await runCli(cwd, ["verify"]);
			expect(verifyAfterUpgrade.exitCode).toBe(0);

			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "chore: hejbro upgrade"]);

			// history after the upgrade is committed: the tip still resolves
			// ok at the SAME original add-commit (never the upgrade commit
			// itself), and every other migration's row is byte-identical to
			// what it was before -- upgrade touches nothing else
			const historyAfter = await runCli(cwd, ["history"]);
			expect(historyAfter.exitCode).toBe(0);
			expect(
				historyRow(historyAfter.stdout, "0007_add_task_labels.sql"),
			).toContain("ok");
			expect(
				historyRow(historyAfter.stdout, "0007_add_task_labels.sql"),
			).toContain(shortSha(commit3));
			lostFileNamesBefore.map((fileName) =>
				expect(historyRow(historyAfter.stdout, fileName)).toBe(
					historyRow(historyBefore.stdout, fileName),
				),
			);

			// restore of the upgraded tip succeeds
			const restore = await runCli(cwd, ["restore", "7"]);
			expect(restore.exitCode).toBe(0);
			expect(restore.stdout).toContain(
				"verified: restored declarations reproduce migration 7's recorded snapshot",
			);
			git(cwd, ["checkout", "--", "src/app.schema.ts"]);

			// a declaration edit chains the next migration onto the upgraded
			// hash, and verify accepts the chain
			const schemaPath = join(cwd, "src", "app.schema.ts");
			const schemaText = await readFile(schemaPath, "utf8");
			await writeFile(
				schemaPath,
				schemaText.replace(
					"label: text().notNull(),",
					"label: text().notNull(),\n\t\tcolor: text(),",
				),
			);

			const generate = await runCli(cwd, ["generate"]);
			expect(generate.exitCode).toBe(0);
			const newMigration = await readFile(
				join(cwd, "migrations", "0008_alter_task_labels.sql"),
				"utf8",
			);
			const upgradedTip = await readFile(
				join(cwd, "migrations", "0007_add_task_labels.sql"),
				"utf8",
			);
			const tipSnapshotLine = upgradedTip
				.split("\n")
				.find((line) => line.startsWith("-- snapshot: "));
			if (tipSnapshotLine === undefined) {
				throw new Error("upgraded tip carries no -- snapshot: line");
			}
			expect(newMigration).toContain(
				`-- parent-snapshot: ${tipSnapshotLine.replace("-- snapshot: ", "")}`,
			);

			const verifyAfterGenerate = await runCli(cwd, ["verify"]);
			expect(verifyAfterGenerate.exitCode).toBe(0);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 120_000);
});

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationAddedCommits } from "../src/git";
import { sha256Hex } from "../src/hash";
import { computeMigrationState } from "../src/history-state";
import type { GitFixture } from "./support/git-fixture";
import { createGitFixture } from "./support/git-fixture";

const write = (cwd: string, relativePath: string, content: string): void => {
	const fullPath = join(cwd, relativePath);
	mkdirSync(join(fullPath, ".."), { recursive: true });
	writeFileSync(fullPath, content);
};

const snapshotHashAt = (content: string): string =>
	`sha256:${sha256Hex(content)}`;

describe("computeMigrationState", () => {
	let fixture: GitFixture;

	beforeEach(async () => {
		fixture = await createGitFixture();
	});

	afterEach(async () => {
		await fixture.cleanup();
	});

	it("ok: the migration's own add-commit already carries a matching snapshot blob", async () => {
		write(fixture.cwd, "migrations/0001_add_a.sql", "-- hejbro migration\n");
		const snapshotV1 = '{"formatVersion":5,"v":1}';
		write(fixture.cwd, "hejbro.snapshot.json", snapshotV1);
		fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			snapshotHashAt(snapshotV1),
			null,
			addedCommits,
			"0001_add_a.sql",
		);
		expect(result.state).toBe("ok");
		expect(result.commit?.subject).toBe("feat: a");
	});

	it("ok (fallback): the add-commit's own blob doesn't match, but an earlier/later commit's does", async () => {
		const snapshotV1 = '{"formatVersion":5,"v":1}';
		write(fixture.cwd, "migrations/0001_add_a.sql", "-- hejbro migration\n");
		write(fixture.cwd, "hejbro.snapshot.json", snapshotV1);
		fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		const snapshotV2 = '{"formatVersion":5,"v":2}';
		write(fixture.cwd, "migrations/0002_add_b.sql", "-- hejbro migration\n");
		write(fixture.cwd, "hejbro.snapshot.json", snapshotV2);
		fixture.commit("feat: b", "2026-01-02T10:00:00Z");

		// migration 0001's OWN add-commit ("feat: a") carries the v1 blob,
		// not v1 -- reuse it directly: this is the "already matches" case,
		// already covered above. To exercise the fallback, ask about a
		// hash that ISN'T at 0001's own add-commit but IS recorded at a
		// later commit touching the same snapshot path (simulating a
		// squash that moved the matching content to a different commit).
		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			snapshotHashAt(snapshotV2),
			null,
			addedCommits,
			"0001_add_a.sql",
		);
		expect(result.state).toBe("ok");
		expect(result.commit?.subject).toBe("feat: b");
	});

	it("lost: no commit reachable from HEAD carries a matching snapshot blob", async () => {
		write(fixture.cwd, "migrations/0001_add_a.sql", "-- hejbro migration\n");
		write(fixture.cwd, "hejbro.snapshot.json", '{"formatVersion":5,"v":1}');
		fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			"sha256:never-recorded-anywhere",
			null,
			addedCommits,
			"0001_add_a.sql",
		);
		expect(result.state).toBe("lost");
		// still names the commit that added the *file*, for the note text.
		expect(result.commit?.subject).toBe("feat: a");
	});

	it("uncommitted: the migration file was never committed at all", async () => {
		write(fixture.cwd, "hejbro.snapshot.json", '{"formatVersion":5,"v":0}');
		fixture.commit("chore: init", "2026-01-01T10:00:00Z");
		write(fixture.cwd, "migrations/0002_add_b.sql", "-- hejbro migration\n");

		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			"sha256:whatever",
			null,
			addedCommits,
			"0002_add_b.sql",
		);
		expect(result.state).toBe("uncommitted");
		expect(result.commit).toBeNull();
	});

	// `rewritten` (a migration file that IS tracked and clean, yet no
	// commit reachable from HEAD ever shows it as freshly added) DOES have
	// a natural repro: a rename. Git's default rename detection (on since
	// 2.9, confirmed empirically against this machine's git 2.50.1) turns
	// a plain rename into an `R100` log entry instead of a `D`+`A` pair --
	// so the renamed path never appears under `--diff-filter=A`, exactly
	// as if its own add-commit had been lost to history rewriting.
	it("rewritten: a migration file renamed after its own commit has no add-commit event of its own (real git repro)", async () => {
		write(fixture.cwd, "migrations/0001_add_a.sql", "-- hejbro migration\n");
		write(fixture.cwd, "hejbro.snapshot.json", '{"formatVersion":5,"v":1}');
		fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		renameSync(
			join(fixture.cwd, "migrations/0001_add_a.sql"),
			join(fixture.cwd, "migrations/0001_add_a_renamed.sql"),
		);
		fixture.commit("chore: rename", "2026-01-02T10:00:00Z");

		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		expect(addedCommits.has("0001_add_a_renamed.sql")).toBe(false);

		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			"sha256:whatever",
			null,
			addedCommits,
			"0001_add_a_renamed.sql",
		);
		expect(result.state).toBe("rewritten");
		expect(result.commit).toBeNull();
	});

	// #413: after `hejbro upgrade`, the tip's `-- snapshot:` line names the
	// re-encoded bytes' hash, but the commit that originally *added* the
	// file still carries the pre-upgrade (older-format) blob -- which
	// hashes to the `-- upgraded-from:` value, not the current one.
	it("ok (upgraded-from): the add-commit's own blob is the pre-upgrade format, matching upgraded-from rather than the current hash", async () => {
		write(fixture.cwd, "migrations/0001_add_a.sql", "-- hejbro migration\n");
		const oldFormatSnapshot = '{"formatVersion":5,"v":1}';
		write(fixture.cwd, "hejbro.snapshot.json", oldFormatSnapshot);
		fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			"sha256:the-re-encoded-hash-no-commit-carries-yet",
			snapshotHashAt(oldFormatSnapshot),
			addedCommits,
			"0001_add_a.sql",
		);
		expect(result.state).toBe("ok");
		expect(result.commit?.subject).toBe("feat: a");
	});

	it("ok (upgraded-from): still reports the original add-commit even when a later commit's own snapshot blob happens to match the current hash", async () => {
		write(fixture.cwd, "migrations/0001_add_a.sql", "-- hejbro migration\n");
		const oldFormatSnapshot = '{"formatVersion":5,"v":1}';
		write(fixture.cwd, "hejbro.snapshot.json", oldFormatSnapshot);
		fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		// Simulates a committed `hejbro upgrade`: a LATER commit rewrites
		// the snapshot file to the re-encoded bytes. If the candidate/
		// upgraded-from check were ever dropped in favor of the fallback
		// search alone, this later commit is exactly what
		// `findCommitMatchingHash` would find against `bannerCurrentHash`,
		// silently reporting the upgrade commit instead of the migration's
		// own original add-commit -- the delta scenario's own wording is
		// "at the commit that originally added it".
		const upgradedSnapshot = '{"formatVersion":8,"v":1}';
		write(fixture.cwd, "hejbro.snapshot.json", upgradedSnapshot);
		fixture.commit("chore: hejbro upgrade", "2026-01-02T10:00:00Z");

		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			snapshotHashAt(upgradedSnapshot),
			snapshotHashAt(oldFormatSnapshot),
			addedCommits,
			"0001_add_a.sql",
		);
		expect(result.state).toBe("ok");
		expect(result.commit?.subject).toBe("feat: a");
	});

	it("lost: a blob matching neither the current hash nor upgraded-from stays lost", async () => {
		write(fixture.cwd, "migrations/0001_add_a.sql", "-- hejbro migration\n");
		write(fixture.cwd, "hejbro.snapshot.json", '{"formatVersion":5,"v":1}');
		fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		const addedCommits = migrationAddedCommits(fixture.cwd, "migrations");
		const result = computeMigrationState(
			fixture.cwd,
			"migrations",
			"hejbro.snapshot.json",
			"sha256:never-recorded-anywhere",
			"sha256:also-never-recorded-anywhere",
			addedCommits,
			"0001_add_a.sql",
		);
		expect(result.state).toBe("lost");
		expect(result.commit?.subject).toBe("feat: a");
	});
});

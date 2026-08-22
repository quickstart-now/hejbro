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
			addedCommits,
			"0001_add_a_renamed.sql",
		);
		expect(result.state).toBe("rewritten");
		expect(result.commit).toBeNull();
	});
});

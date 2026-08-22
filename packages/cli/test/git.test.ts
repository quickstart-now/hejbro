import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	blobAt,
	coAddedCount,
	diffNameOnly,
	findCommitMatchingHash,
	isGitRepository,
	isWorkingTreeDirty,
	listTreeFiles,
	migrationAddedCommits,
	remoteUrl,
	removeFiles,
	restoreFilesFromCommit,
} from "../src/git";
import { sha256Hex } from "../src/hash";
import type { GitFixture } from "./support/git-fixture";
import { createGitFixture } from "./support/git-fixture";

const write = (cwd: string, relativePath: string, content: string): void => {
	const fullPath = join(cwd, relativePath);
	mkdirSync(join(fullPath, ".."), { recursive: true });
	writeFileSync(fullPath, content);
};

describe("git.ts", () => {
	let fixture: GitFixture;
	// Commits: c1 adds migrations/0001 (+ v1 snapshot); c2 adds both
	// migrations/0002 and 0003 together (a squash-merge shape, M4); c3
	// only edits 0002's own body (not the banner) -- a non-"add" change,
	// must not appear in migrationAddedCommits.
	let c1 = "";
	let c2 = "";
	let c3 = "";

	beforeEach(async () => {
		fixture = await createGitFixture();
		write(
			fixture.cwd,
			"migrations/0001_add_a.sql",
			"-- hejbro migration\ncreate table a();\n",
		);
		write(fixture.cwd, "hejbro.snapshot.json", '{"formatVersion":5,"v":1}');
		c1 = fixture.commit("feat: a", "2026-01-01T10:00:00Z");

		write(
			fixture.cwd,
			"migrations/0002_add_b.sql",
			"-- hejbro migration\ncreate table b();\n",
		);
		write(
			fixture.cwd,
			"migrations/0003_add_c.sql",
			"-- hejbro migration\ncreate table c();\n",
		);
		write(fixture.cwd, "hejbro.snapshot.json", '{"formatVersion":5,"v":3}');
		c2 = fixture.commit("feat: b and c (squash)", "2026-01-02T10:00:00Z");

		write(
			fixture.cwd,
			"migrations/0002_add_b.sql",
			"-- hejbro migration\ncreate table b();\n-- reviewed\n",
		);
		c3 = fixture.commit("docs: annotate 0002", "2026-01-03T10:00:00Z");
	});

	afterEach(async () => {
		await fixture.cleanup();
	});

	it("isGitRepository: true inside a repo, false elsewhere", () => {
		expect(isGitRepository(fixture.cwd)).toBe(true);
		expect(isGitRepository("/")).toBe(false);
	});

	it("isWorkingTreeDirty: false right after a commit, true once a tracked file changes, true once an untracked file appears", () => {
		expect(isWorkingTreeDirty(fixture.cwd)).toBe(false);
		write(fixture.cwd, "migrations/0001_add_a.sql", "changed\n");
		expect(isWorkingTreeDirty(fixture.cwd)).toBe(true);
		fixture.commit("wip", "2026-01-04T10:00:00Z");
		expect(isWorkingTreeDirty(fixture.cwd)).toBe(false);
		write(fixture.cwd, "untracked.txt", "x");
		expect(isWorkingTreeDirty(fixture.cwd)).toBe(true);
	});

	it("migrationAddedCommits: one entry per added migration file, c2 shared by 0002 and 0003, c3's body-only edit does not appear", () => {
		const added = migrationAddedCommits(fixture.cwd, "migrations");
		expect(added.get("0001_add_a.sql")?.sha).toBe(c1);
		expect(added.get("0002_add_b.sql")?.sha).toBe(c2);
		expect(added.get("0003_add_c.sql")?.sha).toBe(c2);
		expect(added.get("0001_add_a.sql")?.date).toBe("2026-01-01");
		expect(added.get("0001_add_a.sql")?.subject).toBe("feat: a");
		expect(added.size).toBe(3);
	});

	it("coAddedCount: 1 for c1's own commit, 2 for c2's squash commit", () => {
		expect(coAddedCount(fixture.cwd, c1, "migrations")).toBe(1);
		expect(coAddedCount(fixture.cwd, c2, "migrations")).toBe(2);
	});

	it("blobAt: returns the exact bytes the snapshot file had at that commit", () => {
		const blob = blobAt(fixture.cwd, c1, "hejbro.snapshot.json");
		expect(blob.toString("utf8")).toBe('{"formatVersion":5,"v":1}');
		const laterBlob = blobAt(fixture.cwd, c2, "hejbro.snapshot.json");
		expect(laterBlob.toString("utf8")).toBe('{"formatVersion":5,"v":3}');
	});

	it("findCommitMatchingHash: finds the commit whose snapshot blob hashes to the given value, undefined for a hash that was never recorded", () => {
		const hashAtC1 = `sha256:${sha256Hex(blobAt(fixture.cwd, c1, "hejbro.snapshot.json"))}`;
		const found = findCommitMatchingHash(
			fixture.cwd,
			"hejbro.snapshot.json",
			hashAtC1,
		);
		expect(found?.sha).toBe(c1);

		const neverRecorded =
			"sha256:0000000000000000000000000000000000000000000000000000000000000000";
		expect(
			findCommitMatchingHash(
				fixture.cwd,
				"hejbro.snapshot.json",
				neverRecorded,
			),
		).toBeUndefined();
	});

	it("listTreeFiles: lists exactly the migration files present in a given commit's tree", () => {
		expect(listTreeFiles(fixture.cwd, c1, "migrations")).toEqual([
			"migrations/0001_add_a.sql",
		]);
		expect(listTreeFiles(fixture.cwd, c2, "migrations")).toEqual([
			"migrations/0001_add_a.sql",
			"migrations/0002_add_b.sql",
			"migrations/0003_add_c.sql",
		]);
	});

	it("diffNameOnly: names exactly the files that changed between two commits under a pathspec", () => {
		expect(diffNameOnly(fixture.cwd, c1, c2, "migrations")).toEqual([
			"migrations/0002_add_b.sql",
			"migrations/0003_add_c.sql",
		]);
		expect(diffNameOnly(fixture.cwd, c2, c3, "migrations")).toEqual([
			"migrations/0002_add_b.sql",
		]);
	});

	it("remoteUrl: null when there is no origin remote", () => {
		expect(remoteUrl(fixture.cwd)).toBeNull();
	});

	it("remoteUrl: the configured origin URL when one exists", () => {
		execFileSync(
			"git",
			["remote", "add", "origin", "https://github.com/example/repo.git"],
			{ cwd: fixture.cwd },
		);
		expect(remoteUrl(fixture.cwd)).toBe("https://github.com/example/repo.git");
	});

	it("restoreFilesFromCommit: writes the file back to its state at that commit", () => {
		// Restores 0002 back to its c2 (pre-c3-edit) text.
		restoreFilesFromCommit(fixture.cwd, c2, ["migrations/0002_add_b.sql"]);
		const content = readFileSync(
			join(fixture.cwd, "migrations/0002_add_b.sql"),
			"utf8",
		);
		expect(content).toBe("-- hejbro migration\ncreate table b();\n");
	});

	it("removeFiles: deletes the given files from the working tree", () => {
		expect(existsSync(join(fixture.cwd, "migrations/0003_add_c.sql"))).toBe(
			true,
		);
		removeFiles(fixture.cwd, ["migrations/0003_add_c.sql"]);
		expect(existsSync(join(fixture.cwd, "migrations/0003_add_c.sql"))).toBe(
			false,
		);
	});
});

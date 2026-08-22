import { describe, expect, it } from "vitest";
import type { HistoryRow } from "../src/history-table";
import { renderHistoryTable } from "../src/history-table";

const commit = (sha: string, date: string, subject: string) => ({
	sha,
	date,
	subject,
});

describe("renderHistoryTable", () => {
	it("renders an all-ok table, oldest first, columns aligned", () => {
		const rows: ReadonlyArray<HistoryRow> = [
			{
				number: 1,
				migrationFileName: "0001_add_a.sql",
				state: "ok",
				commit: commit(
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"2026-01-01",
					"feat: a",
				),
				snapshotHash: "sha256:1111111111111111111111111111111111111111",
			},
			{
				number: 2,
				migrationFileName: "0002_add_b.sql",
				state: "ok",
				commit: commit(
					"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					"2026-01-02",
					"feat: b",
				),
				snapshotHash: "sha256:2222222222222222222222222222222222222222",
			},
		];
		const output = renderHistoryTable(rows, {
			linkMode: "none",
			remote: null,
			migrationsDirRelative: "migrations",
		});
		const lines = output.split("\n");
		expect(lines[0]).toBe(
			"#  migration       commit   date        state  snapshot              subject",
		);
		expect(lines[1]).toBe(
			"1  0001_add_a.sql  aaaaaaa  2026-01-01  ok     sha256:111111111111…  feat: a",
		);
		expect(lines[2]).toBe(
			"2  0002_add_b.sql  bbbbbbb  2026-01-02  ok     sha256:222222222222…  feat: b",
		);
		expect(lines).toHaveLength(3);
	});

	it("renders placeholders for uncommitted/rewritten rows, no trailing note for uncommitted", () => {
		const rows: ReadonlyArray<HistoryRow> = [
			{
				number: 1,
				migrationFileName: "0001_add_a.sql",
				state: "uncommitted",
				commit: null,
				snapshotHash: "sha256:1111111111111111111111111111111111111111",
			},
		];
		const output = renderHistoryTable(rows, {
			linkMode: "none",
			remote: null,
			migrationsDirRelative: "migrations",
		});
		expect(output).toContain("(uncommitted)");
		expect(output).not.toContain("note:");
	});

	it("renders a rewritten note for a rewritten row", () => {
		const rows: ReadonlyArray<HistoryRow> = [
			{
				number: 5,
				migrationFileName: "0005_add_e.sql",
				state: "rewritten",
				commit: null,
				snapshotHash: "sha256:5555555555555555555555555555555555555555",
			},
		];
		const output = renderHistoryTable(rows, {
			linkMode: "none",
			remote: null,
			migrationsDirRelative: "migrations",
		});
		expect(output).toContain(
			"note: migration 5's commit could not be found — history may have been rewritten (rebase/force-push). Check `git reflog` or the original feature branch.",
		);
	});

	it("renders a squash-merge lost note naming the survivor migration", () => {
		const sharedCommit = commit(
			"cccccccccccccccccccccccccccccccccccccccc",
			"2026-01-03",
			"feat: b and c",
		);
		const rows: ReadonlyArray<HistoryRow> = [
			{
				number: 2,
				migrationFileName: "0002_add_b.sql",
				state: "lost",
				commit: sharedCommit,
				snapshotHash: "sha256:2222222222222222222222222222222222222222",
			},
			{
				number: 3,
				migrationFileName: "0003_add_c.sql",
				state: "ok",
				commit: sharedCommit,
				snapshotHash: "sha256:3333333333333333333333333333333333333333",
			},
		];
		const output = renderHistoryTable(rows, {
			linkMode: "none",
			remote: null,
			migrationsDirRelative: "migrations",
		});
		expect(output).toContain(
			"note: migrations 2 and 3 were added together in commit ccccccc — only migration 3's declaration state exists in git (squash merge lost migration 2's). Closest available: `hejbro restore 3`.",
		);
	});

	it("--links plain adds migration-url/commit-url columns for github remotes", () => {
		const rows: ReadonlyArray<HistoryRow> = [
			{
				number: 1,
				migrationFileName: "0001_add_a.sql",
				state: "ok",
				commit: commit(
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"2026-01-01",
					"feat: a",
				),
				snapshotHash: "sha256:1111111111111111111111111111111111111111",
			},
		];
		const output = renderHistoryTable(rows, {
			linkMode: "plain",
			remote: "https://github.com/example/repo.git",
			migrationsDirRelative: "migrations",
		});
		expect(output).toContain("migration-url");
		expect(output).toContain("commit-url");
		expect(output).toContain(
			"https://github.com/example/repo/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/migrations/0001_add_a.sql",
		);
		expect(output).toContain(
			"https://github.com/example/repo/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		);
	});

	it("osc8 mode wraps commit/migration cell text without changing it or adding columns", () => {
		const rows: ReadonlyArray<HistoryRow> = [
			{
				number: 1,
				migrationFileName: "0001_add_a.sql",
				state: "ok",
				commit: commit(
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"2026-01-01",
					"feat: a",
				),
				snapshotHash: "sha256:1111111111111111111111111111111111111111",
			},
		];
		const output = renderHistoryTable(rows, {
			linkMode: "osc8",
			remote: "https://github.com/example/repo.git",
			migrationsDirRelative: "migrations",
		});
		expect(output).not.toContain("migration-url");
		expect(output).toContain("0001_add_a.sql");
		expect(output).toContain("aaaaaaa");
		expect(output).toContain("\x1b]8;;https://github.com/example/repo/blob/");
	});
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileAtRemoteCommit, resolveRemoteHead } from "../src/git";
import type { GitFixture } from "./support/git-fixture";
import { createGitFixture } from "./support/git-fixture";

// A local repository path is a fully valid git remote (file-based
// transport) -- `git ls-remote`/`git fetch` behave identically against
// it whether it's bare or not, so `fixture.cwd` doubles as "the remote"
// here with no network involved, matching the group's own network-free
// requirement.

describe("git.ts remote functions", () => {
	let remote: GitFixture;
	let cwd: string;

	beforeEach(async () => {
		remote = await createGitFixture();
		cwd = await mkdtemp(join(tmpdir(), "hejbro-git-remote-test-"));
	});

	afterEach(async () => {
		await remote.cleanup();
		await rm(cwd, { recursive: true, force: true });
	});

	it("resolves the default branch and its commit", async () => {
		await writeFile(join(remote.cwd, "a.txt"), "1");
		const first = remote.commit("first", "2026-01-01T10:00:00Z");
		await writeFile(join(remote.cwd, "a.txt"), "2");
		const second = remote.commit("second", "2026-01-02T10:00:00Z");

		const head = resolveRemoteHead(cwd, remote.cwd);
		expect(head.branch).toBe("main");
		expect(head.commit).toBe(second);
		expect(head.commit).not.toBe(first);
	});

	it("reads a file at a given commit", async () => {
		await writeFile(join(remote.cwd, "schema.json"), '{"v":1}');
		const first = remote.commit("first", "2026-01-01T10:00:00Z");
		await writeFile(join(remote.cwd, "schema.json"), '{"v":2}');
		remote.commit("second", "2026-01-02T10:00:00Z");

		// Reads the OLDER commit's content directly, without ever checking
		// the branch tip out -- exactly what a pinned lock needs once the
		// remote's default branch has moved past it.
		const bytes = readFileAtRemoteCommit(remote.cwd, first, "schema.json");
		expect(bytes?.toString("utf8")).toBe('{"v":1}');
	});

	it("returns null for a path the commit doesn't carry", async () => {
		await writeFile(join(remote.cwd, "a.txt"), "1");
		const first = remote.commit("first", "2026-01-01T10:00:00Z");

		const bytes = readFileAtRemoteCommit(remote.cwd, first, "missing.json");
		expect(bytes).toBeNull();
	});
});

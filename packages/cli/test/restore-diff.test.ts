import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	computeFileDiff,
	renderFileDiffLines,
	renderUndoBlock,
} from "../src/restore-diff";
import type { GitFixture } from "./support/git-fixture";
import { createGitFixture } from "./support/git-fixture";

const write = (cwd: string, relativePath: string, content: string): void => {
	const fullPath = join(cwd, relativePath);
	mkdirSync(join(fullPath, ".."), { recursive: true });
	writeFileSync(fullPath, content);
};

describe("computeFileDiff", () => {
	let fixture: GitFixture;
	let sha1 = "";

	beforeEach(async () => {
		fixture = await createGitFixture();
		write(fixture.cwd, "src/a.schema.ts", "// a v1\n");
		write(fixture.cwd, "src/b.schema.ts", "// b\n");
		sha1 = fixture.commit("feat: a and b", "2026-01-01T10:00:00Z");

		write(fixture.cwd, "src/a.schema.ts", "// a v2\n");
		rmSync(join(fixture.cwd, "src/b.schema.ts"));
		write(fixture.cwd, "src/c.schema.ts", "// c\n");
		fixture.commit("feat: a v2, drop b, add c", "2026-01-02T10:00:00Z");
	});

	afterEach(async () => {
		await fixture.cleanup();
	});

	it("groups matched files into overwrite/resurrect/remove against a target commit", () => {
		const diff = computeFileDiff(fixture.cwd, sha1, ["src/**/*.schema.ts"]);
		expect(diff).toEqual([
			{ marker: "+", path: "src/b.schema.ts" },
			{ marker: "~", path: "src/a.schema.ts" },
			{ marker: "-", path: "src/c.schema.ts" },
		]);
	});

	it("renders plain (no ANSI) file-diff lines when not a TTY", () => {
		const originalIsTTY = process.stdout.isTTY;
		process.stdout.isTTY = false;
		try {
			const diff = computeFileDiff(fixture.cwd, sha1, ["src/**/*.schema.ts"]);
			const lines = renderFileDiffLines(diff, 1);
			expect(lines).toEqual([
				"+ restored src/b.schema.ts (existed at migration 1, absent now)",
				"~ restored src/a.schema.ts",
				"- removed src/c.schema.ts (didn't exist at migration 1)",
			]);
		} finally {
			process.stdout.isTTY = originalIsTTY;
		}
	});

	it("renders an undo block naming every written path, grouped by marker", () => {
		const diff = computeFileDiff(fixture.cwd, sha1, ["src/**/*.schema.ts"]);
		const undo = renderUndoBlock(diff);
		expect(undo).toEqual([
			"restore never commits — everything above is undoable:",
			"git checkout HEAD -- src/c.schema.ts     # bring back the removed file",
			"rm src/b.schema.ts     # remove the resurrected file (didn't exist before restore)",
			"git checkout HEAD -- src/a.schema.ts     # revert the modified files",
		]);
	});

	it("renders no undo block when nothing was written", () => {
		expect(renderUndoBlock([])).toEqual([]);
	});
});

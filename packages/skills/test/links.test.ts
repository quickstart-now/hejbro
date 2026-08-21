import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Task 28 acceptance: every repo path the hejbro skill's SKILL.md/reference
// docs cite must actually exist on disk — a stale path is a broken pointer
// an agent following the skill would hit mid-task.

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SKILLS_DIR = join(REPO_ROOT, "skills", "hejbro");

/** Recursively lists every `.md` file under `dir`. */
const markdownFiles = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			return markdownFiles(full);
		}
		if (entry.name.endsWith(".md")) {
			return [full];
		}
		return [];
	});

// The reference docs cite paths as backticked code (` `examples/…` `) —
// this repo's own style — plus, for any future markdown-link form, the
// usual `[text](path)`. Both are scoped to the repo's own top-level
// directories so inline code with an unrelated slash never matches.
const BACKTICK_PATH = /`((?:examples|packages|docs|skills)\/[^`\s]+)`/g;
const MARKDOWN_LINK_PATH =
	/\]\(((?:examples|packages|docs|skills)\/[^)\s]+)\)/g;

const collectPaths = (text: string): ReadonlyArray<string> => [
	...[...text.matchAll(BACKTICK_PATH)].map((match) => match[1] as string),
	...[...text.matchAll(MARKDOWN_LINK_PATH)].map((match) => match[1] as string),
];

describe("hejbro skill references cite paths that exist", () => {
	it("every backticked/linked repo path in skills/hejbro resolves on disk", () => {
		const files = markdownFiles(SKILLS_DIR);
		expect(files.length).toBeGreaterThan(0);

		const allPaths = files.flatMap((file) =>
			collectPaths(readFileSync(file, "utf8")),
		);
		// Globs (e.g. `examples/postgres/migrations/*.sql`) name a pattern,
		// not a file — the references cite real filenames instead, but
		// exclude any glob defensively rather than false-failing on one.
		const concretePaths = allPaths.filter((path) => !path.includes("*"));
		const uniquePaths = [...new Set(concretePaths)];

		// Guard against a vacuous pass — a regex edit that stops matching
		// anything would otherwise leave this test green while checking
		// nothing at all.
		expect(uniquePaths.length).toBeGreaterThan(0);

		const missing = uniquePaths.filter(
			(path) => !existsSync(join(REPO_ROOT, path)),
		);
		expect(missing).toEqual([]);
	});
});

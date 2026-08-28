import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownFiles } from "./markdown-files";
import type { AllowlistEntry } from "./snippet-check";
import { checkSnippets, extractSnippets, REPO_ROOT } from "./snippet-check";

/**
 * TDD/red-proof gate for every ` ```ts ` code block under `skills/hejbro/`
 * (#373): each one is type-checked against this repo's own real source
 * (never `dist` — #131 policy), so a snippet that drifts from the actual
 * API surface fails loudly instead of silently rotting in prose.
 *
 * ## The directive contract
 *
 * A fence's info string can carry space-separated tokens right after `ts`
 * — this is where a snippet opts into non-default checking, never inside
 * the code body itself (the body must stay exactly what an agent would
 * paste):
 *
 *     ```ts [prelude=<name>] [expect-error] [no-check=<reason-slug>]
 *
 * - No token: the block must type-check on its own — including its own
 *   imports; nothing is implicitly in scope.
 * - `prelude=<name>`: `fixtures/preludes/<name>.ts` is prepended to the
 *   block before type-checking, both compiled together as one program
 *   unit — for a snippet that needs a `handle`/`schema` a full doc example
 *   would otherwise have to re-declare every time. A diagnostic inside the
 *   prelude portion is attributed back to the prelude fixture file, not
 *   the doc.
 * - `expect-error`: the block must FAIL to type-check — for a doc's own
 *   "don't write it this way" example. A clean compile here is itself a
 *   violation (the example stopped demonstrating the mistake it's there
 *   to show).
 * - `no-check=<reason-slug>`: the block is never type-checked at all. This
 *   is a last resort, not a way to silence a real drift — it only passes
 *   when `{ doc, slug }` is listed verbatim in `NO_CHECK_ALLOWLIST` below,
 *   so every escape hatch stays visible in review rather than disappearing
 *   into a comment nobody re-reads.
 *
 * A fence tagged anything other than `ts` (```` ```json ````, a bare
 * ```` ``` ````, …) is never a compile target — see the migration-banner
 * example in generate-verify-workflow.md.
 */

const SKILLS_DIR = join(REPO_ROOT, "skills", "hejbro");

// Empty by design (T5 point 8): every existing snippet type-checks as
// written. Add an entry here only when a snippet genuinely cannot be
// type-checked in isolation — never to paper over a snippet that's simply
// wrong (fix the doc instead).
const NO_CHECK_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [];

const violationsForSkillsDocs = () => {
	const files = markdownFiles(SKILLS_DIR);
	const snippets = files.flatMap((file) =>
		extractSnippets(readFileSync(file, "utf8"), relative(REPO_ROOT, file)),
	);
	return { snippets, violations: checkSnippets(snippets, NO_CHECK_ALLOWLIST) };
};

describe("hejbro skill's ts snippets type-check against real source", () => {
	it("every ```ts block under skills/hejbro/ compiles cleanly (or fails exactly where expect-error/no-check say it should)", () => {
		const { snippets, violations } = violationsForSkillsDocs();

		// Vacuous-pass guard (same lesson as links.test.ts): a regex/parser
		// edit that stopped matching anything would otherwise leave this
		// green while checking nothing.
		expect(snippets.length).toBeGreaterThan(0);

		if (violations.length > 0) {
			const report = violations
				.map((v) => `${v.docPath}:${v.line}: ${v.message}`)
				.join("\n");
			expect(violations, `snippet violations:\n${report}`).toEqual([]);
		}
	});
});

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { markdownFiles } from "./markdown-files";
import type { AllowlistEntry } from "./snippet-check";
import {
	checkSnippets,
	extractSnippets,
	findMislabeledFences,
	REPO_ROOT,
} from "./snippet-check";

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
 *     ```ts [prelude=<name>] [expect-error=<ts-diagnostic-code>] [no-check=<reason-slug>]
 *
 * - No token: the block must type-check on its own — including its own
 *   imports; nothing is implicitly in scope.
 * - `prelude=<name>`: `fixtures/preludes/<name>.ts` is prepended to the
 *   block before type-checking, both compiled together as one program
 *   unit — for a snippet that needs a `handle`/`schema` a full doc example
 *   would otherwise have to re-declare every time. A diagnostic inside the
 *   prelude portion is attributed back to the prelude fixture file, not
 *   the doc.
 * - `expect-error=<code>`: the block must raise a diagnostic carrying that
 *   exact TS code (e.g. `expect-error=2339`) — for a doc's own "don't
 *   write it this way" example. A bare `expect-error` with no code is
 *   rejected as an unknown directive: without a code, *any* diagnostic
 *   passes, so a snippet that fails for an unrelated reason (a typo'd
 *   import) could masquerade as demonstrating the documented mistake. A
 *   clean compile, or a compile that fails with a different code, is
 *   itself a violation naming the expected code and what was actually
 *   observed.
 * - `no-check=<reason-slug>`: the block is never type-checked at all. This
 *   is a last resort, not a way to silence a real drift — it only passes
 *   when `{ doc, slug }` is listed verbatim in `NO_CHECK_ALLOWLIST` below,
 *   so every escape hatch stays visible in review rather than disappearing
 *   into a comment nobody re-reads.
 *
 * A fence tagged anything other than `ts` (```` ```json ````, a bare
 * ```` ``` ````, …) is never a compile target — see the migration-banner
 * example in generate-verify-workflow.md. A fence that *looks* like
 * TypeScript but isn't spelled exactly ` ```ts ` (```` ```typescript ````,
 * ```` ```tsx ````, …) is a separate violation (`findMislabeledFences`
 * below) rather than silently skipped — that mislabeling is indistinguishable
 * from an author trying to bypass the gate.
 */

const SKILLS_DIR = join(REPO_ROOT, "skills", "hejbro");

// Empty by design (T5 point 8, capped at 1 by TERMINAL v1.1): every
// existing snippet type-checks as written. Add an entry here only when a
// snippet genuinely cannot be type-checked in isolation, with the
// TS-inexpressible reason recorded in both the slug and a comment here —
// never to paper over a snippet that's simply wrong (fix the doc instead).
const NO_CHECK_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [];

const skillsMarkdownFiles = () =>
	markdownFiles(SKILLS_DIR).map((file) => ({
		file,
		docPath: relative(REPO_ROOT, file),
		text: readFileSync(file, "utf8"),
	}));

const violationsForSkillsDocs = () => {
	const docs = skillsMarkdownFiles();
	const snippets = docs.flatMap((doc) =>
		extractSnippets(doc.text, doc.docPath),
	);
	const fenceViolations = docs.flatMap((doc) =>
		findMislabeledFences(doc.text, doc.docPath),
	);
	const compileViolations = checkSnippets(snippets, NO_CHECK_ALLOWLIST);
	return { snippets, violations: [...fenceViolations, ...compileViolations] };
};

describe("hejbro skill's ts snippets type-check against real source", () => {
	it("every ```ts block under skills/hejbro/ compiles cleanly (or fails exactly where expect-error/no-check say it should), and no fence mislabels a ts example", () => {
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

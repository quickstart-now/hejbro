import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSnippets, extractSnippets, REPO_ROOT } from "./snippet-check";

// Never-fires guard (TERMINAL point 4): the real gate (snippet-compile.test.ts)
// only proves something when it can actually go red. This file runs the exact
// same extraction/check logic against a fixture built to fail in each of the
// three directive-specific ways, so a change that silently turns the checker
// into a no-op (e.g. an accidentally-empty program, a dropped diagnostic
// filter) breaks a test here even on a doc tree with zero real mistakes.
//
// Deliberately outside `skills/hejbro/` (packages/skills/test/fixtures/) so
// the real gate's `markdownFiles(SKILLS_DIR)` walk never scans it.

const FIXTURE_PATH = join(
	REPO_ROOT,
	"packages/skills/test/fixtures/snippets/negative.md",
);
const FIXTURE_DOC_PATH = relative(REPO_ROOT, FIXTURE_PATH);

const snippets = extractSnippets(
	readFileSync(FIXTURE_PATH, "utf8"),
	FIXTURE_DOC_PATH,
);

describe("snippet-check.ts's own failure paths (meta test, fixtures/snippets/negative.md)", () => {
	it("extracts all four fixture blocks with the directives their fences declare", () => {
		expect(snippets).toHaveLength(4);
		expect(
			snippets.map((s) => ({
				expectError: s.expectError,
				prelude: s.prelude,
				noCheck: s.noCheck,
			})),
		).toEqual([
			{ expectError: false, prelude: undefined, noCheck: undefined },
			{ expectError: true, prelude: undefined, noCheck: undefined },
			{ expectError: false, prelude: undefined, noCheck: "demo-reason" },
			{ expectError: false, prelude: "demo", noCheck: undefined },
		]);
	});

	it("a no-token block with a real type error is reported", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		const typeErrorViolation = violations.find(
			(v) => v.line === (snippets[0]?.fenceLine ?? 0) + 1,
		);
		expect(typeErrorViolation).toBeDefined();
		expect(typeErrorViolation?.message).toMatch(/not assignable/);
	});

	it("an expect-error block that actually compiles cleanly is reported", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		const expectErrorViolation = violations.find(
			(v) => v.line === snippets[1]?.fenceLine,
		);
		expect(expectErrorViolation).toBeDefined();
		expect(expectErrorViolation?.message).toMatch(/compiled cleanly/);
	});

	it("a no-check block matching the allowlist is excluded from type-checking entirely, even though its code is broken", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		expect(violations.some((v) => v.line === snippets[2]?.fenceLine)).toBe(
			false,
		);
	});

	it("a no-check block NOT in the allowlist is reported, without ever being type-checked", () => {
		const violations = checkSnippets(snippets, []);
		const allowlistViolation = violations.find(
			(v) => v.line === snippets[2]?.fenceLine,
		);
		expect(allowlistViolation).toBeDefined();
		expect(allowlistViolation?.message).toMatch(/not in the allowlist/);
	});

	it("a prelude= block compiles cleanly when the prelude and the snippet type-check together", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		expect(violations.some((v) => v.line === snippets[3]?.fenceLine)).toBe(
			false,
		);
	});
});

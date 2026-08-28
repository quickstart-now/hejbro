import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	checkSnippets,
	extractSnippets,
	findMislabeledFences,
	REPO_ROOT,
} from "./snippet-check";

// Never-fires guard (TERMINAL point 4): the real gate (snippet-compile.test.ts)
// only proves something when it can actually go red. This file runs the exact
// same extraction/check logic against a fixture built to fail in each of the
// directive-specific ways, so a change that silently turns the checker into a
// no-op (e.g. an accidentally-empty program, a dropped diagnostic filter, an
// `expect-error` that accepts any code) breaks a test here even on a doc tree
// with zero real mistakes.
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
	it("extracts all six fixture blocks with the directives their fences declare", () => {
		expect(snippets).toHaveLength(6);
		expect(
			snippets.map((s) => ({
				expectErrorCode: s.expectErrorCode,
				prelude: s.prelude,
				noCheck: s.noCheck,
			})),
		).toEqual([
			{ expectErrorCode: undefined, prelude: undefined, noCheck: undefined },
			{ expectErrorCode: "2322", prelude: undefined, noCheck: undefined },
			{ expectErrorCode: "9999", prelude: undefined, noCheck: undefined },
			{ expectErrorCode: "2322", prelude: undefined, noCheck: undefined },
			{
				expectErrorCode: undefined,
				prelude: undefined,
				noCheck: "demo-reason",
			},
			{ expectErrorCode: undefined, prelude: "demo", noCheck: undefined },
		]);
	});

	it('a bare "expect-error" with no code is rejected at parse time, not silently accepted', () => {
		expect(() =>
			extractSnippets(
				"```ts expect-error\nconst n: number = 1;\n```\n",
				"fake/doc.md",
			),
		).toThrow(/unknown snippet directive "expect-error"/);
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

	it("an expect-error=2322 block that actually raises TS2322 passes", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		expect(violations.some((v) => v.line === snippets[1]?.fenceLine)).toBe(
			false,
		);
	});

	it("an expect-error=9999 block that actually raises TS2322 (a different code) is reported, naming both", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		const mismatch = violations.find((v) => v.line === snippets[2]?.fenceLine);
		expect(mismatch).toBeDefined();
		expect(mismatch?.message).toMatch(/expected TS9999/);
		expect(mismatch?.message).toMatch(/2322/);
	});

	it("an expect-error=2322 block that compiles cleanly is reported", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		const cleanCompile = violations.find(
			(v) => v.line === snippets[3]?.fenceLine,
		);
		expect(cleanCompile).toBeDefined();
		expect(cleanCompile?.message).toMatch(/none \(compiled cleanly\)/);
	});

	it("a no-check block matching the allowlist is excluded from type-checking entirely, even though its code is broken", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		expect(violations.some((v) => v.line === snippets[4]?.fenceLine)).toBe(
			false,
		);
	});

	it("a no-check block NOT in the allowlist is reported, without ever being type-checked", () => {
		const violations = checkSnippets(snippets, []);
		const allowlistViolation = violations.find(
			(v) => v.line === snippets[4]?.fenceLine,
		);
		expect(allowlistViolation).toBeDefined();
		expect(allowlistViolation?.message).toMatch(/not in the allowlist/);
	});

	it("a prelude= block compiles cleanly when the prelude and the snippet type-check together", () => {
		const violations = checkSnippets(snippets, [
			{ doc: FIXTURE_DOC_PATH, slug: "demo-reason" },
		]);
		expect(violations.some((v) => v.line === snippets[5]?.fenceLine)).toBe(
			false,
		);
	});
});

describe("findMislabeledFences (meta test, TERMINAL v1.5 fence-label bypass guard)", () => {
	it("flags ```typescript/```tsx/```TS as a bypass attempt, never touches ```ts/```sql/bare ```", () => {
		const text = [
			"```typescript",
			"const a = 1;",
			"```",
			"",
			"```tsx",
			"const b = 1;",
			"```",
			"",
			"```TS",
			"const c = 1;",
			"```",
			"",
			"```ts",
			"const d = 1;",
			"```",
			"",
			"```sql",
			"select 1;",
			"```",
			"",
			"```",
			"plain fence, no language",
			"```",
			"",
		].join("\n");

		const violations = findMislabeledFences(text, "fake/doc.md");

		expect(violations).toHaveLength(3);
		expect(violations.map((v) => v.message).join("\n")).toMatch(
			/```typescript/,
		);
		expect(violations.map((v) => v.message).join("\n")).toMatch(/```tsx/);
		expect(violations.map((v) => v.message).join("\n")).toMatch(/```TS/);
	});
});

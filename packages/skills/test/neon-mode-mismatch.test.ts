import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// rls-execution-context requirement "The preset states what it cannot
// detect about the database": the Neon preset cannot detect a mode
// mismatch, so the documentation must carry the failure story — both
// halves — and the token-validity timing. The contract is the three
// stated facts, not the prose; each assertion anchors on the fact's own
// stable vocabulary.

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const REFERENCE = readFileSync(
	join(REPO_ROOT, "skills", "hejbro", "references", "neon-preset.md"),
	"utf8",
);

describe("neon-preset.md states the undetectable-mismatch failure", () => {
	it("states the deny half: identity resolves to NULL and identity-keyed policies deny", () => {
		expect(REFERENCE).toMatch(/resolve to `?NULL`?/);
		expect(REFERENCE).toMatch(/denies/);
	});

	it("states the still-admits half: role-only policies admit with no identity resolved", () => {
		expect(REFERENCE).toMatch(/still \*\*admit\*\*/);
		expect(REFERENCE).toMatch(/generic\s+authenticated user/);
	});

	it("states that token validity is checked when identity is first read, not at context apply", () => {
		expect(REFERENCE).toMatch(/when identity is first read/);
		expect(REFERENCE).toMatch(/not when the context is applied/);
	});
});

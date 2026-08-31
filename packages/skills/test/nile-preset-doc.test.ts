import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// rls-execution-context requirement "The Nile decorator states which
// base drivers it supports": the unsupported shape (a base that pins
// inside its own transaction) must be documented where a reader meets it
// before a database does. preset-validation's own "A refusal states the
// evidence behind it" requirement means the two evidence grades
// (platform-documented vs. measured-only) must both be visible, and
// distinguished from one another, in the same place a user reads the
// refusal list. Each assertion anchors on the doc's own stable
// vocabulary, not its surrounding prose.

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const REFERENCE = readFileSync(
	join(REPO_ROOT, "skills", "hejbro", "references", "nile-preset.md"),
	"utf8",
);
/** `REFERENCE` with every run of whitespace (including hard line wraps) collapsed to a single space -- a multi-word phrase assertion should survive prose rewrapping at an arbitrary word boundary, the same way a reader sees one continuous sentence regardless of the source file's own line width. */
const REFERENCE_FLAT = REFERENCE.replace(/\s+/g, " ");

describe("nile-preset.md states the unsupported base-driver shape (driver-contract: 'The Nile decorator states which base drivers it supports')", () => {
	it("states that a base pinning inside its own transaction is not supported", () => {
		expect(REFERENCE_FLAT).toMatch(
			/applies its own session statements inside the transaction it opens is not supported/,
		);
	});

	it("names the concrete unsupported configuration -- the transaction-mode pooler shape", () => {
		expect(REFERENCE).toMatch(/transaction-mode pooler/);
		expect(REFERENCE).toMatch(/endpoint:\s*"transaction-pooler"/);
	});
});

describe("nile-preset.md states each refusal's evidence grade, distinguished (preset-validation: 'A refusal states the evidence behind it')", () => {
	it("RLS, functions, and triggers are attributed to the platform's own documentation", () => {
		expect(REFERENCE).toMatch(/platform-documented/);
	});

	it("grants and the tenant-aware serial refusal are marked measured-only, not platform-documented", () => {
		expect(REFERENCE).toMatch(/\*\*measured only\*\*/);
		expect(REFERENCE).toMatch(/nile-identity-in-tenant-table/);
		expect(REFERENCE_FLAT).toMatch(
			/IDENTITY columns are not supported for tenant-aware table/,
		);
		expect(REFERENCE_FLAT).toMatch(/not in the platform's published table/);
	});

	it("cites the platform's own published limitations table verbatim, with its source URL and access date", () => {
		expect(REFERENCE).toMatch(
			/https:\/\/thenile\.dev\/docs\/postgres\/postgres-compatibility/,
		);
		expect(REFERENCE_FLAT).toMatch(/accessed 2026-08-31/);
		// the platform's own typo, preserved -- proof the quote is verbatim,
		// not paraphrased or silently corrected.
		expect(REFERENCE_FLAT).toMatch(/is not tdere/);
	});
});

describe("nile-preset.md records the COMMENT fact hejbro cannot express as a validator (proposal.md: 'a validator that can never fire is a spec sentence with no test behind it')", () => {
	it("states that the platform refuses COMMENT, and that hejbro has no comment declaration to validate", () => {
		expect(REFERENCE).toMatch(/`COMMENT`/);
		expect(REFERENCE_FLAT).toMatch(/no comment declaration/);
	});
});

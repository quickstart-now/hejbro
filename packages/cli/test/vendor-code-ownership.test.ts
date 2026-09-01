import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

const isScannable = (name: string): boolean =>
	name.endsWith(".ts") && !name.endsWith(".test.ts");

/** Every scannable `.ts` file under `dir`, recursively — mirrors
 * `scripts/check-diagnostic-xref.mjs`'s own walker (a second, smaller
 * copy rather than a shared import: that script scans every published
 * package's source for a different fact — cited-vs-defined codes — and
 * this test scans one package for a different one — which requirement
 * owns each `vendor-*` code). */
const walk = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			return walk(fullPath);
		}
		if (entry.isFile() && isScannable(entry.name)) {
			return [fullPath];
		}
		return [];
	});

const CODE = "vendor-[a-z0-9-]*";
const DEFINE_PATTERN = new RegExp(
	`\\b(?:throwHejbroError|hejbroError)\\s*\\(\\s*"(${CODE})"`,
	"g",
);

const definedVendorCodes = (): ReadonlySet<string> => {
	const codes = walk(SRC_ROOT).flatMap((filePath) => {
		const text = readFileSync(filePath, "utf8");
		return Array.from(text.matchAll(DEFINE_PATTERN)).map((match) => match[1]);
	});
	return new Set(codes.filter((code): code is string => code !== undefined));
};

/**
 * Every `vendor-*` code this package can actually throw, mapped to
 * whichever requirement owns it (R2-G7 F-1c, a final-review finding:
 * `reports eleven distinct codes` only proves the eleven are distinct
 * *from each other* — it stays silent about a twelfth code nobody
 * assigned an owner, exactly the shape that let the enumeration's own
 * count drift from the real code count seven times over this change's
 * life without anyone noticing until a full-repo review counted both
 * sides). A code with no entry here fails this test outright: a new
 * `vendor-*` diagnostic must be assigned an owner in the same change
 * that adds it, not left to accumulate silently.
 *
 * Two owner shapes:
 * - `"schema-vendoring: Each way vendoring can fail is named
 *   separately"` — one of the eleven counted in that requirement.
 * - Anything else — a different requirement's own code, scoped out of
 *   the eleven on purpose (named here as the delta requirement it
 *   belongs to, so a reader can find where its remedy is proven).
 */
const OWNERSHIP: Readonly<Record<string, string>> = {
	"vendor-source-not-linked":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-remote-unreachable":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-ref-not-found":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-export-missing":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-export-invalid":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-export-format-unsupported":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-lock-commit-lost":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-check-mismatch":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-destination-not-vendored":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-lock-non-default-ref":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-not-yet-vendored":
		"schema-vendoring: Each way vendoring can fail is named separately",
	"vendor-git-missing":
		"cli-commands: An external tool is an optional dependency",
	"vendor-schema-filter-reserved":
		"schema-vendoring: The schema filter is reserved, not silently ignored",
};

const ENUMERATION_OWNER =
	"schema-vendoring: Each way vendoring can fail is named separately";

describe("every vendor-* diagnostic code has an assigned owner (R2-G7 F-1c)", () => {
	it("has no vendor-* code this package can throw that OWNERSHIP doesn't map", () => {
		const unmapped = [...definedVendorCodes()].filter(
			(code) => OWNERSHIP[code] === undefined,
		);
		expect(unmapped).toEqual([]);
	});

	it("has no OWNERSHIP entry for a code this package can no longer throw", () => {
		const defined = definedVendorCodes();
		const stale = Object.keys(OWNERSHIP).filter((code) => !defined.has(code));
		expect(stale).toEqual([]);
	});

	it("counts exactly eleven codes owned by the enumeration itself", () => {
		const enumerationCodes = Object.entries(OWNERSHIP)
			.filter(([, owner]) => owner === ENUMERATION_OWNER)
			.map(([code]) => code);
		expect(enumerationCodes).toHaveLength(11);
	});
});

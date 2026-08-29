import { describe, expect, it } from "vitest";
/**
 * Type-only import list (task 6.1's agreed export list) -- exists purely
 * so a missing/renamed type export is a `tsc` error at this very import
 * statement, not a silent gap a runtime-only assertion could never catch
 * (repo precedent: `packages/query/test/exports.test.ts`, read-only
 * reference).
 */
import type { Claims, NeonAuthMode } from "../src/index";
import * as barrel from "../src/index";

/** Referenced so the type-only import block above isn't flagged unused -- both listed names are a real presence assertion, not decoration. */
type _AgreedTypesPresent = [Claims, NeonAuthMode];

describe("package entry (task 6.1)", () => {
	it("re-exports exactly the agreed runtime value exports, and no Preset bundle", () => {
		// Exact-set equality (not just "contains") -- this package
		// registers no object kinds and no validators (proposal.md's "Out
		// of scope"), so a `supabasePreset`-shaped export here would be
		// surface invented to satisfy a gate, which the [design] note on
		// task 8.3 explicitly rejects.
		expect(Object.keys(barrel).sort()).toEqual([
			"anonymousRole",
			"authJwt",
			"authUid",
			"authenticatedRole",
			"neonAuth",
			"neonDriver",
		]);
	});

	it("importing the package entry succeeds", async () => {
		const entry = await import("../src/index.ts");
		expect(entry).toBeDefined();
	});
});

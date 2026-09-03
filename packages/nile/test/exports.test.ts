import type { DbContext, Driver } from "@hejbro/query";
import { describe, expect, it } from "vitest";
/**
 * Type-only import list -- exists purely so a missing/renamed type export
 * is a `tsc` error at this very import statement, mirroring
 * `packages/query/test/exports.test.ts`'s own pattern. `@hejbro/nile`
 * exports no type of its own today (`nileDriver`/`asTenant` are typed
 * entirely through `@hejbro/query`'s own `Driver`/`DbContext`), so this
 * block only pins that those two return types stay assignable to the
 * contract's own types -- a real presence assertion, not decoration.
 */
import * as barrel from "../src/index";

/** Referenced so the return-type check below reads as an assertion, not dead code. */
type _NileDriverReturnsADriver =
	ReturnType<typeof barrel.nileDriver> extends Driver ? true : never;
type _AsTenantReturnsADbContext =
	ReturnType<typeof barrel.asTenant> extends DbContext ? true : never;
const _typeProbe: [_NileDriverReturnsADriver, _AsTenantReturnsADbContext] = [
	true,
	true,
];
void _typeProbe;

/**
 * The package-entry closure this preset's own tests must pin (driver-
 * contract: "The decorator, the builder, and the preset are importable
 * from the package entry", added after #553's F1 recurred here --
 * `driver.test.ts`/`context.test.ts` import `../src/driver`/`../src/context`
 * directly, which proves the *module* works but never that the *public
 * entry* (`@hejbro/nile`, what an actual consumer imports) re-exports it.
 * `index.ts` shipped with neither export for two whole groups before G6's
 * own doc-snippet compile gate caught it by accident -- this file is the
 * closure that stops depending on an accident to catch a recurrence.
 */
describe("@hejbro/nile public barrel", () => {
	it("exposes exactly the agreed runtime value exports -- nileDriver, asTenant, nilePreset", () => {
		expect(Object.keys(barrel).sort()).toEqual([
			"asTenant",
			"nileDriver",
			"nilePreset",
		]);
	});

	it("nileDriver resolves to the same function driver.test.ts exercises", async () => {
		const { nileDriver: directNileDriver } = await import("../src/driver");
		expect(barrel.nileDriver).toBe(directNileDriver);
	});

	it("asTenant resolves to the same function context.test.ts exercises", async () => {
		const { asTenant: directAsTenant } = await import("../src/context");
		expect(barrel.asTenant).toBe(directAsTenant);
	});

	it("nilePreset resolves to the same object preset.test.ts exercises", async () => {
		const { nilePreset: directNilePreset } = await import("../src/preset");
		expect(barrel.nilePreset).toBe(directNilePreset);
	});
});

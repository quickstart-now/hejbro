import { describe, expect, it } from "vitest";
import { schema } from "../../src/dsl/schema";
import { generateMigration } from "../../src/engine/generate";
import { HejbroError } from "../../src/error";
import { emptySnapshot } from "../../src/snapshot/snapshot";
import { uuid } from "../../src/types/column-builder-factories";
import { buildUsageTable } from "../support/usage-table";

const app = schema("app");

// `HejbroInput` already refuses a `"usage"`-authority value at the type
// level (see `test/types/declared-table.test.ts`'s 2.3). Every test below
// casts past that on purpose: the runtime chokepoint exists specifically
// for a caller the type layer never saw — a JS project, or a config file
// `jiti` loads without a compile step (our own CLI loader does exactly
// that) — so reaching it here requires the same bypass those callers
// have by construction, not a test convenience.
describe("refuses a table that carries no migration authority (2.5 — runtime layer)", () => {
	it("is a coded runtime refusal", () => {
		const usage = buildUsageTable("app", "posts", { id: uuid().primaryKey() });
		expect.assertions(2);
		try {
			generateMigration({
				// biome-ignore lint/suspicious/noExplicitAny: simulating a caller the type layer never saw (a JS project, or jiti-loaded config)
				declarations: [app, usage as any],
				previousSnapshot: emptySnapshot,
			});
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("synced-table-declared");
		}
	});

	it("the refusal names the absent authority, not a provenance", () => {
		const usage = buildUsageTable("app", "posts", { id: uuid().primaryKey() });
		expect.assertions(2);
		try {
			generateMigration({
				// biome-ignore lint/suspicious/noExplicitAny: simulating a caller the type layer never saw
				declarations: [app, usage as any],
				previousSnapshot: emptySnapshot,
			});
		} catch (error) {
			const message = (error as HejbroError).message;
			expect(message).toContain("carries no migration authority");
			expect(message).toMatch(/\bNext:/);
		}
	});

	it("a usage table is refused with no origin in the message", () => {
		// The origin carrier is withdrawn (D87 polyrepo-sync, R2-G1): the
		// refusal has no field left to name a provenance from, so the
		// message never carries one, for any `"usage"`-authority value.
		const usage = buildUsageTable("app", "posts", { id: uuid().primaryKey() });
		expect.assertions(3);
		try {
			generateMigration({
				// biome-ignore lint/suspicious/noExplicitAny: simulating a caller the type layer never saw
				declarations: [app, usage as any],
				previousSnapshot: emptySnapshot,
			});
		} catch (error) {
			const message = (error as HejbroError).message;
			// states the observation, offers one possibility only as an
			// example ("for example") -- never asserts it as fact.
			expect(message).toContain("for example");
			expect(message).not.toMatch(/\bwas (created|synced|generated) by\b/);
			expect(message).not.toContain("authority: ");
		}
	});
});

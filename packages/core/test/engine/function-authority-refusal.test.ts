import { describe, expect, it } from "vitest";
import { defineFunction } from "../../src/dsl/define-function";
import { schema } from "../../src/dsl/schema";
import { generateMigration } from "../../src/engine/generate";
import { HejbroError } from "../../src/error";
import { sql } from "../../src/expr/sql-template";
import { emptySnapshot } from "../../src/snapshot/snapshot";
import { bigint } from "../../src/types/column-builder-factories";
import { buildUsageFunction } from "../support/usage-function";

const app = schema("app");

const defineRealFunction = () =>
	defineFunction(
		app,
		"total_posts",
		{ returns: bigint({ mode: "number" }) },
		(ctx) => {
			ctx.return(sql`1`);
		},
	);

// The function sibling of `authority-refusal.test.ts` (#587/G3): a
// synthesized `FunctionDeclaration` handed to `generateMigration` used to
// be silently ACCEPTED, producing an empty-body function migration --
// measured directly while wiring `@hejbro/query`'s vendored `fn`, never
// specified before. `defineFunction()` itself never sets `authority`
// (see `buildUsageFunction`'s own doc comment), so every real call site
// stays unaffected -- only a hand-built `"usage"`-tagged value, the kind
// `@hejbro/query`'s `synthesizeFunction` now produces, reaches this guard.
describe("refuses a function that carries no migration authority (#587/G3)", () => {
	it("is a coded runtime refusal", () => {
		const usage = buildUsageFunction("app", "total_posts");
		expect.assertions(2);
		try {
			generateMigration({
				declarations: [usage],
				previousSnapshot: emptySnapshot,
			});
			expect.unreachable("should have refused a usage-authority function");
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("synced-function-declared");
		}
	});

	it("the refusal states the absent authority and a Next: step", () => {
		const usage = buildUsageFunction("app", "total_posts");
		expect.assertions(3);
		try {
			generateMigration({
				declarations: [usage],
				previousSnapshot: emptySnapshot,
			});
			expect.unreachable("should have refused a usage-authority function");
		} catch (error) {
			const message = (error as HejbroError).message;
			expect(message).toContain("carries no migration authority");
			expect(message).toMatch(/\bNext:/);
			expect(message).toContain('function "app"."total_posts"');
		}
	});

	it("a real defineFunction() declaration (no authority marker) is unaffected", () => {
		const totalPosts = defineRealFunction();
		const result = generateMigration({
			declarations: [totalPosts],
			previousSnapshot: emptySnapshot,
		});
		expect(result.errors).toEqual([]);
	});
});

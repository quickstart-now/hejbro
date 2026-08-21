import {
	registerSupabaseKinds,
	rlsUncachedAuthCallValidator,
} from "@hejbro/supabase";
import type { HejbroInput } from "hejbro";
import {
	createDefaultRegistry,
	emptySnapshot,
	generateMigration,
} from "hejbro";
import { describe, expect, it } from "vitest";
import { declarations as appSchema } from "../src/app.schema";
import { declarations as step1 } from "../src/steps/step-1.schema";
import { declarations as step2 } from "../src/steps/step-2.schema";
import { declarations as step3 } from "../src/steps/step-3.schema";
import { declarations as step4 } from "../src/steps/step-4.schema";

// #97: this showcase's whole point is proving hejbro's own reference
// example follows its own RLS performance guidance. Before #97 moved every
// policy to authUidCached(), running rlsUncachedAuthCallValidator against
// these exact declarations returned { appSchema: 3, step1: 2, step2: 2,
// step3: 2, step4: 3 } (measured directly with the validator, not grep,
// during #97's own review). Pinning that count at 0 here -- not just
// observing it once during that PR -- is what keeps it 0: without this,
// nothing stops a future edit from reintroducing a plain authUid()/
// authJwt() call in a policy and staying green.
const namedDeclarationSets: ReadonlyArray<{
	readonly name: string;
	readonly declarations: ReadonlyArray<HejbroInput>;
}> = [
	{ name: "appSchema", declarations: appSchema },
	{ name: "step1", declarations: step1 },
	{ name: "step2", declarations: step2 },
	{ name: "step3", declarations: step3 },
	{ name: "step4", declarations: step4 },
];

describe("examples/supabase: no uncached auth.uid()/auth.jwt() call in any policy", () => {
	namedDeclarationSets.map(({ name, declarations }) =>
		it(`${name}: zero rls-uncached-auth-call warnings`, () => {
			const registry = createDefaultRegistry();
			registerSupabaseKinds(registry);
			const result = generateMigration({
				declarations: [...declarations],
				previousSnapshot: emptySnapshot,
				registry,
				validators: [rlsUncachedAuthCallValidator],
			});
			const relevant = result.warnings.filter(
				(warning) => warning.code === "rls-uncached-auth-call",
			);
			expect(relevant).toEqual([]);
		}),
	);
});

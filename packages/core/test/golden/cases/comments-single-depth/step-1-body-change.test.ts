import { describe, expect, it } from "vitest";
import { emptySnapshot, generateMigration } from "../../../../src/index";
import { steps } from "./steps";

// Guards a blind spot in golden.test.ts: it compares `generateMigration`'s
// output against `expected/*.sql`, but `UPDATE_GOLDEN=1` rewrites that
// comparison target instead of asserting against it -- regenerating after a
// regression silently "fixes" the expected file rather than catching it.
// This test computes the diff in-memory and never reads or writes anything
// under `expected/`, so a regen can't absorb it.
//
// What it protects: step 1 in steps.ts deliberately rewords the
// "parent not found" raise message from the one declared in
// declarations.ts (see the comment there and on this step) so the trigger
// function's plpgsql body -- and its bodyHash -- actually changes between
// step 0 and step 1. That's what makes this a real body-only-change case.
// If the two messages are ever made to read the same, the function body
// stops changing and the step becomes a no-op that a golden regen would
// happily paper over while the golden test itself stays green.
describe("comments-single-depth: step 1 is a real body-only change", () => {
	it("regenerating step 1 from step 0 reports the trigger function's body as changed", () => {
		const [fromEmpty, bodyOnlyChange] = steps;
		if (fromEmpty === undefined || bodyOnlyChange === undefined) {
			throw new Error(
				"expected comments-single-depth to declare at least a from-empty and a body-only-change step",
			);
		}
		const stepZero = generateMigration({
			declarations: fromEmpty,
			previousSnapshot: emptySnapshot,
		});
		const stepOne = generateMigration({
			declarations: bodyOnlyChange,
			previousSnapshot: stepZero.snapshot,
		});
		expect(stepOne.sql).toContain(
			"-- ~ function app.comments_enforce_single_depth [body changed]",
		);
	});
});

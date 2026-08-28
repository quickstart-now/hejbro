import type { HejbroInput } from "../../../../src/index";
import { bigint, integer, table, text } from "../../../../src/index";
import { app } from "./declarations";

// Step 0: from empty -- a bare `generated always as identity` and a `by
// default` identity with its one confirmed option (`start with`).

const withIdentities = table(app, "widgets", {
	id: integer().generatedAlwaysAsIdentity(),
	seq: bigint().generatedByDefaultAsIdentity({ startWith: 1000 }),
	label: text(),
});

const fromEmpty: ReadonlyArray<HejbroInput> = [app, withIdentities];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [fromEmpty];

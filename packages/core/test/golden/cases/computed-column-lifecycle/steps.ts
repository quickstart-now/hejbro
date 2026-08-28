import type { HejbroInput } from "../../../../src/index";
import { integer, numeric, sql, table } from "../../../../src/index";
import { app } from "./declarations";

// Step 0: from empty -- a stored computed column (`total`), verbatim
// fragment `price * qty` (task 2.2-a's own create-emit contract).

const withComputedTotal = table(app, "widgets", {
	price: numeric(),
	qty: integer(),
	total: numeric().generatedAlwaysAs(sql`price * qty`),
});

const fromEmpty: ReadonlyArray<HejbroInput> = [app, withComputedTotal];

// Step 1: the expression changes (`price * qty` -> `price * qty * 2`) --
// task 2.4's own rebuild path: drop the column, re-add it with the new
// expression, no destructive-change confirmation (the value is still
// derivable from the declaration).

const withDoubledTotal = table(app, "widgets", {
	price: numeric(),
	qty: integer(),
	total: numeric().generatedAlwaysAs(sql`price * qty * 2`),
});

const expressionChanged: ReadonlyArray<HejbroInput> = [app, withDoubledTotal];

// Step 2: `total` becomes a plain column -- task 2.4's other unlocked
// path: `alter column ... drop expression`, in place (no rebuild, the
// column's last-computed value survives as an ordinary value from here).

const totalBecomesPlain = table(app, "widgets", {
	price: numeric(),
	qty: integer(),
	total: numeric(),
});

const generatedDropped: ReadonlyArray<HejbroInput> = [app, totalBecomesPlain];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	expressionChanged,
	generatedDropped,
];

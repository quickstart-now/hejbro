import { describe, expect, it } from "vitest";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { sql } from "../src/expr/sql-template";
import type { KindChange } from "../src/kind/object-kind";
import { tableKind } from "../src/kinds/table-kind";
import { asTableSnapshot } from "../src/kinds/table-snapshot";
import { emptySnapshot } from "../src/snapshot/snapshot";
import { integer, numeric } from "../src/types/column-builder-factories";

const app = schema("app");

const expectSingleChange = (changes: ReadonlyArray<KindChange>): KindChange => {
	if (changes.length !== 1) {
		throw new Error(`expected exactly one change, got ${changes.length}`);
	}
	const [change] = changes;
	if (change === undefined) {
		throw new Error("expected a change");
	}
	return change;
};

/**
 * add-generated-columns task 2.4 (D100, design decision 4) — the two diff
 * paths unlocked so far: an expression change (drop+add, no destructive
 * confirmation — the data is derivable) and generated→plain (`drop
 * expression`, in place). plain→generated is a lead-held decision (the
 * destructive-confirmation routing question) and is deliberately absent
 * from this file — neither tested nor implemented.
 */
describe("generated (computed) columns — diff/emit (add-generated-columns, task 2.4)", () => {
	it("an expression change renders drop+add for that column, unconditionally (no destructive-confirmation marker exists on a KindChange/SqlStatement)", () => {
		const before = table(app, "widgets", {
			price: numeric(),
			qty: integer(),
			total: numeric().generatedAlwaysAs(sql`price * qty`),
		});
		const after = table(app, "widgets", {
			price: numeric(),
			qty: integer(),
			total: numeric().generatedAlwaysAs(sql`price * qty * 2`),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.widgets"),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'alter table "app"."widgets" drop column "total";',
			'alter table "app"."widgets" add column "total" numeric generated always as (price * qty * 2) stored;',
		]);
	});

	it("generated -> plain renders `alter column ... drop expression` in place (no drop+add)", () => {
		const before = table(app, "widgets", {
			price: numeric(),
			qty: integer(),
			total: numeric().generatedAlwaysAs(sql`price * qty`),
		});
		const after = table(app, "widgets", {
			price: numeric(),
			qty: integer(),
			total: numeric(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.widgets"),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'alter table "app"."widgets" alter column "total" drop expression;',
		]);
	});

	it("an unrelated column change (e.g. a new plain column added) is untouched by the generated-diff paths", () => {
		const before = table(app, "widgets", {
			price: numeric(),
			total: numeric().generatedAlwaysAs(sql`price`),
		});
		const after = table(app, "widgets", {
			price: numeric(),
			total: numeric().generatedAlwaysAs(sql`price`),
			qty: integer(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.widgets"),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'alter table "app"."widgets" add column "qty" integer;',
		]);
	});

	// The planner's own open question: an expression-change rebuild is a
	// real `drop column` + `add column` on Postgres, which physically
	// re-appends the column at the end of the table -- but
	// `snapshot/column-order.ts`'s oracle (`physicalOrder`) only ever asks
	// "is this column NAME present in both the parent and the declared
	// set?" to decide whether it keeps its old position. A same-name
	// rebuild answers "yes" to that question, so the oracle keeps the
	// rebuilt column in its OLD (middle) position for the next snapshot,
	// never learning that the real database physically moved it to the
	// end. This test pins that CURRENT (unfixed) behavior -- it documents
	// the gap, it does not close it. Escalated instead of fixed, per
	// instruction.
	it("[gap, not fixed] the column-order oracle keeps a rebuilt column in its old position after an expression-change rebuild, not the physical end position a real ADD COLUMN would land on", () => {
		const declareStep = (expression: ReturnType<typeof sql>) =>
			table(app, "widgets", {
				a: numeric(),
				total: numeric().generatedAlwaysAs(expression),
				b: numeric(),
			});

		const step1 = generateMigration({
			declarations: [app, declareStep(sql`a`)],
			previousSnapshot: emptySnapshot,
		});
		expect(step1.hasChanges).toBe(true);

		// Step 2: the expression changes -- a rebuild (drop+add) of `total`,
		// confirmed by the previous two tests' own emit shape.
		const step2 = generateMigration({
			declarations: [app, declareStep(sql`a * 2`)],
			previousSnapshot: step1.snapshot,
		});
		expect(step2.hasChanges).toBe(true);
		expect(step2.sql).toContain('drop column "total"');
		expect(step2.sql).toContain('add column "total"');

		const widgetsAfterRebuildNode = step2.snapshot.objects["table:app.widgets"];
		if (widgetsAfterRebuildNode === undefined) {
			throw new Error("expected table:app.widgets in step2's snapshot");
		}
		const widgetsAfterRebuild = asTableSnapshot(widgetsAfterRebuildNode);
		// Current oracle behavior: `total` (same name, present in both the
		// parent and the declared set) keeps its ORIGINAL middle position --
		// the oracle has no way to know this specific "changed" entry was a
		// physical rebuild, not an untouched survivor. A real Postgres table
		// after this migration actually has `total` LAST (a, b, total), not
		// (a, total, b) -- this snapshot's own column order silently
		// disagrees with the live database from this point on (D81's own
		// purpose -- `select *`/`returning *` ordering -- is the axis this
		// would surface on, not the ordinary diff, since column reordering
		// alone never produces a diff by itself).
		expect(widgetsAfterRebuild.columns.map((c) => c.name)).toEqual([
			"a",
			"total",
			"b",
		]);

		// A third, no-op generate run confirms the mismatch is silent: the
		// stale order produces no diff/warning of its own.
		const step3 = generateMigration({
			declarations: [app, declareStep(sql`a * 2`)],
			previousSnapshot: step2.snapshot,
		});
		expect(step3.hasChanges).toBe(false);
	});
});

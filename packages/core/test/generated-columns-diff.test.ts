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

/** Two diff paths (D100): an expression change (drop+add, no confirmation — the data is derivable) and generated→plain (`drop expression`, in place). plain→generated is absent from this file. */
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

	// A drop+add rebuild physically re-appends the column at the end of a
	// real Postgres table, but `column-order.ts`'s oracle decides position
	// from name membership alone (present in both parent and declared sets
	// = keep the old position), so it can't distinguish a rebuild from an
	// untouched survivor. This test pins that gap; it does not close it.
	it("[gap, not fixed] the column-order oracle keeps a rebuilt column in its old position, not the physical end a real ADD COLUMN lands on", () => {
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
		// A real Postgres table now has `total` LAST (a, b, total); this
		// snapshot keeps it in its old middle position instead. Column
		// reordering alone never produces a diff, so nothing else surfaces
		// this mismatch -- it only matters where D81's oracle output is
		// actually read (`select *`/`returning *`).
		expect(widgetsAfterRebuild.columns.map((c) => c.name)).toEqual([
			"a",
			"total",
			"b",
		]);

		// A third, no-op generate run confirms the mismatch is silent.
		const step3 = generateMigration({
			declarations: [app, declareStep(sql`a * 2`)],
			previousSnapshot: step2.snapshot,
		});
		expect(step3.hasChanges).toBe(false);
	});
});

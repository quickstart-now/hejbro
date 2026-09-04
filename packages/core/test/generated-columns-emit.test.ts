import { describe, expect, it } from "vitest";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { columnRef } from "../src/expr/ast";
import { sql } from "../src/expr/sql-template";
import type { KindChange } from "../src/kind/object-kind";
import { tableKind } from "../src/kinds/table-kind";
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

/** create-table emit for a stored computed column (D100) -- identity's own emit is untouched here. */
describe("generated (computed) columns — create emit", () => {
	it("renders `generated always as (<expression>) stored` with the declared fragment verbatim", () => {
		const widgets = table(app, "widgets", {
			price: numeric(),
			qty: integer(),
			total: numeric().generatedAlwaysAs(sql`price * qty`),
		});
		const next = tableKind.serialize(getTableMeta(widgets));
		const change = expectSingleChange(
			tableKind.diff(null, next, "app.widgets"),
		);
		const [createStatement] = tableKind.emit(change);
		expect(createStatement?.sql).toBe(
			'create table "app"."widgets" (\n\t"price" numeric,\n\t"qty" integer,\n\t"total" numeric generated always as (price * qty) stored\n);',
		);
	});

	// fix-nile-findings, table-declaration spec ("A generated column's
	// expression names its own columns by table and column"): a sibling
	// column reference can never be interpolated through `t` here (`.
	// generatedAlwaysAs()` runs while the column map itself is still being
	// built, so no `t` proxy exists yet — column-builder.ts's own tsdoc on
	// `generatedAlwaysAs`), so this uses `columnRef()` directly, the exact
	// primitive `table()` uses to build `t` itself, to construct a
	// structured reference to a sibling column ahead of time.
	it("renders an interpolated sibling column reference table-bound, two-part", () => {
		const priceBuilder = numeric();
		const qtyBuilder = integer();
		const priceRef = columnRef(
			"app",
			"widgets",
			"price",
			priceBuilder.columnState.typeNode,
		);
		const qtyRef = columnRef(
			"app",
			"widgets",
			"qty",
			qtyBuilder.columnState.typeNode,
		);
		const widgets = table(app, "widgets", {
			price: priceBuilder,
			qty: qtyBuilder,
			total: numeric().generatedAlwaysAs(sql`${priceRef} * ${qtyRef}`),
		});
		const next = tableKind.serialize(getTableMeta(widgets));
		const change = expectSingleChange(
			tableKind.diff(null, next, "app.widgets"),
		);
		const [createStatement] = tableKind.emit(change);
		expect(createStatement?.sql).toBe(
			'create table "app"."widgets" (\n\t"price" numeric,\n\t"qty" integer,\n\t"total" numeric generated always as ("widgets"."price" * "widgets"."qty") stored\n);',
		);
	});

	it("a generated column can still carry NOT NULL alongside the grammar (guard 3 only forbids .default(), not .notNull())", () => {
		const widgets = table(app, "widgets", {
			price: numeric(),
			qty: integer(),
			total: numeric().notNull().generatedAlwaysAs(sql`price * qty`),
		});
		const next = tableKind.serialize(getTableMeta(widgets));
		const change = expectSingleChange(
			tableKind.diff(null, next, "app.widgets"),
		);
		const [createStatement] = tableKind.emit(change);
		expect(createStatement?.sql).toContain(
			'"total" numeric not null generated always as (price * qty) stored',
		);
	});

	it("a plain column's definition is unaffected (no `generated` clause when the column isn't computed)", () => {
		const widgets = table(app, "widgets", { price: numeric() });
		const next = tableKind.serialize(getTableMeta(widgets));
		const change = expectSingleChange(
			tableKind.diff(null, next, "app.widgets"),
		);
		const [createStatement] = tableKind.emit(change);
		expect(createStatement?.sql).not.toContain("generated");
	});
});

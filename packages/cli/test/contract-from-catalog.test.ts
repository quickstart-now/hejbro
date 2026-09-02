import type { Snapshot, TableSnapshot } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { emitContract } from "../src/contract/emit";
import { exportPayloadFromCatalog } from "../src/contract/from-catalog";
import type { CatalogDescription } from "../src/infer/description";

/**
 * `pull`'s own bridge (CI-G4-R1-03): `CatalogDescription` (Group 1's own
 * output, built for exactly this) + the inferred `Snapshot` -> an
 * `ExportPayload` the SAME `emitContract` `vendor` uses can render --
 * the delta's "the same contract emitter `vendor` uses" is only true if
 * no second renderer exists, so this test proves a REAL render through
 * the real emitter, never just that the adapter's own shape type-checks.
 */
const widgetsTable: TableSnapshot = {
	schema: "app",
	name: "widgets",
	columns: [
		{
			name: "id",
			typeNode: { typeName: "uuid" },
			notNull: true,
			primaryKey: true,
		},
		{ name: "label", typeNode: { typeName: "text" }, notNull: true },
	],
	indexes: [],
	foreignKeys: [],
	primaryKeyName: "widgets_pkey",
};

const snapshotWith = (tables: ReadonlyArray<TableSnapshot>): Snapshot => ({
	formatVersion: 8,
	dialect: "postgres",
	objects: Object.fromEntries(
		tables.map((table) => [`table:${table.schema}.${table.name}`, table]),
	),
});

const descriptionFor = (
	tables: ReadonlyArray<{
		readonly schema: string;
		readonly table: string;
		readonly columns: ReadonlyArray<{ sqlName: string; tsKey: string }>;
	}>,
	roleNames: ReadonlyArray<string> = [],
): CatalogDescription => ({ tables, roleNames });

describe("exportPayloadFromCatalog / CI-G4-R1-03", () => {
	it("renders a real contract through the real emitContract, with every declarable column present", () => {
		const description = descriptionFor([
			{
				schema: "app",
				table: "widgets",
				columns: [
					{ sqlName: "id", tsKey: "id" },
					{ sqlName: "label", tsKey: "label" },
				],
			},
		]);
		const snapshot = snapshotWith([widgetsTable]);

		const payload = exportPayloadFromCatalog(description, snapshot);
		const source = emitContract(payload, {
			source: "database",
			database: "widgets_db",
			schemas: ["app"],
		});

		expect(source).toContain('"widgets": {');
		expect(source).toContain("readonly id: string;");
		expect(source).toContain("readonly label: string;");
		expect(source).toContain('"id": { sqlName: "id"');
		expect(source).toContain('"label": { sqlName: "label"');
		expect(source).toContain('database: "widgets_db"');
	});

	it("carries no role, function, or export-name facts inference never has", () => {
		const description = descriptionFor([
			{
				schema: "app",
				table: "widgets",
				columns: [
					{ sqlName: "id", tsKey: "id" },
					{ sqlName: "label", tsKey: "label" },
				],
			},
		]);
		const snapshot = snapshotWith([widgetsTable]);

		const payload = exportPayloadFromCatalog(description, snapshot);

		expect(payload.functions).toEqual([]);
		expect(payload.roles).toEqual([]);
		expect(payload.tables[0]?.exportName).toBeNull();
	});

	it("names every declared role in the description's own sorted list", () => {
		const description = descriptionFor(
			[
				{
					schema: "app",
					table: "widgets",
					columns: [{ sqlName: "id", tsKey: "id" }],
				},
			],
			["reporter", "app_user"],
		);
		const snapshot = snapshotWith([
			{
				...widgetsTable,
				columns: [widgetsTable.columns[0] as TableSnapshot["columns"][number]],
			},
		]);

		const payload = exportPayloadFromCatalog(description, snapshot);

		expect(payload.roles).toEqual(["reporter", "app_user"]);
	});

	/**
	 * The exact case `describeCatalog`'s own doc comment names as pull's
	 * reason to exist: a column whose SQL name no declaration key can
	 * reproduce is in the *description* (pull's columns are never
	 * filtered by declarability) but never in the *snapshot* (Group 1's
	 * `tablesExcludingUndeclarableNames` already dropped it there, for
	 * both commands, CI-G1-R1-16). `computeTable`/`buildColumnEntries`
	 * iterate the snapshot's own columns, never the fact's -- so this
	 * column's fact entry is simply never reached, with no special case
	 * needed in the adapter itself. Pinned here as its own test because
	 * that's exactly the kind of "reads correct by inspection" claim
	 * this change has been burned by before.
	 */
	it("never emits a column present in the description but absent from the snapshot (undeclarable name)", () => {
		const description = descriptionFor([
			{
				schema: "app",
				table: "events",
				columns: [
					{ sqlName: "id", tsKey: "id" },
					{ sqlName: "createdAt", tsKey: "createdat" },
				],
			},
		]);
		const eventsTable: TableSnapshot = {
			schema: "app",
			name: "events",
			// the snapshot never carried "createdAt" -- excluded upstream by
			// compose.ts, not by this adapter.
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "events_pkey",
		};
		const snapshot = snapshotWith([eventsTable]);

		const payload = exportPayloadFromCatalog(description, snapshot);
		const source = emitContract(payload, {
			source: "database",
			database: "widgets_db",
			schemas: ["app"],
		});

		expect(source).not.toContain("createdAt");
		expect(source).not.toContain("createdat");
		expect(source).toContain("readonly id: string;");
	});
});

import type { Snapshot } from "@hejbro/core";
import type { ExportTableFact } from "../export/description";
import type { ExportPayload } from "../export/write";
import type { CatalogDescription } from "../infer/description";

/**
 * `pull`'s own bridge into the contract emitter `vendor` already uses
 * (CI-G4-R1-03, settled after the delta's "the same contract emitter"
 * ruled out a second renderer): `CatalogDescription` (Group 1's own
 * output -- its doc comment already names this as pull's reason to
 * exist) plus the inferred `Snapshot`, turned into the `ExportPayload`
 * shape `emitContract` takes from `vendor`. Every fact a real
 * declaration would carry that inference never tracks reads as the
 * value that means "no override": `mode: null` (the default numeric
 * mode), `notNullElements: false` (unknown element nullability read as
 * nullable), `exportName: null` (inference has no rename concept).
 * `functions: []` because v1 never infers a function (catalog-inference
 * spec's own not-inferred enumeration). `roles` is `description`'s own
 * already-sorted list (`inferRoleNames`, Group 1) -- not recomputed
 * here.
 *
 * A column present in `description` but absent from `snapshot` (the
 * exact case `describeCatalog`'s own doc comment names: an
 * undeclarable-SQL-name column, which `compose.ts`'s
 * `tablesExcludingUndeclarableNames` already dropped from the snapshot
 * for both commands, CI-G1-R1-16) is carried into the built
 * `ExportTableFact.columns` map here regardless -- `computeTable`/
 * `buildColumnEntries` (`contract/tables.ts`) iterate the snapshot's own
 * columns, never the fact's, so that entry is simply never reached. No
 * filtering happens in this adapter; the emitter's own existing rule is
 * what keeps it out of the rendered contract.
 */
const tableFactFromCatalog = (
	table: CatalogDescription["tables"][number],
): ExportTableFact => ({
	schemaName: table.schema,
	tableName: table.table,
	exportName: null,
	columns: Object.fromEntries(
		table.columns.map((column) => [
			column.sqlName,
			{ key: column.tsKey, mode: null, notNullElements: false },
		]),
	),
});

export const exportPayloadFromCatalog = (
	description: CatalogDescription,
	snapshot: Snapshot,
): ExportPayload => ({
	tables: description.tables.map(tableFactFromCatalog),
	functions: [],
	roles: description.roleNames,
	snapshot,
});

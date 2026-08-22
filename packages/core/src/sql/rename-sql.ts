import { qualifyName, quoteIdentifier } from "./identifier";

/**
 * The subset of {@link import("../engine/rename-plan").ColumnRenameSpec}
 * this module needs — a structural (not imported) type, so `sql/` never
 * depends on `engine/` (avoids a module cycle; `rename-plan.ts` imports
 * this module's render functions).
 */
type ColumnRenameTarget = {
	readonly schemaName: string;
	readonly tableName: string;
	readonly oldName: string;
	readonly newName: string;
};

/** @see ColumnRenameTarget — the table-rename counterpart. */
type TableRenameTarget = {
	readonly schemaName: string;
	readonly oldName: string;
	readonly newName: string;
};

/** Renders `alter table … rename column … to …;` for a resolved `--rename` column spec. */
export const renderColumnRename = (spec: ColumnRenameTarget): string =>
	`alter table ${qualifyName(spec.schemaName, spec.tableName)} rename column ${quoteIdentifier(spec.oldName)} to ${quoteIdentifier(spec.newName)};`;

/** Renders `alter table … rename to …;` for a resolved `--rename` table spec. */
export const renderTableRename = (spec: TableRenameTarget): string =>
	`alter table ${qualifyName(spec.schemaName, spec.oldName)} rename to ${quoteIdentifier(spec.newName)};`;

/**
 * Renders `alter index … rename to …;` — the derived-name drift guard for
 * an index whose stored name was `derive(<old names>)` (Task 6 algorithm
 * step 4).
 */
export const renderIndexRename = (
	schemaName: string,
	oldName: string,
	newName: string,
): string =>
	`alter index ${qualifyName(schemaName, oldName)} rename to ${quoteIdentifier(newName)};`;

/**
 * Renders `alter table … rename constraint … to …;` — the derived-name
 * drift guard for a foreign key whose stored name was
 * `derive(<old names>)` (Task 6 algorithm step 4). `tableName` is the
 * table's *current* name — after a table rename, that rename statement has
 * already run, so this must be the new name.
 */
export const renderForeignKeyConstraintRename = (
	schemaName: string,
	tableName: string,
	oldName: string,
	newName: string,
): string =>
	`alter table ${qualifyName(schemaName, tableName)} rename constraint ${quoteIdentifier(oldName)} to ${quoteIdentifier(newName)};`;

/**
 * Renders `alter sequence … rename to …;` — the derived-name drift guard
 * for a `serial`-family column's backing sequence, whose stored name was
 * `deriveSequenceName(<old table>, <old column>)` (#23/D66). Confirmed
 * against a real Postgres that a table/column rename does **not** rename
 * the sequence on its own — without this, the sequence's name silently
 * drifts from what a fresh build of the same (renamed) declaration would
 * produce.
 */
export const renderSequenceRename = (
	schemaName: string,
	oldName: string,
	newName: string,
): string =>
	`alter sequence ${qualifyName(schemaName, oldName)} rename to ${quoteIdentifier(newName)};`;

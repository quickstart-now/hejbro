import type { ForeignKeyAction } from "../dsl/table";
import type { JsonValue } from "../snapshot/stable-json";
import type { TypeNode } from "../types/type-node";

/**
 * A single column as materialized in a table snapshot (`primaryKey` implies
 * `notNull`). **Compact** (owner decision, Phase 5 Task 3 audit / D33):
 * `notNull`/`primaryKey`/`unique` are present only when `true` (their
 * declared default is `false`); `default` (the rendered SQL expression
 * text, D16, e.g. `"gen_random_uuid()"`) is present only when the column
 * has one. Absent ⇒ the field's default — read via
 * {@link columnNotNull}/{@link columnPrimaryKey}/{@link columnUnique}/
 * {@link columnDefault}, never the raw field, so a hand-edited or
 * round-tripped snapshot behaves identically to a freshly built one.
 */
export type ColumnSnapshot = {
	readonly name: string;
	readonly typeNode: TypeNode;
	readonly notNull?: true;
	readonly primaryKey?: true;
	readonly unique?: true;
	readonly default?: string;
};

/** `column.notNull`, defaulting to `false` when absent (compact snapshot). */
export const columnNotNull = (column: ColumnSnapshot): boolean =>
	column.notNull === true;

/** `column.primaryKey`, defaulting to `false` when absent (compact snapshot). */
export const columnPrimaryKey = (column: ColumnSnapshot): boolean =>
	column.primaryKey === true;

/** `column.unique`, defaulting to `false` when absent (compact snapshot). */
export const columnUnique = (column: ColumnSnapshot): boolean =>
	column.unique === true;

/** `column.default`, defaulting to `null` when absent (compact snapshot). */
export const columnDefault = (column: ColumnSnapshot): string | null =>
	column.default ?? null;

/** A single index as materialized in a table snapshot, with its name resolved. **Compact**: `unique` is present only when `true` (default `false`) — read via {@link indexUnique}. */
export type IndexSnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly unique?: true;
};

/** `index.unique`, defaulting to `false` when absent (compact snapshot). */
export const indexUnique = (index: IndexSnapshot): boolean =>
	index.unique === true;

/** A single foreign key as materialized in a table snapshot, with its name derived and its target table resolved to an identity string. **Compact**: `onDelete` is present only when set (default `null`, meaning "unspecified") — read via {@link foreignKeyOnDelete}. */
export type ForeignKeySnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesTable: string;
	readonly referencesColumns: ReadonlyArray<string>;
	readonly onDelete?: ForeignKeyAction;
};

/** `foreignKey.onDelete`, defaulting to `null` when absent (compact snapshot). */
export const foreignKeyOnDelete = (
	foreignKey: ForeignKeySnapshot,
): ForeignKeyAction | null => foreignKey.onDelete ?? null;

/** The full snapshot node `tableKind.serialize` produces for one table. */
export type TableSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<ColumnSnapshot>;
	readonly indexes: ReadonlyArray<IndexSnapshot>;
	readonly foreignKeys: ReadonlyArray<ForeignKeySnapshot>;
};

// Internal invariant: this shape is exactly what tableKind.serialize (table-kind.ts) produces.
/** Narrows a raw snapshot `JsonValue` to {@link TableSnapshot}. */
export const asTableSnapshot = (snapshot: JsonValue): TableSnapshot =>
	snapshot as TableSnapshot;

/** A table's identity string: `"<schema>.<tableName>"`. */
export const tableIdentity = (schemaName: string, tableName: string): string =>
	`${schemaName}.${tableName}`;

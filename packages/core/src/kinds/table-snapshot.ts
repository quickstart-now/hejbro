import type { ForeignKeyAction } from "../dsl/table";
import type { JsonValue } from "../snapshot/stable-json";
import type { TypeNode } from "../types/type-node";

/** A single column as materialized in a table snapshot (`primaryKey` implies `notNull`). `default` is the rendered SQL expression text (D16), e.g. `"gen_random_uuid()"` or `"'hello'"`. */
export type ColumnSnapshot = {
	readonly name: string;
	readonly typeNode: TypeNode;
	readonly notNull: boolean;
	readonly primaryKey: boolean;
	readonly unique: boolean;
	readonly default: string | null;
};

/** A single index as materialized in a table snapshot, with its name resolved. */
export type IndexSnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly unique: boolean;
};

/** A single foreign key as materialized in a table snapshot, with its name derived and its target table resolved to an identity string. */
export type ForeignKeySnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesTable: string;
	readonly referencesColumns: ReadonlyArray<string>;
	readonly onDelete: ForeignKeyAction | null;
};

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

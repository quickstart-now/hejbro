import type { ForeignKeyAction, IndexNulls } from "../dsl/table";
import { decodeExprNode } from "../expr/codec";
import { renderExpr } from "../expr/render-sql";
import type { JsonValue } from "../snapshot/stable-json";
import type { TypeNode } from "../types/type-node";

/**
 * A single column as materialized in a table snapshot (`primaryKey` implies
 * `notNull`). **Compact** (owner decision, Phase 5 Task 3 audit / D33):
 * `notNull`/`primaryKey`/`unique` are present only when `true` (their
 * declared default is `false`); `default` is present only when the column
 * has one. Absent ⇒ the field's default — read via
 * {@link columnNotNull}/{@link columnPrimaryKey}/{@link columnUnique}/
 * {@link columnDefault}, never the raw field, so a hand-edited or
 * round-tripped snapshot behaves identically to a freshly built one.
 *
 * `default` is a **structured expression node** (D67/D70), encoded by the
 * expression codec (`expr/codec.ts`) — not rendered SQL text (that was
 * D16's original shape; D67 amended it so a rename can retarget the
 * identifiers inside it exactly, instead of leaving stale text behind).
 * {@link columnDefault} decodes and renders it back to SQL text on demand,
 * so every caller of that accessor is unaffected by this shape change.
 */
export type ColumnSnapshot = {
	readonly name: string;
	readonly typeNode: TypeNode;
	readonly notNull?: true;
	readonly primaryKey?: true;
	readonly unique?: true;
	readonly default?: JsonValue;
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

/** `column.default` decoded and rendered back to SQL text, defaulting to `null` when absent (compact snapshot). */
export const columnDefault = (column: ColumnSnapshot): string | null => {
	if (column.default === undefined || column.default === null) {
		return null;
	}
	return renderExpr(decodeExprNode(column.default));
};

/** One column of an index as materialized in a table snapshot: its name, sort direction, and nulls placement (D51). **Compact**: `desc` is present only when `true` (default `false`), `nulls` only when set (default `null`) — read via {@link indexColumnDesc}/{@link indexColumnNulls}. */
export type IndexColumnSnapshot = {
	readonly name: string;
	readonly desc?: true;
	readonly nulls?: IndexNulls;
};

/** `column.desc`, defaulting to `false` when absent (compact snapshot). */
export const indexColumnDesc = (column: IndexColumnSnapshot): boolean =>
	column.desc === true;

/** `column.nulls`, defaulting to `null` when absent (compact snapshot). */
export const indexColumnNulls = (
	column: IndexColumnSnapshot,
): IndexNulls | null => column.nulls ?? null;

/** A single index as materialized in a table snapshot, with its name resolved. **Compact**: `unique` is present only when `true` (default `false`) — read via {@link indexUnique}; `where` (a structured expression node, D67/D70 — see {@link ColumnSnapshot.default}'s doc comment) is present only when the index has a partial predicate — read via {@link indexWhere}. */
export type IndexSnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<IndexColumnSnapshot>;
	readonly unique?: true;
	readonly where?: JsonValue;
};

/** `index.unique`, defaulting to `false` when absent (compact snapshot). */
export const indexUnique = (index: IndexSnapshot): boolean =>
	index.unique === true;

/** `index.where` decoded and rendered back to SQL text, defaulting to `null` when absent (compact snapshot). */
export const indexWhere = (index: IndexSnapshot): string | null => {
	if (index.where === undefined || index.where === null) {
		return null;
	}
	return renderExpr(decodeExprNode(index.where));
};

/** A single foreign key as materialized in a table snapshot, with its name derived and its target table resolved to an identity string. **Compact**: `onDelete`/`onUpdate` are present only when set (default `null`, meaning "unspecified") — read via {@link foreignKeyOnDelete}/{@link foreignKeyOnUpdate}. */
export type ForeignKeySnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesTable: string;
	readonly referencesColumns: ReadonlyArray<string>;
	readonly onDelete?: ForeignKeyAction;
	readonly onUpdate?: ForeignKeyAction;
};

/** `foreignKey.onDelete`, defaulting to `null` when absent (compact snapshot). */
export const foreignKeyOnDelete = (
	foreignKey: ForeignKeySnapshot,
): ForeignKeyAction | null => foreignKey.onDelete ?? null;

/** `foreignKey.onUpdate`, defaulting to `null` when absent (compact snapshot). */
export const foreignKeyOnUpdate = (
	foreignKey: ForeignKeySnapshot,
): ForeignKeyAction | null => foreignKey.onUpdate ?? null;

/** A single CHECK constraint as materialized in a table snapshot: its name and its expression (D50), a structured node (D67/D70 — see {@link ColumnSnapshot.default}'s doc comment) — read via {@link checkExpression}. */
export type CheckSnapshot = {
	readonly name: string;
	readonly expression: JsonValue;
};

/** `check.expression` decoded and rendered back to SQL text. */
export const checkExpression = (check: CheckSnapshot): string =>
	renderExpr(decodeExprNode(check.expression));

/** The full snapshot node `tableKind.serialize` produces for one table. **Compact**: `checks` is present only when the table declares at least one (default `[]`) — read via {@link tableChecks}. */
export type TableSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<ColumnSnapshot>;
	readonly indexes: ReadonlyArray<IndexSnapshot>;
	readonly foreignKeys: ReadonlyArray<ForeignKeySnapshot>;
	readonly checks?: ReadonlyArray<CheckSnapshot>;
};

/** `snapshot.checks`, defaulting to `[]` when absent (compact snapshot, D33). */
export const tableChecks = (
	snapshot: TableSnapshot,
): ReadonlyArray<CheckSnapshot> => snapshot.checks ?? [];

// Internal invariant: this shape is exactly what tableKind.serialize (table-kind.ts) produces.
/** Narrows a raw snapshot `JsonValue` to {@link TableSnapshot}. */
export const asTableSnapshot = (snapshot: JsonValue): TableSnapshot =>
	snapshot as TableSnapshot;

/** A table's identity string: `"<schema>.<tableName>"`. */
export const tableIdentity = (schemaName: string, tableName: string): string =>
	`${schemaName}.${tableName}`;

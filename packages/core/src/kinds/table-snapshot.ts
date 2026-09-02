import type { ForeignKeyAction, IndexMethod, IndexNulls } from "../dsl/table";
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
 *
 * `uniqueName` (#24/D68) records the column's UNIQUE constraint's
 * deterministic name (present exactly when `unique` is `true`) —
 * Postgres's own default naming convention for a bare inline `unique`
 * column clause, frozen now (pre-1.0, D65) so a future name-aware
 * feature (e.g. UNIQUE alter emission) never has to disagree with a name
 * already committed to a user's database. UNIQUE *emission* stays
 * column-level and unimplemented in this wave (`table-kind-emit.ts`'s
 * `unsupported-column-alter` guard) — only the name is recorded here.
 *
 * `generated` (add-generated-columns, D100) is a stored computed column's
 * own expression, encoded the same way `default` is (the expression
 * codec) — present only on a `.generatedAlwaysAs(...)` column, read via
 * {@link columnGenerated}. `identity` records an identity column's kind
 * and any options its declaration set explicitly (design decision 3:
 * declaration-is-truth, never diffed against a Postgres default the
 * declaration never mentioned) — read via {@link columnIdentity}.
 * `generated`/`identity` are mutually exclusive on a real column
 * (`table()`'s own guard, `dsl/table.ts`), but this type doesn't encode
 * that itself — the same way `default`/`unique` aren't mutually
 * exclusive at this type's level either.
 */
export type ColumnSnapshot = {
	readonly name: string;
	readonly typeNode: TypeNode;
	readonly notNull?: true;
	readonly primaryKey?: true;
	readonly unique?: true;
	readonly uniqueName?: string;
	readonly default?: JsonValue;
	readonly generated?: JsonValue;
	readonly identity?: IdentitySnapshot;
};

/**
 * An identity column's kind and any sequence options its declaration set
 * explicitly (D100) — {@link ColumnSnapshot.identity}'s own shape. `kind`
 * is kebab-case (`"by-default"`, not `"byDefault"`) per D57: it
 * materializes into this artifact, unlike `IdentityKind`
 * (`types/column-builder.ts`), the camelCase TypeScript-only union it's
 * encoded from. The option fields stay camelCase (`startWith`, …) —
 * D57's kebab rule targets *tokens*, not field names; every other
 * snapshot field name in this file (`typeNode`, `uniqueName`,
 * `primaryKeyName`, …) is camelCase too.
 */
export type IdentitySnapshot = {
	readonly kind: "always" | "by-default";
	readonly startWith?: number;
	readonly increment?: number;
	readonly minValue?: number;
	readonly maxValue?: number;
	readonly cache?: number;
	readonly cycle?: boolean;
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

/** `column.uniqueName`, defaulting to `null` when absent (compact snapshot — always absent when `unique` is `false`). */
export const columnUniqueName = (column: ColumnSnapshot): string | null =>
	column.uniqueName ?? null;

/** `column.default` decoded and rendered back to SQL text, defaulting to `null` when absent (compact snapshot). */
export const columnDefault = (column: ColumnSnapshot): string | null => {
	if (column.default === undefined || column.default === null) {
		return null;
	}
	return renderExpr(decodeExprNode(column.default));
};

/** `column.generated` decoded and rendered back to SQL text, defaulting to `null` when absent (compact snapshot) — mirrors {@link columnDefault} (D100). */
export const columnGenerated = (column: ColumnSnapshot): string | null => {
	if (column.generated === undefined) {
		return null;
	}
	return renderExpr(decodeExprNode(column.generated));
};

/** `column.identity`, defaulting to `null` when absent (compact snapshot, D100). */
export const columnIdentity = (
	column: ColumnSnapshot,
): IdentitySnapshot | null => column.identity ?? null;

/**
 * One column of an index as materialized in a table snapshot (D51/R8):
 * either a plain column (`name`) or an expression column (`expression`,
 * `encodeExprNode` output — see {@link ColumnSnapshot.default}'s doc
 * comment for why expressions are structured nodes, not rendered text),
 * exactly one of the two, plus its sort direction, nulls placement, and
 * operator class. **Compact**: `desc`/`nulls`/`opclass` are present only
 * when non-default — read via {@link indexColumnDesc}/
 * {@link indexColumnNulls}/{@link indexColumnOpclass}/
 * {@link indexColumnExpression}. `opclass` is a D36 identifier stored
 * verbatim — SQL's own token, the same naming-rule exception as
 * `ComparisonNode.operator`/`OrderByTerm.direction` (R8).
 */
export type IndexColumnSnapshot = (
	| { readonly name: string }
	| { readonly expression: JsonValue }
) & {
	readonly desc?: true;
	readonly nulls?: IndexNulls;
	readonly opclass?: string;
};

/** `column.desc`, defaulting to `false` when absent (compact snapshot). */
export const indexColumnDesc = (column: IndexColumnSnapshot): boolean =>
	column.desc === true;

/** `column.nulls`, defaulting to `null` when absent (compact snapshot). */
export const indexColumnNulls = (
	column: IndexColumnSnapshot,
): IndexNulls | null => column.nulls ?? null;

/** `column.opclass`, defaulting to `null` when absent (compact snapshot). */
export const indexColumnOpclass = (
	column: IndexColumnSnapshot,
): string | null => column.opclass ?? null;

/** Narrows `column` to its `expression` variant (R5/R8). */
export const isExpressionIndexColumn = (
	column: IndexColumnSnapshot,
): column is Extract<IndexColumnSnapshot, { readonly expression: JsonValue }> =>
	"expression" in column;

/** `column.expression` decoded and rendered back to SQL text, `null` for a plain-column entry (mirrors {@link indexWhere}). */
export const indexColumnExpression = (
	column: IndexColumnSnapshot,
): string | null => {
	if (!isExpressionIndexColumn(column)) {
		return null;
	}
	return renderExpr(decodeExprNode(column.expression));
};

/**
 * A single index as materialized in a table snapshot, with its name
 * resolved. **Compact**: `unique` is present only when `true` (default
 * `false`) — read via {@link indexUnique}; `where` (a structured
 * expression node, D67/D70 — see {@link ColumnSnapshot.default}'s doc
 * comment) is present only when the index has a partial predicate — read
 * via {@link indexWhere}; `method` is present only for a non-`btree`
 * access method (D84/D85, R8) — `btree` (Postgres' own default) is never
 * written — read via {@link indexMethod}.
 */
export type IndexSnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<IndexColumnSnapshot>;
	readonly unique?: true;
	readonly where?: JsonValue;
	readonly method?: Exclude<IndexMethod, "btree">;
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

/** `index.method`, defaulting to `"btree"` when absent (compact snapshot — `btree` is never written, R8). */
export const indexMethod = (index: IndexSnapshot): IndexMethod =>
	index.method ?? "btree";

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

/**
 * The full snapshot node `tableKind.serialize` produces for one table.
 * **Compact**: `checks` is present only when the table declares at least
 * one (default `[]`) — read via {@link tableChecks}.
 *
 * `primaryKeyName` (#24/D68) records the table's primary key constraint's
 * deterministic name — present exactly when at least one column has
 * `primaryKey: true` (`columns` alone still owns *membership*; recording
 * the name here, not per column, avoids duplicating it once per member —
 * approved design, #24). Frozen now (pre-1.0, D65) for the same reason as
 * {@link ColumnSnapshot.uniqueName}: a later PK-alter feature must never
 * disagree with a name already committed to a user's database.
 *
 * `unmanaged` (add-unmanaged-objects, D33 compact rule) marks a table
 * declared with `existingTable()` — present only when `true` (absent ⇒
 * managed) — read via {@link tableUnmanaged}. A snapshot written before
 * this field existed has no unmanaged tables (every table reads as
 * managed).
 */
export type TableSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<ColumnSnapshot>;
	readonly indexes: ReadonlyArray<IndexSnapshot>;
	readonly foreignKeys: ReadonlyArray<ForeignKeySnapshot>;
	readonly checks?: ReadonlyArray<CheckSnapshot>;
	readonly primaryKeyName?: string;
	readonly unmanaged?: true;
};

/** `snapshot.checks`, defaulting to `[]` when absent (compact snapshot, D33). */
export const tableChecks = (
	snapshot: TableSnapshot,
): ReadonlyArray<CheckSnapshot> => snapshot.checks ?? [];

/** `snapshot.primaryKeyName`, defaulting to `null` when absent (compact snapshot — always absent when no column has `primaryKey: true`). */
export const tablePrimaryKeyName = (snapshot: TableSnapshot): string | null =>
	snapshot.primaryKeyName ?? null;

/** `snapshot.unmanaged`, defaulting to `false` when absent (compact snapshot — a pre-marker snapshot reads as managed). */
export const tableUnmanaged = (snapshot: TableSnapshot): boolean =>
	snapshot.unmanaged === true;

// Internal invariant: this shape is exactly what tableKind.serialize (table-kind.ts) produces.
/** Narrows a raw snapshot `JsonValue` to {@link TableSnapshot}. */
export const asTableSnapshot = (snapshot: JsonValue): TableSnapshot =>
	snapshot as TableSnapshot;

/** A table's identity string: `"<schema>.<tableName>"`. */
export const tableIdentity = (schemaName: string, tableName: string): string =>
	`${schemaName}.${tableName}`;

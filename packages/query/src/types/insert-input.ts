import type { ColumnBuilder, Table } from "@hejbro/core";
import type { ColumnTsType } from "./column-map";

/** Whether a column's `TMeta` declares `notNull: true`, structurally (mirrors `select-result.ts`'s own same-named helper and `column-map.ts`'s infer-from-`ColumnBuilder` pattern, task 3.3). */
type IsColumnNotNull<TColumn extends ColumnBuilder> =
	TColumn extends ColumnBuilder<infer _TFamily, infer TMeta>
		? TMeta extends { readonly notNull: true }
			? true
			: false
		: false;

/** Whether a column's `TMeta` declares `hasDefault: true` (task 3.2/3.16 — `.default()`/`.defaultRandom()`/`.defaultNow()`, or the `serial` family's own implied default, D66). */
type IsColumnHasDefault<TColumn extends ColumnBuilder> =
	TColumn extends ColumnBuilder<infer _TFamily, infer TMeta>
		? TMeta extends { readonly hasDefault: true }
			? true
			: false
		: false;

/**
 * One declared column's insert-value type: {@link ColumnTsType} (task
 * 3.6's base/brand mapping), widened to `| null` unless the column is
 * `notNull` — a nullable column legally accepts an explicit `null` write,
 * same direction as `select-result.ts`'s own read-side widening.
 */
type InsertColumnValue<TColumn extends ColumnBuilder> =
	IsColumnNotNull<TColumn> extends true
		? ColumnTsType<TColumn>
		: ColumnTsType<TColumn> | null;

/** The declared column keys that MUST appear in an insert row: `notNull` and no default (D8/D3.11's own scope — generated columns, which would need a stronger "has no way to receive a value" rule, are parked as #308). */
type RequiredInsertKeys<TColumns extends Record<string, ColumnBuilder>> = {
	[K in keyof TColumns]: IsColumnNotNull<TColumns[K]> extends true
		? IsColumnHasDefault<TColumns[K]> extends true
			? never
			: K
		: never;
}[keyof TColumns];

/** Every declared column key that isn't required (D8's `col?: T` convention) — nullable columns, and any `notNull` column that also has a default (Postgres fills it in, so omitting it is legal). */
type OptionalInsertKeys<TColumns extends Record<string, ColumnBuilder>> =
	Exclude<keyof TColumns, RequiredInsertKeys<TColumns>>;

/**
 * The row shape `insert()` accepts (D1/D3/D8, task 3.11) — a pure type
 * utility over a declared `Table`'s own `TColumns` (task 3.3's own
 * extraction pattern), not yet wired into `insert()`'s actual parameter
 * type (that wiring, like task 3.9's numeric-mode conversion and task
 * 3.10's `select()` return type, is group 4's job; core's own
 * `MutationRow<TTable>` still types every column as optional and
 * family-only — this file doesn't touch it).
 *
 * A column is a **required** key only when it's `notNull` *and* has no
 * default (`RequiredInsertKeys`) — Postgres itself would reject an
 * insert omitting such a column, so the type has to reject it too, one
 * key at a time via TypeScript's own excess/missing-property checking
 * on an object literal (no extra logic needed here). Every other
 * declared column is `col?: T` (D8): a `notNull` column *with* a default
 * is optional because Postgres fills it in when omitted, and a nullable
 * column is optional because omitting it and writing `null` to it both
 * mean "no value" — {@link InsertColumnValue} accepts `null` explicitly
 * for exactly that column.
 */
export type InsertInput<TTable extends Table> =
	TTable extends Table<infer TColumns>
		? {
				[K in RequiredInsertKeys<TColumns>]: InsertColumnValue<TColumns[K]>;
			} & {
				[K in OptionalInsertKeys<TColumns>]?: InsertColumnValue<TColumns[K]>;
			}
		: never;

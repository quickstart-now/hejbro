import type {
	ColumnBuilder,
	Expr,
	IntervalValue,
	SelectProjection,
	SqlTypeFamily,
	Table,
} from "@hejbro/core";
import type { ColumnTsType } from "./column-map";

/** Whether a column's `TMeta` declares `notNull: true`, structurally (mirrors `column-map.ts`'s own infer-from-`ColumnBuilder` pattern, task 3.3) — task 3.16's `primaryKey()`/`serial` implied-not-null already lands in `TMeta` by the time this reads it, so `uuid().primaryKey()` resolves `true` here with no extra case. */
type IsColumnNotNull<TColumn extends ColumnBuilder> =
	TColumn extends ColumnBuilder<infer _TFamily, infer TMeta>
		? TMeta extends { readonly notNull: true }
			? true
			: false
		: false;

/**
 * One declared column's select-result type: {@link ColumnTsType} (task
 * 3.6's base/brand mapping), widened to `| null` unless the column is
 * `notNull` — `notNull` decides nullability (D1/D3), read directly off
 * the column's own `TMeta`.
 */
export type SelectColumnResult<TColumn extends ColumnBuilder> =
	IsColumnNotNull<TColumn> extends true
		? ColumnTsType<TColumn>
		: ColumnTsType<TColumn> | null;

/**
 * The coarse read type for one {@link SqlTypeFamily} alone — used only
 * for the object-projection form of {@link SelectResult} below, where a
 * projected `Expr` carries no `TMeta` at all: `expr/ast.ts`'s
 * `ColumnRef<TFamily>` only ever carried the SQL family, never
 * `notNull`/`hasDefault`/`mode`/`element`/the `$type` brand (the same
 * root cause parked as #307 for left-join nullability — a `ColumnRef`
 * doesn't remember which declared column it came from). Deliberately the
 * *widest honest* type per family, never the richer per-declared-type
 * mapping {@link ColumnTsType}/`BaseTsType` compute: a family collapses
 * several distinct declared types together (e.g. `"numeric"` covers
 * `smallint`/`integer`/`bigint`/`numeric`/`serial`-family columns, whose
 * resolved numeric modes can each differ), so anything narrower than the
 * union of everything that family could actually be would risk a lie —
 * exactly what this group's `$type` contract ("narrows only, never
 * lies") rules out everywhere else. A flat lookup (D1's "no distributive
 * tricks" guidance), ending in `never` for a family this file hasn't
 * accounted for rather than a silent wide fallback.
 */
type FamilyReadType<TFamily extends SqlTypeFamily> = TFamily extends
	| "uuid"
	| "text"
	| "net"
	? string
	: TFamily extends "numeric"
		? // mode ('bigint'/'number'/'string') isn't visible at the family
			// level -- this has to cover whichever mode the underlying
			// declared column actually resolved to.
			number | bigint | string
		: TFamily extends "boolean"
			? boolean
			: TFamily extends "datetime"
				? // time/timetz read as string, date/timestamp/timestamptz as
					// Date -- family collapses that distinction too (mirrors
					// LiftableFor's own same choice on the input side).
					Date | string
				: TFamily extends "interval"
					? IntervalValue
					: TFamily extends "json"
						? // no $type brand is possible without TMeta.
							unknown
						: TFamily extends "bytea"
							? Uint8Array
							: TFamily extends "array"
								? // the element type isn't visible at the family level either.
									ReadonlyArray<unknown>
								: TFamily extends "unknown"
									? unknown
									: never;

/**
 * The row type a `select()` projection reads back as (D1/D3/D5, task
 * 3.10) — a pure type utility over core's own `SelectProjection` union
 * (`query/select.ts`), not yet wired into `select()`'s actual return
 * type (that wiring, like task 3.9's numeric-mode conversion, is group
 * 4's job). Two branches, matching `SelectProjection = Table | Record<
 * string, Expr>` exactly:
 *
 * - **Whole-table** (`select(table)`): full per-column richness —
 *   nullability, numeric mode, array element, the `$type` brand — read
 *   directly off the table's own `TColumns` (task 3.3's own extraction
 *   pattern, `TTable extends Table<infer TColumns>`), never through
 *   `Expr`/`ColumnRef`.
 * - **Object projection** (`select({a: expr, …}, table)`): a reduced
 *   contract, tracked as **#311**. The projected keys are exact — only
 *   those keys exist on the result, so an unprojected key is a compile
 *   error where it's accessed — but the *type* per key is only
 *   {@link FamilyReadType}, widened to `| null`. This is reduced, not
 *   negligence: an `Expr`/`ColumnRef` (`expr/ast.ts`, predates this
 *   group) carries only a `SqlTypeFamily`, never `TMeta` — no
 *   `notNull`/`hasDefault`/`mode`/`element`/`$type` brand, the same root
 *   cause #307's parked left-join nullability hit ("`ColumnRef` doesn't
 *   remember which declared column it came from"). Widening to nullable
 *   is the honest direction with that information missing (an absent
 *   guarantee reads as possibly-null, never as a false non-null
 *   promise) — the same direction #307 took. Matching the projected
 *   key's *name* against the source table's same-named declared column
 *   to borrow richness was considered and rejected: two differently-typed
 *   columns can share a family (`posts.id` and `posts.title` are both
 *   `"uuid"`-or-`"text"`-family-adjacent), so a name match proves nothing
 *   about which column an `Expr` actually reads from and would let the
 *   widened type quietly lie again. #311 tracks giving `ColumnRef` its
 *   declaration source (or `TMeta` itself) so this branch can recover
 *   full richness instead.
 */
export type SelectResult<TProjection extends SelectProjection> =
	TProjection extends Table<infer TColumns>
		? { readonly [K in keyof TColumns]: SelectColumnResult<TColumns[K]> }
		: TProjection extends Record<string, Expr>
			? {
					readonly [K in keyof TProjection]: TProjection[K] extends Expr<
						infer TFamily
					>
						? FamilyReadType<TFamily> | null
						: never;
				}
			: never;

import type {
	ColumnBuilder,
	ColumnRefNode,
	columnOriginBrand,
	Expr,
	IntervalValue,
	NestedReadMarker,
	readAsBrand,
	SelectProjection,
	SqlTypeFamily,
	Table,
	UntrackedJoins,
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
export type SelectResult<
	TProjection extends SelectProjection,
	TLeftJoined = UntrackedJoins,
> =
	TProjection extends Table<infer TColumns>
		? { readonly [K in keyof TColumns]: SelectColumnResult<TColumns[K]> }
		: TProjection extends Record<string, Expr>
			? {
					readonly [K in keyof TProjection]: NestedOrExprResult<
						TProjection[K],
						TLeftJoined
					>;
				}
			: never;

/**
 * One object-projection value's result type: a nested read
 * (`jsonArrayFrom`/`jsonObjectFrom`, recognized by its phantom
 * {@link NestedReadMarker}) resolves through {@link SelectResult}
 * RECURSIVELY — so a nested row's columns carry exactly the declared
 * read types a top-level select would (D102 cast+revive), and
 * grandchildren compose for free. Everything else keeps the flat
 * family-widened fallback (#311's known gap, unchanged here).
 */
type NestedOrExprResult<TValue, TLeftJoined> =
	TValue extends NestedReadMarker<infer TMode, infer TSub>
		? [TMode] extends ["jsonArray"]
			? ReadonlyArray<SelectResult<TSub>>
			: [TMode] extends ["jsonObject"]
				? SelectResult<TSub> | null
				: ReadonlyArray<SelectResult<TSub>> | SelectResult<TSub> | null
		: ProjectedColumnResult<TValue, TLeftJoined>;

/**
 * The declared column a projected value came from, recovered through the
 * origin brand `TableColumns` stamps on every built table's column refs
 * (`columnOriginBrand`, add-relational-reads) — the same edge
 * `.references()` reads. `never` for anything else: a computed `Expr`, a
 * `sql` fragment, a hand-built `columnRef()`.
 *
 * The brand is optional, so every type structurally satisfies the outer
 * `extends` — `TOrigin` infers as `unknown` when the property is absent,
 * and `NonNullable` strips the `| undefined` an actual brand carries.
 */
type OriginColumn<TValue> = TValue extends {
	readonly [columnOriginBrand]?: infer TOrigin;
}
	? NonNullable<TOrigin> extends {
			readonly columns: infer TColumns;
			readonly key: infer TKey;
		}
		? TKey extends keyof TColumns
			? TColumns[TKey] extends ColumnBuilder
				? TColumns[TKey]
				: never
			: never
		: never
	: never;

/**
 * The origin's OWN column map — `OriginColumn`'s same brand walk, but
 * stopping at `TColumns` instead of indexing into `TColumns[TKey]`
 * (narrow-join-nullability, task 2.3): the column map is what identifies
 * WHICH table a column came from, for {@link ColumnMapIsLeftJoinedMember}
 * to compare against the tracked set's own tables.
 */
type OriginColumnMap<TValue> = TValue extends {
	readonly [columnOriginBrand]?: infer TOrigin;
}
	? NonNullable<TOrigin> extends {
			readonly columns: infer TColumns;
			readonly key: infer TKey;
		}
		? TKey extends keyof TColumns
			? TColumns
			: never
		: never
	: never;

/**
 * One object-projection field's type (#311, narrowed per narrow-join-
 * nullability groups 2.1-2.3). A projected *declared column* resolves to
 * its own declared read type — numeric mode, array element, the `$type`
 * brand, the whole {@link ColumnTsType} mapping — instead of the
 * family-wide union {@link FamilyReadType} had to use when a `ColumnRef`
 * was assumed to carry nothing but its family.
 *
 * **Nullability narrows only when every one of four conditions holds**
 * (the frozen contract): the value is a direct column reference
 * ({@link IsDirectColumnRef}) — this is what excludes `min`/`max`/
 * `over(...)`, which preserve the origin brand through `Aggregated` but
 * widen `exprNode` past `ColumnRefNode` in doing so; the origin brand is
 * present at all ({@link OriginColumn} resolving something other than
 * `never`); the left-joined set is tracked
 * ({@link IsTrackedLeftJoinedSet}); and the origin's OWN column map
 * matches no member of that set ({@link ColumnMapIsLeftJoinedMember}) —
 * a column literally sourced from a left-joined table really can arrive
 * `null` no matter what it declares. Any one condition failing keeps the
 * field `| null`, the same widened answer this type has always given —
 * narrowing is additive, never a replacement for the widened default.
 *
 * The narrowed arm resolves through {@link SelectColumnResult} — the SAME
 * `IsColumnNotNull`-paired mapping the whole-table branch above uses —
 * not the bare {@link ColumnTsType} the other three arms fall back to
 * (task 2.6, a defect found during group 3): `ColumnTsType` alone carries
 * no nullability for a scalar column, so a **nullable** column that met
 * all four conditions above used to lose its `| null` even though it can
 * still arrive `null` on its own declared terms, independent of any join.
 */
type ProjectedColumnResult<TValue, TLeftJoined> = [
	OriginColumn<TValue>,
] extends [never]
	? [ReadAsType<TValue>] extends [never]
		? TValue extends Expr<infer TFamily>
			? FamilyReadType<TFamily> | null
			: never
		: ReadAsType<TValue> | null
	: IsDirectColumnRef<TValue> extends true
		? IsTrackedLeftJoinedSet<TLeftJoined> extends true
			? ColumnMapIsLeftJoinedMember<
					OriginColumnMap<TValue>,
					TLeftJoined
				> extends true
				? ColumnTsType<OriginColumn<TValue>> | null
				: SelectColumnResult<OriginColumn<TValue>>
			: ColumnTsType<OriginColumn<TValue>> | null
		: ColumnTsType<OriginColumn<TValue>> | null;

/**
 * `true` when `TColumns` (a projected field's OWN origin column map)
 * matches at least one member of the tracked left-joined set
 * (narrow-join-nullability, task 2.3) — the field's source table really
 * was left-joined, so even a `notNull` column stays nullable. `false`,
 * including for `TLeftJoined = never` (the empty tracked set: nothing was
 * left-joined, so nothing can match).
 *
 * `TLeftJoined extends Table<infer TMemberColumns> ? … : false` on a
 * naked `TLeftJoined` distributes over a union of tables one member at a
 * time, producing a union of booleans — `Extract<…, true>` is what turns
 * "was any member's result `true`" into a single boolean, since `boolean
 * extends true` is itself `false` (a union is not its own member).
 * `never` distributes to `never` (conditional types short-circuit there),
 * and `Extract<never, true>` is `never`, landing on the `false` arm below
 * — exactly the empty-tracked-set case.
 *
 * The membership comparison itself is mutual `extends` (structural
 * equality), not one-directional (task 2.5, settled against a
 * measurement): one-directional `[TColumns] extends [TMemberColumns]`
 * treats a table whose column map is a structural SUPERSET of a tracked
 * table's as a match too — a superset always structurally extends its own
 * subset — which over-widens a field from a table that was never actually
 * left-joined (measured directly: a `commentsWithExtra` table carrying
 * every one of `comments`'s own columns plus one more wrongly matched
 * `comments` under one-directional `extends`, and stopped matching once
 * this became mutual). Over-widening is still the fail-safe direction,
 * never a lie, but it is avoidable imprecision here, not a soundness
 * trade-off, so there is no reason to accept it.
 */
type ColumnMapEquals<TLeft, TRight> = [TLeft] extends [TRight]
	? [TRight] extends [TLeft]
		? true
		: false
	: false;

type ColumnMapIsLeftJoinedMember<TColumns, TLeftJoined> = [
	Extract<
		TLeftJoined extends Table<infer TMemberColumns>
			? ColumnMapEquals<TColumns, TMemberColumns>
			: false,
		true
	>,
] extends [never]
	? false
	: true;

/**
 * `true` only for a raw column reference, `false` for anything built
 * through {@link Aggregated} (`min`/`max`/`over(...)`, `expr/aggregate.ts`
 * and `expr/window.ts`) even though the origin brand survives that
 * wrapping too (narrow-join-nullability, task 2.2) — `Aggregated<TExpr> =
 * Omit<TExpr, "exprNode" | "sqlName"> & { readonly exprNode: ExprNode }`
 * keeps every other property (including the origin brand) but replaces
 * `exprNode`'s own type with the WIDE `ExprNode` union, so only a value
 * whose `exprNode` is still narrowly typed as {@link ColumnRefNode}
 * (a real `ColumnRef`, never widened) passes this check.
 */
type IsDirectColumnRef<TValue> = TValue extends {
	readonly exprNode: ColumnRefNode;
}
	? true
	: false;

/**
 * `true` when `TLeftJoined` is a tracked left-joined set, `false` for
 * {@link UntrackedJoins} itself (narrow-join-nullability, task 2.1) — the
 * frozen contract's own membership test (`[UntrackedJoins] extends
 * [TLeftJoined]`), inverted. Measured (G1 review): `unknown` is not the
 * only type this resolves `false` for — `any` does too, since `any`
 * absorbs both directions of an `extends` check — so a set that somehow
 * arrives as `any` is judged untracked, which stays the fail-safe
 * direction (widen, never narrow on missing information).
 */
type IsTrackedLeftJoinedSet<TLeftJoined> = [UntrackedJoins] extends [
	TLeftJoined,
]
	? false
	: true;

/**
 * The read type an expression declares for itself (#416's `count`), or
 * `never` when it declares none. Read exactly like {@link OriginColumn}:
 * the brand is optional, so `NonNullable` is what separates "carries one"
 * from "does not".
 *
 * Ordered AFTER the origin brand above, and it never competes with it —
 * a declared column is more precise than any self-declared type. "An
 * aggregate over one produces a new expression that carries no origin" is
 * true of `count()` alone (its own `expr()` rebuild carries nothing from
 * its operand) — `min`/`max`/`over(...)` preserve the origin brand through
 * `Aggregated`'s `Omit`, which is the entire reason {@link
 * IsDirectColumnRef} exists to exclude them elsewhere (narrow-join-
 * nullability, task 2.2 correction).
 */
type ReadAsType<TValue> = TValue extends { readonly [readAsBrand]?: infer T }
	? NonNullable<T> extends never
		? never
		: NonNullable<T>
	: never;

import type { ForeignKeyAction } from "../dsl/table";
import { throwHejbroError } from "../error";
import type { ColumnRef, Expr, ExprNode } from "../expr/ast";
import { isExpr } from "../expr/ast";
import { liftLiteral } from "../expr/literal";
import type { LiftableFor, SqlTypeFamily } from "../expr/type-family";
import { familyOfTypeNode } from "../expr/type-family";
import type { BaseTsType } from "./ts-type-map";
import type { TypeNode } from "./type-node";

/**
 * The visible TypeScript width `bigint({ mode })`/`numeric({ mode })`
 * (task 3.4) resolve to, mirroring Drizzle's own surface. Resolved once,
 * at the factory, and carried on both `ColumnState.mode` (for group 4's
 * runtime row conversion) and `TMeta.mode` (for the compile-time-visible
 * type) — never left "unset with a default applied downstream", so the
 * two can never disagree about which mode a column uses.
 */
export type NumericMode = "bigint" | "number" | "string";

/** The immutable state carried by a {@link ColumnBuilder}. */
export type ColumnState = {
	readonly typeNode: TypeNode;
	readonly notNull: boolean;
	readonly primaryKey: boolean;
	readonly unique: boolean;
	readonly defaultValue: ExprNode | null;
	/** {@link NumericMode}, resolved at the factory; `null` for every column outside the `bigint`/`numeric` factories (task 3.4) — this is compile-time information about *reading* the column, not part of its declared SQL type, so it never reaches `typeNode`, generated SQL, or the snapshot. */
	readonly mode: NumericMode | null;
	/**
	 * Set only by `.notNullElements()` (add-array-ergonomics) — absent for
	 * every other column (mirrors `ColumnMeta`'s own optional flags, e.g.
	 * `element?`). `table()` reads this to validate the column is actually
	 * an `.array()` column (naming it if not) and to derive the backing
	 * CHECK (`<column>_no_null_elements`) into the table's own checks list;
	 * `@hejbro/query`'s element conversion reads it for the fail-fast
	 * guard. The flag itself is never serialized (the derived check is the
	 * serialized artifact — design decision 2).
	 */
	readonly notNullElements?: true;
	/**
	 * Set only by `.generatedAlwaysAs(expression)` (add-generated-columns) —
	 * the stored computed column's own expression, as the fragment's
	 * `ExprNode` (the `sql`-tag path, same as `defaultValue`'s expression
	 * arm). Mutually exclusive with both `defaultValue` (non-`null`) and
	 * `identity` (set) — Postgres allows only one `GENERATED`/`DEFAULT`
	 * clause per column; `table()` is where that combination is rejected
	 * (design decision 2), since a bare builder has no column name yet to
	 * name in an error.
	 */
	readonly generated?: ExprNode;
	/**
	 * Set only by `.generatedAlwaysAsIdentity()`/
	 * `.generatedByDefaultAsIdentity()` (add-generated-columns) — see
	 * {@link IdentityState}. Mutually exclusive with `generated` (set), for
	 * the same reason.
	 */
	readonly identity?: IdentityState;
	/**
	 * Set only by `.references()` (add-relational-reads) — the deferred
	 * target thunk, stored unevaluated for import-order safety; `table()`
	 * is the single evaluation point (a bare builder has no column name
	 * yet to build a `ForeignKeyDeclaration` from).
	 */
	readonly references?: () => ColumnRef;
	/** Set only by `.references(target, actions)`'s second argument (add-references-actions) -- always alongside `references` above, since `.references()` is the only writer of either slot, so "actions without a thunk" is unreachable. A later `.references()` call replaces the reference as a whole (target and actions together, 514/R6), so the writer always sets this to `null` when its own `actions` argument is absent -- never leaves an earlier call's value in place. */
	readonly referenceActions?: {
		readonly onDelete?: ForeignKeyAction;
		readonly onUpdate?: ForeignKeyAction;
	} | null;
};

/**
 * Sequence options accepted by `.generatedAlwaysAsIdentity()`/
 * `.generatedByDefaultAsIdentity()` (D100) — Postgres's own identity
 * sequence options, spelled camelCase to match the rest of the DSL surface.
 * `restart` is deliberately absent: a declarative snapshot carries no live
 * sequence position to restart from (design decision 4's own "out of
 * scope" note).
 */
export type IdentityOptions = {
	readonly startWith?: number;
	readonly increment?: number;
	readonly minValue?: number;
	readonly maxValue?: number;
	readonly cache?: number;
	readonly cycle?: boolean;
};

/**
 * The two identity kinds Postgres supports, spelled camelCase (D57 —
 * TypeScript-only union) for both `ColumnMeta.identity` and
 * `ColumnState.identity.kind`. The snapshot's own kebab-case token
 * (`"by-default"`, D57 — a token that reaches a generated artifact) is
 * group 2's own encoding step; this group never writes it.
 */
export type IdentityKind = "always" | "byDefault";

/**
 * `columnState.identity`'s own shape: the kind plus exactly the options the
 * declaration set — an option the declaration never mentioned is absent
 * from `options`, not filled in with a value, so it is never diffed against
 * Postgres's own default (declaration-is-truth, design decision "Risks").
 */
export type IdentityState = {
	readonly kind: IdentityKind;
	readonly options: IdentityOptions;
};

/**
 * The type-level metadata a {@link ColumnBuilder} carries in its second type
 * parameter `TMeta` (D1) — the declared type name, plus (from task 3.2)
 * whether `.notNull()`/a default were chained. `notNull`/`hasDefault` are
 * optional rather than required `boolean`s: the twenty-odd factories and
 * direct-construction call sites (task 3.1) only ever mention `typeName` in
 * their literal `TMeta` type argument, and an absent optional key reads the
 * same as `false` everywhere this group inspects it (3.10/3.11) — making
 * them required would force every one of those call sites to spell out
 * `notNull: false, hasDefault: false` for no behavioral gain. Later tasks
 * (numeric width mode, jsonb `$type` brand) widen this same type,
 * additively, in place.
 */
export type ColumnMeta = {
	readonly typeName: TypeNode["typeName"];
	readonly notNull?: boolean;
	readonly hasDefault?: boolean;
	/** set only by `.array()` (task 3.15): the element's own declared type name, so 3.6 can map an array through its element instead of losing it. */
	readonly element?: TypeNode["typeName"];
	/** set only by `bigint({mode})`/`numeric({mode})` (task 3.4) — see {@link NumericMode}. */
	readonly mode?: NumericMode;
	/** set only by `.$type<T>()` (D5, task 3.5) — the jsonb brand 3.6 reads instead of falling back to `unknown`. */
	readonly jsonType?: unknown;
	/** set only by `pgEnum(...).column()` (#422) — the declared values as a literal union, so an enum column reads and writes as its own values instead of bare `string`. Absent (and the type falls back to `string`) only for a declaration that genuinely has no literal values to carry. */
	readonly enumValues?: string;
	/** set only by `.array().notNullElements()` (add-array-ergonomics) — narrows the element read/write type from `T | null` to `T` (`ts-type-map.ts`'s `BaseTsType`, this file's `ColumnReadType`), backed by the CHECK `table()` derives. Never carried forward by `.array()`'s own {@link ArrayCarriedFlags} — it can only ever be set by calling `.notNullElements()` after `.array()`, never inherited from a pre-array `TMeta`. */
	readonly notNullElements?: boolean;
	/**
	 * set only by `.generatedAlwaysAs()` (add-generated-columns) — the
	 * ALWAYS-family write-exclusion flag `@hejbro/query`'s insert-input
	 * classification reads directly (design decision 5). Never implies
	 * `notNull`/`hasDefault` on its own: a stored generated column's
	 * nullability follows the declaration's own `.notNull()` chaining
	 * exactly like a plain column, unlike identity below. `boolean`, not a
	 * bare `true` literal, mirroring `notNull?`/`hasDefault?`/
	 * `notNullElements?` above (task 3.2/add-array-ergonomics) — a chain
	 * method's return type still narrows this to the literal `true` via
	 * intersection (`TMeta & { generated: true }`), the same pattern every
	 * other flag here uses.
	 */
	readonly generated?: boolean;
	/**
	 * set only by `.generatedAlwaysAsIdentity()`/
	 * `.generatedByDefaultAsIdentity()` (add-generated-columns) — see
	 * {@link IdentityKind}. Both kinds additionally set `notNull`/
	 * `hasDefault` in `TMeta` (design decision 1: Postgres always treats an
	 * identity column as `NOT NULL` with a sequence-backed value,
	 * regardless of kind); `"always"` is further ALWAYS-family
	 * (write-excluded), while `"byDefault"` behaves like any other
	 * defaulted column on the write side.
	 */
	readonly identity?: IdentityKind;
	/**
	 * set only by `.references()` (add-relational-reads, D102) — the
	 * foreign-key edge at the type level: the target table's column map
	 * and the referenced column key. The query layer derives relations
	 * from it; nothing runtime-visible reads it.
	 */
	readonly references?: {
		readonly columns: Record<string, ColumnBuilder>;
		readonly key: string;
	};
};

/**
 * Hides `ColumnBuilder`'s type-only `TMeta` marker behind a unique symbol
 * (same technique as `tableMeta`, D15). Never assigned at runtime: every
 * `ColumnBuilder` chain method returns `ColumnBuilder<TFamily, TMeta>`
 * recursively, so without a non-recursive property actually mentioning
 * `TMeta`, two builders differing only in `TMeta` would be structurally
 * indistinguishable to TypeScript — exact type assertions
 * (`expectTypeOf(...).toEqualTypeOf<...>()`) would pass regardless of what
 * `TMeta` says. This optional phantom property is that non-recursive
 * mention; `?:` keeps it off every real object literal (confirmed by every
 * `columnState` deep-equal assertion in this file's tests, which would
 * otherwise fail the moment this key leaked onto a real builder).
 *
 * Plain `Symbol()`, not `Symbol.for(...)`, and not exported — unlike
 * `tableMeta`, neither would help here:
 * - This symbol's runtime identity is never compared (nothing ever reads
 *   `builder[columnMetaBrand]`; it exists purely so the *type checker* sees
 *   a non-recursive mention of `TMeta`). `tableMeta`'s `Symbol.for` earns
 *   its keep because `isTable`/`getTableMeta` actually look the key up on
 *   real objects at runtime, and two installed copies of `@hejbro/core`
 *   must agree on that key to interoperate (#138). No such cross-instance
 *   runtime lookup exists here, so there is nothing for a shared
 *   global-registry identity to protect.
 * - Exporting it wouldn't fix the two-copies case either: a `unique
 *   symbol`'s type identity is bound to *where it's declared*, not to its
 *   runtime value, so two installed copies of `@hejbro/core` still produce
 *   two distinct `unique symbol` types for `columnMetaBrand` even if both
 *   are `Symbol.for(...)` and both are exported — `ColumnBuilder` from one
 *   copy still wouldn't structurally match `ColumnBuilder` from the other.
 *   Since exporting buys nothing, there's no reason to pay `tableMeta`'s
 *   public-surface cost for it.
 *
 * Confirmed consumable from the built, non-exported form: `pnpm build
 * --force && pnpm check-types` (workspace root, in that order — turbo's
 * `check-types` cache key doesn't depend on `^build`, #287, so a plain
 * `pnpm check-types` can replay a stale pass against last build's `dist`)
 * passes for `hejbro` (cli) and both `examples/*` packages, which resolve
 * `@hejbro/core` through its published `exports["."].types` —
 * `./dist/index.d.ts` — not through source, so this is real downstream
 * `.d.ts` consumption, not just successful emission.
 */
export const columnMetaBrand: unique symbol = Symbol("hejbro:column-meta");

/**
 * Carries `TMeta`'s optional `true`-flags (`notNull`, `hasDefault`, …)
 * across `.array()`'s otherwise-fresh meta, without ever indexing an
 * optional key directly — `TMeta["notNull"]` reads as `boolean | undefined`
 * for a generic `TMeta` (indexed access always adds `undefined` for an
 * optional property), which fails `exactOptionalPropertyTypes` against
 * {@link ColumnMeta}'s `notNull?: boolean`. Each branch instead contributes
 * either the concrete literal (`{ notNull: true }`) or `unknown` (a no-op
 * intersection member), so the result never contains an explicit
 * `| undefined`. A later optional flag (numeric mode, jsonb `$type`) needs
 * its own branch added here.
 *
 * `generated` (add-generated-columns) gets a branch below for the same
 * reason every other flag does — `.array()`'s `columnState` spread already
 * carries `generated` through at runtime regardless, so the type must not
 * silently disagree. `identity` deliberately does NOT get one:
 * an identity array column can never survive `table()` (its `typeNode` is
 * `"array"`, never `"smallint"`/`"integer"`/`"bigint"`, so guard 1 —
 * `invalid-identity-column` — always rejects it), so carrying the flag
 * through `.array()` would only let a value that can never exist reach a
 * type position, for no reader benefit.
 */
type ArrayCarriedFlags<TMeta extends ColumnMeta> = (TMeta extends {
	readonly notNull: true;
}
	? { readonly notNull: true }
	: unknown) &
	(TMeta extends { readonly hasDefault: true }
		? { readonly hasDefault: true }
		: unknown) &
	(TMeta extends { readonly mode: infer TMode extends NumericMode }
		? { readonly mode: TMode }
		: unknown) &
	(TMeta extends { readonly jsonType: infer TJson }
		? { readonly jsonType: TJson }
		: unknown) &
	(TMeta extends { readonly generated: true }
		? { readonly generated: true }
		: unknown);

/**
 * An immutable, chainable column declaration. Every modifier returns a new
 * `ColumnBuilder` — the original is never mutated. `TFamily` carries the
 * column's coarse Postgres type family (D17) so `table()` can expose typed
 * `ColumnRef`s without a second declaration; `TMeta` carries finer
 * declaration-level metadata (D1) that a family can't express — see
 * {@link ColumnMeta}.
 */
export type ColumnBuilder<
	TFamily extends SqlTypeFamily = SqlTypeFamily,
	TMeta extends ColumnMeta = ColumnMeta,
> = {
	readonly columnState: ColumnState;
	/** type-only marker, never assigned — see {@link columnMetaBrand}. */
	readonly [columnMetaBrand]?: TMeta;
	notNull(): ColumnBuilder<TFamily, TMeta & { notNull: true }>;
	/**
	 * `TMeta`'s `notNull` now mirrors `materializeNotNull`
	 * (`kinds/table-kind.ts:97-105`, task 3.16) — Postgres always renders a
	 * primary-key column `NOT NULL`, so the *materialized* column is notNull
	 * even here. `columnState.notNull` itself is deliberately left
	 * untouched: it's the raw declaration, not the materialized column, and
	 * stays `false` unless `.notNull()` was also called — serialization
	 * still does the real `NOT NULL` rendering from `primaryKey`/`typeNode`,
	 * exactly as before. **This divergence between the two is intentional,
	 * not a bug** — "fixing" it by setting `columnState.notNull` here would
	 * change the snapshot/generated-SQL shape for every already-declared
	 * primary key (golden-breaking, C18) for a value nothing downstream
	 * needs, since `materializeNotNull` already computes the true rendered
	 * `NOT NULL` from `primaryKey`/`typeNode` independently of this flag.
	 */
	primaryKey(): ColumnBuilder<TFamily, TMeta & { notNull: true }>;
	unique(): ColumnBuilder<TFamily, TMeta>;
	/** a raw scalar (auto-lifted to a literal), or an expression built with operators/`sql` (D16) */
	default(
		value: LiftableFor<TFamily> | Expr<TFamily> | Expr<"unknown">,
	): ColumnBuilder<TFamily, TMeta & { hasDefault: true }>;
	/** uuid columns only — throws an actionable error otherwise */
	defaultRandom(): ColumnBuilder<TFamily, TMeta & { hasDefault: true }>;
	/** date/time-family columns only — throws an actionable error otherwise */
	defaultNow(): ColumnBuilder<TFamily, TMeta & { hasDefault: true }>;
	/** wraps the current type in an array — keeps everything else `.array()` was chained onto (notNull, hasDefault, …; see {@link ArrayCarriedFlags}) and records the element's own declared type name (`typeName` is *replaced*, not intersected: `"text" & "array"` would be `never`). */
	array(): ColumnBuilder<
		"array",
		ArrayCarriedFlags<TMeta> & { typeName: "array"; element: TMeta["typeName"] }
	>;
	/**
	 * Narrows this array column's element type from `T | null` to `T`
	 * (add-array-ergonomics) — backed by a CHECK constraint `table()`
	 * derives into the table's own checks list
	 * (`<column>_no_null_elements`,
	 * `array_position("<table>"."<column>", null) is null`), so
	 * the narrowing is never an unchecked assertion: the database enforces
	 * exactly what the type claims. Contrast `.$type<T>()`, which is
	 * explicitly barred from vouching for the null axis (see its own
	 * tsdoc) — this method exists specifically because that axis needs a
	 * different, constraint-backed mechanism.
	 *
	 * Type-restricted to an `.array()` column (`TFamily extends "array"`,
	 * else the return type is `never`) — kept as well because it's cheap,
	 * but not the sole defense (a generic `TFamily` at a call site isn't
	 * always narrowed to a concrete literal). The real, runtime-enforced
	 * contract lives one step later: this method itself never throws (a
	 * bare builder has no column name yet to name in an error), it just
	 * sets the flag unconditionally — `table()` is where a column first
	 * gets a name, so `table()` is where misuse throws
	 * `invalid-not-null-elements`, naming the offending column (design
	 * decision 3).
	 */
	notNullElements(): TFamily extends "array"
		? ColumnBuilder<TFamily, TMeta & { notNullElements: true }>
		: never;
	/**
	 * Declares this column a stored computed column (D100): `expression` is
	 * a `sql` fragment naming sibling columns by their SQL names (the RLS
	 * predicate precedent, {@link Expr}) — structured refs cannot exist
	 * inside the column map itself, and Postgres computes and stores the
	 * result on every write. Combining this with `.default()` or an
	 * identity method is rejected at `table()` (design decision 2), not
	 * here — this method itself never throws, mirroring
	 * {@link notNullElements}'s own "no name to blame yet" reasoning.
	 */
	generatedAlwaysAs(
		expression: Expr<TFamily> | Expr<"unknown">,
	): ColumnBuilder<TFamily, TMeta & { generated: true }>;
	/**
	 * Declares this column `generated always as identity` (D100) — the
	 * SQL-standard successor to `serial`. Valid only on the explicit
	 * enumeration `"smallint" | "integer" | "bigint"` — keyed on
	 * `TMeta["typeName"]`, never on `SqlTypeFamily`/`familyOfTypeNode`:
	 * `TFamily`'s own `"numeric"` also covers `real`/`double precision`/
	 * `numeric` AND the whole `serial` family, so a family-level guard
	 * would wrongly admit all of them. `serial`/`smallserial`/`bigserial`
	 * are excluded on purpose, not by omission: a serial column already
	 * carries a sequence-backed `nextval()` default (D66), so stacking an
	 * identity on top is the same identity-plus-default conflict
	 * `invalid-identity-default` (design decision 2, guard 4) rejects when
	 * it arrives via `.default()` instead — the enumeration is that same
	 * rule, expressed at the type level, and must not be "simplified" back
	 * into a family check.
	 *
	 * Type-restricted the same way as {@link notNullElements} (`never` when
	 * `TMeta["typeName"]` isn't one of the three — a generic `TMeta` at a
	 * call site isn't always narrowed to a concrete literal, so `table()`
	 * carries the real, runtime-enforced guard, `invalid-identity-column`,
	 * design decision 2, keyed on the identical enumeration). Implies
	 * `notNull`/`hasDefault` in `TMeta` (Postgres treats every identity
	 * column as `NOT NULL` regardless of kind); an ALWAYS identity is
	 * additionally write-excluded (design decision 5).
	 */
	generatedAlwaysAsIdentity(
		options?: IdentityOptions,
	): TMeta["typeName"] extends "smallint" | "integer" | "bigint"
		? ColumnBuilder<
				TFamily,
				TMeta & { identity: "always"; notNull: true; hasDefault: true }
			>
		: never;
	/**
	 * Declares this column `generated by default as identity` (D100) — like
	 * {@link generatedAlwaysAsIdentity} (see its own tsdoc for the integer
	 * enumeration and why `serial` is excluded on purpose), but the
	 * sequence only supplies a value when the insert omits one
	 * (`OVERRIDING SYSTEM VALUE` is a documented non-goal), so it stays
	 * writable and optional on the insert side (design decision 5) even
	 * though `TMeta` still carries the same implied `notNull`/`hasDefault`
	 * (Postgres's `NOT NULL` rule applies to both identity kinds alike).
	 */
	generatedByDefaultAsIdentity(
		options?: IdentityOptions,
	): TMeta["typeName"] extends "smallint" | "integer" | "bigint"
		? ColumnBuilder<
				TFamily,
				TMeta & { identity: "byDefault"; notNull: true; hasDefault: true }
			>
		: never;
	/**
	 * Declares this column a foreign key to another table's column
	 * (add-relational-reads, D102) — `.references(() => users.id)`. One
	 * declaration feeds both the DDL (`table()` folds it into the same
	 * `ForeignKeyDeclaration` the `extras` path builds) and the type layer
	 * (the edge lands in `TMeta`, where the query layer derives relations
	 * from it). The thunk defers evaluation for import-order safety. The
	 * target must share this column's type family — Postgres would reject
	 * a mismatch at apply time, so the declaration fails to type-check
	 * instead. Self-referencing and composite foreign keys stay on the
	 * `extras` path. The optional second argument (add-references-actions)
	 * carries `onDelete`/`onUpdate` — it does not affect `TMeta`, so the
	 * type layer's edge is the same with or without it.
	 */
	references<
		TTargetColumns extends Record<string, ColumnBuilder>,
		TTargetKey extends keyof TTargetColumns & string,
	>(
		target: () => ColumnRef<TFamily> & OriginBrand<TTargetColumns, TTargetKey>,
		actions?: {
			readonly onDelete?: ForeignKeyAction;
			readonly onUpdate?: ForeignKeyAction;
		},
	): ColumnBuilder<
		TFamily,
		TMeta & { references: { columns: TTargetColumns; key: TTargetKey } }
	>;
	/**
	 * Brands this column's TypeScript type as `T` (D5) — the way a `jsonb`
	 * column opts out of `unknown` (`@hejbro/query`'s `column-map.ts`
	 * reads `TMeta["jsonType"]` instead of falling back to the base
	 * mapping). **Narrowing only, never a lie**: `T extends
	 * BaseTsType<TMeta>` — `T` must be a subset of the column's own base
	 * TypeScript type (`ts-type-map.ts`, brand-agnostic by construction),
	 * our safety difference from Drizzle's unconstrained `$type<T>()`.
	 * `json`/`jsonb`'s base is `unknown`, which every type is a subset
	 * of, so they stay unconstrained in practice without a special case
	 * here — the single rule closes over every declared type name, not
	 * just the two that motivated it. (`T = never` also satisfies the
	 * constraint — every type is a supertype of `never` — but a
	 * `never`-branded column is simply unusable, not unsafe, so this
	 * corner is left open rather than special-cased away.)
	 *
	 * A **runtime identity method, not a purely type-level one**: a
	 * type-only `$type` wouldn't be callable at all (there'd be no
	 * function for `.{$type<T>()}` to resolve to), so this returns a new
	 * builder wrapping the *exact same* `columnState` — proven harmless
	 * (task 3.5): byte-identical snapshot/SQL and no brand trace anywhere
	 * runtime-visible, since only `TMeta` changes.
	 */
	$type<T extends BaseTsType<TMeta>>(): ColumnBuilder<
		TFamily,
		TMeta & { jsonType: T }
	>;
};

/** Extracts the {@link SqlTypeFamily} a {@link ColumnBuilder} carries. */
export type BuilderFamily<TBuilder> =
	TBuilder extends ColumnBuilder<infer TFamily> ? TFamily : never;

/**
 * The TypeScript type a declared column reads back as, once its
 * `.$type<T>()` brand (if any) narrows {@link BaseTsType} (D1/D3/D5) — the
 * single source both `@hejbro/query`'s `ColumnTsType` (select-result reads)
 * and this package's own `MutationValue` (write-acceptance, harden-query-layer
 * #322 Settled Decision 1) narrow through, so the brand's array-carrying
 * rule (task 3.15's {@link ArrayCarriedFlags}) is expressed exactly once —
 * `@hejbro/query`'s `column-map.ts` re-exports this type rather than
 * repeating the same two conditional branches, so the two packages can
 * never quietly drift apart on what a branded column reads back as.
 *
 * **Array + brand ordering.** `.array()` carries the *element's* `jsonType`
 * brand up onto the array's own `TMeta` (so `jsonb().$type<Payload>().array()`'s
 * `TMeta` is `{typeName: "array", jsonType: Payload, ...}`) — a plain
 * "brand wins" check would then return the bare brand (`Payload`) instead
 * of `ReadonlyArray<Payload>`, since it never notices the array wrapping.
 * The array-shaped branch below is checked first and re-applies
 * `ReadonlyArray<>` around the carried brand — with `| null` on the
 * element (#349), except under `.notNullElements()`
 * (add-array-ergonomics), which drops it exactly like `BaseTsType`'s own
 * array branch does: the brand narrows the ELEMENT, but element nullability
 * is the array wrap's own axis (Postgres arrays are element-nullable,
 * always) and the `$type` constraint is checked against the *element's*
 * base before `.array()` ever wraps it, so letting the brand strip the
 * `null` here would be exactly the unchecked lie the "narrowing only"
 * guarantee exists to prevent — `notNullElements` is the one axis allowed
 * to strip it, because it is constraint-backed, not a bare assertion. A
 * non-array `TMeta` (or an array with no carried brand, left to
 * `BaseTsType`'s own array handling) falls through unchanged.
 */
export type ColumnReadType<TBuilder extends ColumnBuilder> =
	TBuilder extends ColumnBuilder<infer _TFamily, infer TMeta>
		? TMeta extends {
				readonly typeName: "array";
				readonly jsonType: infer TBrand;
			}
			? TMeta extends { readonly notNullElements: true }
				? ReadonlyArray<TBrand>
				: ReadonlyArray<TBrand | null>
			: TMeta extends { readonly jsonType: infer TBrand }
				? TBrand
				: BaseTsType<TMeta>
		: never;

const timeLikeTypeNames = [
	"date",
	"time",
	"timetz",
	"timestamp",
	"timestamptz",
] as const;

const isTimeLikeTypeNode = (typeNode: TypeNode): boolean =>
	timeLikeTypeNames.some((name) => name === typeNode.typeName);

/** Resolves a `.default(value)` argument to the {@link ExprNode} stored on `columnState` — an existing expression's node, or a freshly-lifted literal for a raw scalar. */
const resolveDefaultExprNode = (
	value: unknown,
	typeNode: TypeNode,
): ExprNode => {
	if (isExpr(value)) {
		return value.exprNode;
	}
	return liftLiteral(value, familyOfTypeNode(typeNode));
};

/**
 * Phantom origin brand `TableColumns` stamps on every built table's column
 * refs (add-relational-reads) — the owning column map and column key at
 * the type level only. Optional and never assigned at runtime (the
 * `columnMetaBrand` precedent, same reasons); `.references()` infers its
 * target edge from it, which is also why a hand-built bare `columnRef()`
 * carries no useful edge there.
 */
export const columnOriginBrand: unique symbol = Symbol("hejbro:column-origin");

/** The brand's shape — see {@link columnOriginBrand}. */
export type OriginBrand<
	TColumns extends Record<string, ColumnBuilder>,
	TKey extends keyof TColumns,
> = {
	readonly [columnOriginBrand]?: {
		readonly columns: TColumns;
		readonly key: TKey;
	};
};

/**
 * Builds a {@link ColumnBuilder} bound to `columnState`. Every chained
 * method calls this factory again with a shallow-updated state, so builders
 * are effectively immutable value objects.
 */
export const createColumnBuilder = <
	TFamily extends SqlTypeFamily = SqlTypeFamily,
	TMeta extends ColumnMeta = ColumnMeta,
>(
	columnState: ColumnState,
): ColumnBuilder<TFamily, TMeta> => ({
	columnState,
	notNull: () =>
		createColumnBuilder<TFamily, TMeta & { notNull: true }>({
			...columnState,
			notNull: true,
		}),
	primaryKey: () =>
		createColumnBuilder<TFamily, TMeta & { notNull: true }>({
			...columnState,
			primaryKey: true,
		}),
	unique: () =>
		createColumnBuilder<TFamily, TMeta>({ ...columnState, unique: true }),
	references: (target, actions) =>
		createColumnBuilder({
			...columnState,
			references: target,
			referenceActions: actions ?? null,
		}),
	default: (value) =>
		createColumnBuilder<TFamily, TMeta & { hasDefault: true }>({
			...columnState,
			defaultValue: resolveDefaultExprNode(value, columnState.typeNode),
		}),
	defaultRandom: () => {
		if (columnState.typeNode.typeName !== "uuid") {
			return throwHejbroError(
				"invalid-column-default",
				`defaultRandom() only applies to uuid columns, but this column is "${columnState.typeNode.typeName}". Next: use .default(...) or drop defaultRandom() here.`,
			);
		}
		return createColumnBuilder<TFamily, TMeta & { hasDefault: true }>({
			...columnState,
			defaultValue: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "gen_random_uuid",
				args: [],
			},
		});
	},
	defaultNow: () => {
		if (!isTimeLikeTypeNode(columnState.typeNode)) {
			return throwHejbroError(
				"invalid-column-default",
				`defaultNow() only applies to date/time columns, but this column is "${columnState.typeNode.typeName}". Next: use .default(...) instead.`,
			);
		}
		return createColumnBuilder<TFamily, TMeta & { hasDefault: true }>({
			...columnState,
			defaultValue: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "now",
				args: [],
			},
		});
	},
	array: () =>
		createColumnBuilder<
			"array",
			ArrayCarriedFlags<TMeta> & {
				typeName: "array";
				element: TMeta["typeName"];
			}
		>({
			...columnState,
			typeNode: { typeName: "array", element: columnState.typeNode },
		}),
	$type: <T extends BaseTsType<TMeta>>() =>
		createColumnBuilder<TFamily, TMeta & { jsonType: T }>(columnState),
	notNullElements: (() =>
		createColumnBuilder<TFamily, TMeta & { notNullElements: true }>({
			...columnState,
			notNullElements: true,
		})) as () => TFamily extends "array"
		? ColumnBuilder<TFamily, TMeta & { notNullElements: true }>
		: never,
	generatedAlwaysAs: (expression) =>
		createColumnBuilder<TFamily, TMeta & { generated: true }>({
			...columnState,
			generated: expression.exprNode,
		}),
	generatedAlwaysAsIdentity: ((options: IdentityOptions = {}) =>
		createColumnBuilder<
			TFamily,
			TMeta & { identity: "always"; notNull: true; hasDefault: true }
		>({
			...columnState,
			identity: { kind: "always", options },
		})) as (
		options?: IdentityOptions,
	) => TMeta["typeName"] extends "smallint" | "integer" | "bigint"
		? ColumnBuilder<
				TFamily,
				TMeta & { identity: "always"; notNull: true; hasDefault: true }
			>
		: never,
	generatedByDefaultAsIdentity: ((options: IdentityOptions = {}) =>
		createColumnBuilder<
			TFamily,
			TMeta & { identity: "byDefault"; notNull: true; hasDefault: true }
		>({
			...columnState,
			identity: { kind: "byDefault", options },
		})) as (
		options?: IdentityOptions,
	) => TMeta["typeName"] extends "smallint" | "integer" | "bigint"
		? ColumnBuilder<
				TFamily,
				TMeta & { identity: "byDefault"; notNull: true; hasDefault: true }
			>
		: never,
});

import { throwHejbroError } from "../error";
import type { Expr, ExprNode } from "../expr/ast";
import { isExpr } from "../expr/ast";
import { liftLiteral } from "../expr/literal";
import type { LiftableFor, SqlTypeFamily } from "../expr/type-family";
import { familyOfTypeNode } from "../expr/type-family";
import type { TypeNode } from "./type-node";

/** The immutable state carried by a {@link ColumnBuilder}. */
export type ColumnState = {
	readonly typeNode: TypeNode;
	readonly notNull: boolean;
	readonly primaryKey: boolean;
	readonly unique: boolean;
	readonly defaultValue: ExprNode | null;
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
 */
type ArrayCarriedFlags<TMeta extends ColumnMeta> = (TMeta extends {
	readonly notNull: true;
}
	? { readonly notNull: true }
	: unknown) &
	(TMeta extends { readonly hasDefault: true }
		? { readonly hasDefault: true }
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
};

/** Extracts the {@link SqlTypeFamily} a {@link ColumnBuilder} carries. */
export type BuilderFamily<TBuilder> =
	TBuilder extends ColumnBuilder<infer TFamily> ? TFamily : never;

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
});

/**
 * The five builder aggregates' own Postgres function names -- the exact
 * literal each one passes to `aggregate` (`expr/aggregate.ts`). D57:
 * these are Postgres's own names, verbatim, not hejbro-authored tokens.
 * Split out from the eleven window-only names (#501/R2 Q1) because
 * `filter()` (`expr/aggregate.ts`) must accept exactly this set --
 * accepting the full builder key set would admit `rowNumber()`, which
 * this change's delta refuses.
 */
export type AggregateFunctionName = "count" | "min" | "max" | "sum" | "avg";

/**
 * The eleven window-only constructors' own Postgres function names --
 * the exact literal each one passes to `functionCallNode`
 * (`expr/window.ts`). D57, same reasoning as {@link AggregateFunctionName}.
 */
export type WindowOnlyFunctionName =
	| "row_number"
	| "rank"
	| "dense_rank"
	| "lag"
	| "lead"
	| "first_value"
	| "last_value"
	| "nth_value"
	| "percent_rank"
	| "cume_dist"
	| "ntile";

/**
 * Every builder aggregate/window-function constructor's own name -- the
 * union {@link AggregateFunctionName} and {@link WindowOnlyFunctionName}
 * close over. A constructor's name added to either half without a
 * matching row in {@link BUILDER_READ_SHAPES} fails `tsc` at that
 * table's own declaration (#452 Q1) -- the type-level half of the
 * vocabulary's closure; `test/expr/read-shape.test.ts`'s closure test
 * covers the string-level half a type can't see (a name that drifts from
 * its row).
 */
export type BuilderFunctionName =
	| AggregateFunctionName
	| WindowOnlyFunctionName;

/**
 * How a builder function's result reads back through the JSON-transported
 * nested-read path (D102, #452): `"int8"` is cast to text and revived as
 * `bigint`, whatever its argument (or lack of one) was; `"argument"` is
 * cast and revived exactly as its first argument would be, standalone or
 * windowed; `"own"` is neither -- Postgres promotes `sum`/`avg` by the
 * argument's own exact type (a fixed conversion would be a lie), and the
 * remaining three (`percent_rank`/`cume_dist`/`ntile`) return
 * `double precision`/`integer`, which JSON already carries losslessly.
 */
export type ReadShape = "int8" | "argument" | "own";

/**
 * The five builder aggregates' own read shape (#501/R2 Q1) -- the set
 * `filter()` (`expr/aggregate.ts`) decides its accepted target from
 * directly, rather than from {@link BUILDER_READ_SHAPES}'s full key set,
 * which also holds the eleven window-only names and would wrongly admit
 * `rowNumber()`.
 */
export const AGGREGATE_READ_SHAPES: Readonly<
	Record<AggregateFunctionName, ReadShape>
> = {
	count: "int8",
	min: "argument",
	max: "argument",
	sum: "own",
	avg: "own",
};

/** The eleven window-only constructors' own read shape (#501/R2 Q1). */
export const WINDOW_ONLY_READ_SHAPES: Readonly<
	Record<WindowOnlyFunctionName, ReadShape>
> = {
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	row_number: "int8",
	rank: "int8",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	dense_rank: "int8",
	lag: "argument",
	lead: "argument",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	first_value: "argument",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	last_value: "argument",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	nth_value: "argument",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	percent_rank: "own",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	cume_dist: "own",
	ntile: "own",
};

/**
 * The single vocabulary both the cast side (`query/select.ts`'s
 * `atRiskCastSuffix`) and the revive side (`@hejbro/query`'s
 * `db/convert.ts`'s `aggregateColumnState`) read (#452) -- the two
 * cannot share a function (core is pure, the revive side works over
 * declared tables), but they can share this data. A windowed cell (an
 * `over(...)` wrapper, D104) reads as its own inner call on both sides;
 * neither side special-cases windowing separately from this table. The
 * union of {@link AGGREGATE_READ_SHAPES} and {@link WINDOW_ONLY_READ_SHAPES}
 * (#501/R2 Q1), pinned by its own `Record<BuilderFunctionName, ReadShape>`
 * annotation to cover the full builder vocabulary exactly, same as
 * before the split (#452 Q1's closure precedent). Exported the same way
 * `SELECT_CLAUSE_TRAVERSALS` is -- a public export whose tsdoc names it
 * as the query layer's own contract, not documented in the skill as user
 * surface.
 */
export const BUILDER_READ_SHAPES: Readonly<
	Record<BuilderFunctionName, ReadShape>
> = {
	...AGGREGATE_READ_SHAPES,
	...WINDOW_ONLY_READ_SHAPES,
};

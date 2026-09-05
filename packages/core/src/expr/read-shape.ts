/**
 * The builder's own Postgres function names for every aggregate and
 * window-function constructor (`expr/aggregate.ts`, `expr/window.ts`) --
 * the exact literal each one passes to `functionCallNode`/`aggregate`.
 * D57: these are Postgres's own names, verbatim, not hejbro-authored
 * tokens. A constructor's name added here without a matching row in
 * {@link BUILDER_READ_SHAPES} fails `tsc` at that table's own
 * declaration (#452 Q1) -- the type-level half of the vocabulary's
 * closure; `test/expr/read-shape.test.ts`'s closure test covers the
 * string-level half a type can't see (a name that drifts from its row).
 */
export type BuilderFunctionName =
	| "count"
	| "row_number"
	| "rank"
	| "dense_rank"
	| "min"
	| "max"
	| "lag"
	| "lead"
	| "first_value"
	| "last_value"
	| "nth_value"
	| "sum"
	| "avg"
	| "percent_rank"
	| "cume_dist"
	| "ntile";

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
 * The single vocabulary both the cast side (`query/select.ts`'s
 * `atRiskCastSuffix`) and the revive side (`@hejbro/query`'s
 * `db/convert.ts`'s `aggregateColumnState`) read (#452) -- the two
 * cannot share a function (core is pure, the revive side works over
 * declared tables), but they can share this data. A windowed cell (an
 * `over(...)` wrapper, D104) reads as its own inner call on both sides;
 * neither side special-cases windowing separately from this table.
 * Exported the same way `SELECT_CLAUSE_TRAVERSALS` is (#452 Q1) -- a
 * public export whose tsdoc names it as the query layer's own contract,
 * not documented in the skill as user surface.
 */
export const BUILDER_READ_SHAPES: Readonly<
	Record<BuilderFunctionName, ReadShape>
> = {
	count: "int8",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	row_number: "int8",
	rank: "int8",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	dense_rank: "int8",
	min: "argument",
	max: "argument",
	lag: "argument",
	lead: "argument",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	first_value: "argument",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	last_value: "argument",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	nth_value: "argument",
	sum: "own",
	avg: "own",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	percent_rank: "own",
	// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57), not a hejbro-authored token.
	cume_dist: "own",
	ntile: "own",
};

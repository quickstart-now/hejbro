import type { ColumnBuilder, ColumnReadType } from "@hejbro/core";

/**
 * The TypeScript type a declared column reads back as (D1/D3/D5) — a thin
 * re-export of core's own {@link ColumnReadType} (`types/column-builder.ts`,
 * D94: core owns the declaration DSL's type surface). Core's own
 * `MutationValue` (write-acceptance, harden-query-layer #322 Settled
 * Decision 1) narrows through the exact same type, so the brand/array-
 * carrying logic (task 3.15's `ArrayCarriedFlags`) is expressed exactly
 * once, not duplicated per package to quietly drift apart. This alias
 * exists only so existing `ColumnTsType` call sites in this package keep
 * compiling under their established name — mirrors this same file's own
 * precedent for `IntervalValue` (moved to core, re-exported here
 * unchanged).
 */
export type ColumnTsType<TBuilder extends ColumnBuilder> =
	ColumnReadType<TBuilder>;

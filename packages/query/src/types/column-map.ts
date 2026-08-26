import type { BaseTsType, ColumnBuilder } from "@hejbro/core";

/**
 * The TypeScript type a declared column reads back as (D1/D3/D5) — a
 * **thin layer** over core's `BaseTsType` (`ts-type-map.ts`, D94: core
 * owns the declaration DSL's type surface, this package owns runtime
 * conversion). A `.$type<T>()` brand wins when present (`TMeta["jsonType"]`,
 * narrowing-only per `column-builder.ts`'s own `T extends BaseTsType<TMeta>`
 * constraint — this file trusts that constraint rather than re-checking
 * it), otherwise the base mapping applies unchanged. `TMeta` is extracted
 * from the already-public `ColumnBuilder` structurally (mirrors
 * `dsl/table.ts`'s own `Table<infer TColumns>` extraction, task 3.3) —
 * `infer` here inherits `ColumnBuilder`'s own declared `TMeta extends
 * ColumnMeta` bound, so `BaseTsType<TMeta>` type-checks without this file
 * ever needing to name core's internal, unexported `ColumnMeta`.
 *
 * **Array + brand ordering (task 3.15's `ArrayCarriedFlags`).** `.array()`
 * carries the *element's* `jsonType` brand up onto the array's own `TMeta`
 * (so `jsonb().$type<Payload>().array()`'s `TMeta` is
 * `{typeName: "array", jsonType: Payload, ...}`) — a plain "brand wins"
 * check would then return the bare brand (`Payload`) instead of
 * `ReadonlyArray<Payload>`, since it never notices the array wrapping.
 * The array-shaped branch below is checked first and re-applies
 * `ReadonlyArray<>` around the carried brand; a non-array `TMeta` (or an
 * array with no carried brand, left to `BaseTsType`'s own array handling)
 * falls through unchanged.
 */
export type ColumnTsType<TBuilder extends ColumnBuilder> =
	TBuilder extends ColumnBuilder<infer _TFamily, infer TMeta>
		? TMeta extends {
				readonly typeName: "array";
				readonly jsonType: infer TBrand;
			}
			? ReadonlyArray<TBrand>
			: TMeta extends { readonly jsonType: infer TBrand }
				? TBrand
				: BaseTsType<TMeta>
		: never;

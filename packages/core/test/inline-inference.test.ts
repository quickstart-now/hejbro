import { describe, expectTypeOf, it } from "vitest";
import type { ColumnBuilder, Table } from "../src/index";
import { bigint, numeric, schema, table } from "../src/index";
import type { BaseTsType } from "../src/types/ts-type-map";

/**
 * #338: an inline, bare `bigint()`/`numeric()` call used directly as a
 * `table()` column value collapses its own resolved mode to the full
 * `NumericMode` union (`"bigint" | "number" | "string"`), instead of
 * keeping its own declared default (`typeof DEFAULT_BIGINT_MODE`/`typeof
 * DEFAULT_NUMERIC_MODE`). Root cause (characterization, confirmed by
 * mutation): `table`'s own `TColumns extends Record<string, ColumnBuilder>`
 * constraint gives the inline call's *return position* a contextual type,
 * and `TMode` gets inferred from that context (`ColumnMeta["mode"]`, the
 * full `NumericMode`) instead of from the factory's own declared default.
 * The presence of a config argument alone does **not** protect against
 * this (`bigint({})` collapses exactly like bare `bigint()`) -- only
 * naming an explicit `mode` key, binding to a `const` first, or chaining
 * *any* further method (even one with no type parameters of its own, like
 * `.notNull()`) removes the return position from context and keeps the
 * correct, narrow default.
 *
 * Every `it` below states whether it is expected red or green **before**
 * this task's fix lands, so a reviewer can tell "fixed by this task" from
 * "was already correct, must never regress" at a glance.
 */

const app = schema("app");

/** Extracts a {@link Table}'s own `TColumns` type parameter. */
type ColumnsOf<T> = T extends Table<infer TColumns> ? TColumns : never;
/** Extracts a {@link ColumnBuilder}'s own `TMeta` type parameter. */
type MetaOf<TColumn> =
	TColumn extends ColumnBuilder<infer _TFamily, infer TMeta> ? TMeta : never;
/**
 * The resolved base read type for column `K` on table `T` -- structurally
 * what `@hejbro/query`'s `SelectResult`/`ColumnTsType` ultimately read too
 * (both bottom out in `BaseTsType<TMeta>` absent a `$type` brand); computed
 * here without importing `@hejbro/query` at all, since core has zero
 * dependency on it (purity).
 */
type ResolvedReadType<T, K extends string> = BaseTsType<
	MetaOf<ColumnsOf<T>[K]>
>;

describe("bigint()/numeric() keep their own default mode when used inline in table() (#338)", () => {
	describe("bigint", () => {
		it("inline, bare -- RED until fixed: collapses to the full NumericMode union today", () => {
			const t = table(app, "t_bigint_inline_bare", { c: bigint() });
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<bigint>();
		});

		it("inline, empty-object config bigint({}) -- RED until fixed: config presence alone doesn't protect against the collapse", () => {
			const t = table(app, "t_bigint_inline_empty", { c: bigint({}) });
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<bigint>();
		});

		it("const-first -- GREEN today, must stay green (no regression)", () => {
			const c = bigint();
			const t = table(app, "t_bigint_const_first", { c });
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<bigint>();
		});

		it("inline, explicit mode -- GREEN today, must stay green (no regression)", () => {
			const t = table(app, "t_bigint_inline_explicit", {
				c: bigint({ mode: "bigint" }),
			});
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<bigint>();
		});

		it("inline, chained .notNull() -- GREEN today, must stay green (hg2's own workaround shape -- breaking this breaks their branch on rebase)", () => {
			const t = table(app, "t_bigint_inline_notnull", {
				c: bigint().notNull(),
			});
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<bigint>();
		});

		it("inline, chained .array() -- GREEN today, must stay green (no regression)", () => {
			const t = table(app, "t_bigint_inline_array", { c: bigint().array() });
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<
				ReadonlyArray<bigint | null>
			>();
		});

		it("inline, chained .primaryKey() -- GREEN today, must stay green (second chain control, alongside .notNull())", () => {
			const t = table(app, "t_bigint_inline_primarykey", {
				c: bigint().primaryKey(),
			});
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<bigint>();
		});
	});

	describe("numeric", () => {
		it("inline, bare -- RED until fixed: collapses to the full NumericMode union today", () => {
			const t = table(app, "t_numeric_inline_bare", { c: numeric() });
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<string>();
		});

		it("inline, empty-object config numeric({}) -- RED until fixed: config presence alone doesn't protect against the collapse", () => {
			const t = table(app, "t_numeric_inline_empty", { c: numeric({}) });
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<string>();
		});

		it("const-first -- GREEN today, must stay green (no regression)", () => {
			const c = numeric();
			const t = table(app, "t_numeric_const_first", { c });
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<string>();
		});

		it("inline, explicit mode -- GREEN today, must stay green (no regression)", () => {
			const t = table(app, "t_numeric_inline_explicit", {
				c: numeric({ mode: "string" }),
			});
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<string>();
		});

		it("inline, chained .notNull() -- GREEN today, must stay green (no regression)", () => {
			const t = table(app, "t_numeric_inline_notnull", {
				c: numeric().notNull(),
			});
			expectTypeOf<ResolvedReadType<typeof t, "c">>().toEqualTypeOf<string>();
		});
	});
});

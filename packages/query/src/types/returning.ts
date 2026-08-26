import type { ReturningProjection, Table } from "@hejbro/core";
import type { SelectResult } from "./select-result";

/**
 * The row shape a `returning()` clause produces (D1/D3, task 3.13) —
 * reuses {@link SelectResult} (task 3.10) directly rather than
 * re-deriving the same mapping: core's `ReturningProjection` (`query/
 * mutate.ts`) is `Record<string, Expr>`, the identical shape as
 * `select()`'s own object-projection branch of `SelectProjection`, so
 * a `returning({a: expr})` row is exactly `SelectResult<{a: expr}>`.
 * `returning()` called with **no projection** returns every declared
 * column (core's `InsertReturnable`/`UpdateReturnable`/
 * `DeleteReturnable.returning(projection?)`, spec §5.2) — that's
 * `SelectResult<TTable>`, the whole-table branch, with full per-column
 * richness (nullability/mode/element/`$type` brand), not a widened or
 * `unknown` fallback.
 *
 * This is a structural reuse, not just a type that happens to compute
 * the same answer: `ReturningRow` never repeats `SelectResult`'s own
 * `notNull`-widening or family-mapping logic, so a change to that
 * logic in `select-result.ts` reaches every `returning()` call site
 * automatically — proven by mutation-check (breaking `SelectResult`
 * breaks `returning.test.ts` too, not just `select-result.test.ts`).
 * A pure type utility over `Table`, not yet wired into `insert()`/
 * `update()`/`delete()`'s actual `returning()` return type (group 4's
 * job, same deferral as {@link SelectResult}/`InsertInput`/
 * `UpdateInput`).
 */
export type ReturningRow<
	TTable extends Table,
	TProjection extends ReturningProjection | undefined = undefined,
> = TProjection extends ReturningProjection
	? SelectResult<TProjection>
	: SelectResult<TTable>;

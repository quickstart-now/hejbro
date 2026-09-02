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
 * `unknown` fallback. A `TProjection` of `never` — what core's
 * pre-returning stages carry when `returning()` was never called (#622)
 * — resolves
 * to `never` by distribution over the naked type parameter below, so a
 * mutation that requested nothing types its (always empty) result as
 * `ReadonlyArray<never>` rather than as the table's rows. That is not a
 * special case written here; it is what the conditional already does
 * with `never`, pinned by `execute-result-type.test.ts`.
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
 *
 * The object-projection branch fixes `TLeftJoined` at `never`, not the
 * one-argument (untracked) form (narrow-join-nullability, task 3.5) — a
 * mutation's own set is never "unknown", it is DEFINITIVELY EMPTY:
 * `InsertNode`/`UpdateNode`/`DeleteNode` (`expr/ast.ts`) carry no field a
 * join could occupy, `query/mutate.ts` exposes no `.leftJoin`/`.innerJoin`
 * builder method on any insert/update/delete stage, the chain's own
 * `leftJoin` (`db/chain.ts`) exists only on the SELECT stage family, and
 * the renderer (`expr/render-sql.ts`) never emits `USING` or `UPDATE …
 * FROM` for these statement kinds. This is a premise about today's AST
 * shape, not an assumption about the DSL surface — a method could be
 * added carelessly, but a join clause cannot be rendered from a node with
 * no field to hold one. If mutation join grammar is ever added, this
 * `never` must be revisited alongside it.
 */
export type ReturningRow<
	TTable extends Table,
	TProjection extends ReturningProjection | undefined = undefined,
> = TProjection extends ReturningProjection
	? SelectResult<TProjection, never>
	: SelectResult<TTable>;

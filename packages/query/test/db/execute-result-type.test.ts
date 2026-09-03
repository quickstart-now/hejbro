import type {
	DeleteFinal,
	DeleteReturnable,
	InsertConflictable,
	InsertFinal,
	IntervalValue,
	QueryNode,
	SelectLimited,
	UpdateFinal,
	UpdateReturnable,
} from "@hejbro/core";
// biome-ignore lint/style/useImportType: jsonArrayFrom is used only in a type position below via `typeof jsonArrayFrom<T>` (a real instantiation expression), which requires an actual value import -- `import type` has no runtime binding to reference.
import {
	bigint,
	interval,
	jsonArrayFrom,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { CompileInput } from "../../src/compile/compile";
import type { ScopedDb } from "../../src/db/context";
import type { Db } from "../../src/db/db";
import type { SelectResult } from "../../src/types/select-result";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	duration: interval(),
});

type Posts = typeof posts;

const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	body: text().notNull(),
});

type Comments = typeof comments;

/**
 * A type-only handle on `Db["execute"]`'s own generic signature -- never
 * assigned, never called at runtime (only ever used inside `typeof
 * dbExecute<...>`, itself only ever used in a type position below, so
 * this `declare const` is fully erased and touches nothing at runtime).
 */
declare const dbExecute: Db["execute"];

/**
 * Instantiates `Db["execute"]`'s own generic signature against a specific
 * `TStatement` (a real TS 4.7+ instantiation expression, not a
 * conditional-type approximation of one) and extracts the resolved row
 * type -- tests the real member end to end, not a parallel utility that
 * could drift from it.
 */
type ExecuteRows<TStatement extends CompileInput> = Awaited<
	ReturnType<typeof dbExecute<TStatement>>
>;

describe("Db.execute's resolved row type (task 4.11)", () => {
	it("a whole-table select resolves the declared column types exactly (bigint mode, IntervalValue, notNull) -- exact match, not loose", () => {
		type Stage = SelectLimited<Posts>;

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
		// spelled out concretely too, so a future SelectResult regression
		// can't hide behind this file only re-testing via SelectResult itself.
		expectTypeOf<ExecuteRows<Stage>[number]>().toEqualTypeOf<{
			readonly id: string;
			readonly status: string;
			readonly amount: bigint | null;
			readonly duration: IntervalValue | null;
		}>();
	});

	it("an object projection resolves exactly those keys -- no more, no less", () => {
		type Stage = SelectLimited<{ readonly total: Posts["amount"] }>;
		type Row = ExecuteRows<Stage>[number];

		// #311: a projected declared column keeps its declared type (mode
		// 'bigint' here), not the family-wide union. Nullability still
		// widens here -- #307 is landed (narrow-join-nullability), but only
		// when ExecuteResult can see the set: this `Stage` uses the bare,
		// one-argument `SelectLimited`/`InsertFinal` form, so `TLeftJoined`
		// defaults to untracked and stays widened on purpose (the same
		// fail-safe default `SelectResult`'s own task 2.4 pins).
		expectTypeOf<Row>().toEqualTypeOf<{
			readonly total: bigint | null;
		}>();
		// @ts-expect-error "status" was never projected -- not a key of Row.
		type _Rejected = Row["status"];
	});

	it("a bare (already-unwrapped) QueryNode keeps the plain DriverRow shape -- select's richness only exists at the builder-stage level, doesn't leak past compile()", () => {
		expectTypeOf<ExecuteRows<QueryNode>>().toEqualTypeOf<
			ReadonlyArray<Readonly<Record<string, unknown>>>
		>();
	});
});

describe("db.execute infers the left-joined set from the core stage (narrow-join-nullability, task 3.3)", () => {
	it("no leftJoin at all (never): a notNull projected column narrows to non-null", () => {
		type Stage = SelectLimited<{ readonly t: Posts["status"] }, never>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("the projected column's own table is left-joined: the field stays nullable", () => {
		type Stage = SelectLimited<{ readonly t: Posts["status"] }, Posts>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["t"]>().toEqualTypeOf<string | null>();
	});
});

describe("the untracked boundary holds at a nested read's own subselect (narrow-join-nullability, task 3.4)", () => {
	it("the SAME object-projection field (`{ b: Comments['body'] }`) narrows to non-null at top level, but stays nullable once nested -- the top-level half of the contrast below", () => {
		// Same outer set (never) and same projected field as the nested
		// case right below -- the only difference is "nested or not", so
		// this pins the top-level half of the THEN that test's own comment
		// describes, for the identical projection.
		type Stage = SelectLimited<{ readonly b: Comments["body"] }, never>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["b"]>().toEqualTypeOf<string>();
	});

	it("a nested jsonArrayFrom's own object-projection field stays nullable even though the OUTER statement's left-joined set is the fully-tracked empty set (never) -- if the outer set leaked in, this would WRONGLY narrow", () => {
		// NestedOrExprResult (select-result.ts) recurses into SelectResult<TSub>
		// with no second argument at all -- structurally incapable of
		// consulting the outer TLeftJoined, not merely defaulted to it.
		// `never` (nothing left-joined at the outer level) is deliberate: a
		// leak here would read as "tracked, comments is not a member" and
		// WRONGLY narrow `b` to `string` -- the outer set must never reach
		// this position at all, tracked-empty or not.
		type NestedProjection = { readonly b: Comments["body"] };
		type Stage = SelectLimited<
			{
				readonly nested: ReturnType<typeof jsonArrayFrom<NestedProjection>>;
			},
			never
		>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["nested"][number]["b"]>().toEqualTypeOf<string | null>();
	});
});

describe("Db.execute's resolved row type for mutations (task 4.11-mutation)", () => {
	it("insert().returning() (no projection) resolves the whole declared table's shape", () => {
		type Stage = InsertFinal<Posts>;

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	// #622: the stage a chain sits at before returning() is called (what
	// insert().values() actually returns) is the `never` instantiation --
	// the statement carries no RETURNING clause, so the resolved type is
	// the empty array's own, not the table's rows. The bare InsertFinal<T>
	// above keeps meaning every column, exactly as before.
	it("an insert that never called returning() resolves ReadonlyArray<never>", () => {
		type Stage = InsertConflictable<Posts>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<ReadonlyArray<never>>();
		expectTypeOf<Row>().toBeNever();
		// @ts-expect-error nothing is assignable to the element type -- there are no rows.
		const _row: Row = { status: "draft" };
	});

	it("insert().returning({...}) (object projection) resolves exactly those keys -- a different instantiation from the whole-table case, not the same erased shape", () => {
		type Stage = InsertFinal<Posts, { readonly total: Posts["amount"] }>;
		type Row = ExecuteRows<Stage>[number];

		// #311: a projected declared column keeps its declared type (mode
		// 'bigint' here), not the family-wide union. Nullability still
		// widens here -- #307 is landed (narrow-join-nullability), but only
		// when ExecuteResult can see the set: this `Stage` uses the bare,
		// one-argument `SelectLimited`/`InsertFinal` form, so `TLeftJoined`
		// defaults to untracked and stays widened on purpose (the same
		// fail-safe default `SelectResult`'s own task 2.4 pins).
		expectTypeOf<Row>().toEqualTypeOf<{
			readonly total: bigint | null;
		}>();
		// @ts-expect-error "status" was never projected -- not a key of Row.
		type _Rejected = Row["status"];
	});

	it("update()/deleteFrom() resolve through the exact same ReturningRow mechanism -- one shared path, not three independently-typed copies", () => {
		type UpdateStage = UpdateFinal<Posts>;
		type DeleteStage = DeleteFinal<Posts, { readonly id: Posts["id"] }>;

		expectTypeOf<ExecuteRows<UpdateStage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
		// #622: the never-requested case rides the same path for all three.
		expectTypeOf<ExecuteRows<UpdateReturnable<Posts>>>().toEqualTypeOf<
			ReadonlyArray<never>
		>();
		expectTypeOf<ExecuteRows<DeleteReturnable<Posts>>>().toEqualTypeOf<
			ReadonlyArray<never>
		>();
		// A mutation's own left-joined set is always `never` (narrow-join-
		// nullability, task 3.5): ReturningRow's object-projection branch
		// fixes it there rather than taking the one-argument (untracked)
		// form, since a mutation has no join grammar to carry an unknown
		// set at all. `posts.id` (declared primaryKey/notNull) narrows to
		// non-null here -- this assertion changing from `string | null` is
		// this task's own point, not a regression (confirmed red before
		// this fix landed, with that exact `string | null` on the left).
		expectTypeOf<ExecuteRows<DeleteStage>[number]>().toEqualTypeOf<{
			readonly id: string;
		}>();
	});
});

/**
 * Extracts the `tx` type a `transaction()`-shaped member's own callback
 * receives -- generic over *which* member (`Db["transaction"]` vs.
 * `ScopedDb["transaction"]`), so the same helper drives both creation
 * sites below from each site's own real, public signature. Deliberately
 * never compares against the `Tx` alias directly: that would only prove
 * both sites produce *something typed `Tx`*, not that `tx.execute` itself
 * resolves statements the way `db.execute` does -- the per-statement
 * `ExecuteRows<S>` comparisons below are the real proof.
 *
 * A plain `infer`-conditional, not `Parameters<Parameters<T>[0]>[0]`:
 * `Parameters<T>`'s own ambient constraint is `T extends (...args: any) =>
 * any`, which would force this house-rule-`any`-free file to spell `any`
 * itself just to satisfy it. This shape mirrors `Db["transaction"]`/
 * `ScopedDb["transaction"]`'s own real signature
 * (`<T>(callback: (tx) => Promise<T>) => Promise<T>`) exactly, without it.
 */
type TxOf<TTransaction> = TTransaction extends (
	callback: (tx: infer TTx) => Promise<unknown>,
) => Promise<unknown>
	? TTx
	: never;

/**
 * A type-only handle on the unscoped creation site's own `tx.execute`
 * (`createTransactionApi`/`buildTx`, `transaction.ts`) -- same
 * instantiation-expression technique as {@link dbExecute} above.
 */
declare const unscopedTxExecute: TxOf<Db["transaction"]>["execute"];
type UnscopedTxRows<TStatement extends CompileInput> = Awaited<
	ReturnType<typeof unscopedTxExecute<TStatement>>
>;

/**
 * A type-only handle on the scoped creation site's own `tx.execute`
 * (`scopedTransaction`/`buildTx`, `context.ts`).
 */
declare const scopedTxExecute: TxOf<ScopedDb["transaction"]>["execute"];
type ScopedTxRows<TStatement extends CompileInput> = Awaited<
	ReturnType<typeof scopedTxExecute<TStatement>>
>;

describe("tx.execute resolves the same types db.execute resolves, at both creation sites (task 3.1, #326)", () => {
	it("unscoped db.transaction's tx.execute: a whole-table select resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<Posts>;

		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("unscoped db.transaction's tx.execute: an object projection resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<{ readonly total: Posts["amount"] }>;

		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("unscoped db.transaction's tx.execute: insert().returning(projection) resolves exactly what db.execute resolves", () => {
		type Stage = InsertFinal<Posts, { readonly total: Posts["amount"] }>;

		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("unscoped db.transaction's tx.execute: a bare QueryNode keeps the plain DriverRow shape, same as db.execute", () => {
		expectTypeOf<UnscopedTxRows<QueryNode>>().toEqualTypeOf<
			ExecuteRows<QueryNode>
		>();
	});

	it("scoped db.as(context).transaction's tx.execute: a whole-table select resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<Posts>;

		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("scoped db.as(context).transaction's tx.execute: an object projection resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<{ readonly total: Posts["amount"] }>;

		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("scoped db.as(context).transaction's tx.execute: insert().returning(projection) resolves exactly what db.execute resolves", () => {
		type Stage = InsertFinal<Posts, { readonly total: Posts["amount"] }>;

		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("scoped db.as(context).transaction's tx.execute: a bare QueryNode keeps the plain DriverRow shape, same as db.execute", () => {
		expectTypeOf<ScopedTxRows<QueryNode>>().toEqualTypeOf<
			ExecuteRows<QueryNode>
		>();
	});
});

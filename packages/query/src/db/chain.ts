import type {
	ColumnRef,
	DeleteFilterable,
	DeleteFinal,
	DeleteReturnable,
	Expr,
	InsertConflictable,
	InsertFinal,
	InsertReturnable,
	MutationRow,
	OrderTermInput,
	ReturningProjection,
	SelectFiltered,
	SelectJoinable,
	SelectLimited,
	SelectOrdered,
	SelectProjection,
	Table,
	UpdateFilterable,
	UpdateFinal,
	UpdateReturnable,
} from "@hejbro/core";
import {
	deleteFrom as coreDeleteFrom,
	insert as coreInsert,
	select as coreSelect,
	update as coreUpdate,
} from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import { compile } from "../compile/compile";
import type { DriverSession } from "../driver/contract";
import type { ReturningRow } from "../types/returning";
import type { SelectResult } from "../types/select-result";
import type { Declarations } from "./db";
import { executeOn } from "./execute";

/**
 * Runs `send` against whichever session this chain's owning surface (the
 * unscoped `db()` handle, a `db.as(context)` scope, or a `transaction()`
 * callback's `tx`) supplies — the single primitive every chain member
 * (tasks 7.1-7.4) is parameterized by, mirroring `fn.ts`'s own `run`
 * parameter (task 4.9) so context application can never cover one surface
 * and miss another (group 7 header, decision ③). A chain built with this
 * `run` never calls it until the chain is actually awaited (thenable
 * inertness) or asked to `.compile()` (which never calls `run` at all).
 */
export type ChainRun = <T>(
	send: (session: DriverSession) => Promise<T>,
) => Promise<T>;

/**
 * A select chain's terminal shape: awaiting it resolves the declared row
 * type ({@link SelectResult}, task 3.10/4.11 reused, never re-derived);
 * `.compile()` is a pure preview — byte-identical to `compile()` of the
 * equivalent core statement (task 7.3), zero driver interaction regardless
 * of how many stages were chained onto it.
 */
export type SelectChainLimited<
	TProjection extends SelectProjection = SelectProjection,
> = PromiseLike<ReadonlyArray<SelectResult<TProjection>>> & {
	compile(): CompileResult;
};

export type SelectChainOrdered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainLimited<TProjection> & {
	limit(count: number): SelectChainLimited<TProjection>;
};

export type SelectChainFiltered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainOrdered<TProjection> & {
	orderBy(
		...terms: ReadonlyArray<OrderTermInput>
	): SelectChainOrdered<TProjection>;
};

export type SelectChainJoinable<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainFiltered<TProjection> & {
	innerJoin(
		joined: Table,
		on: Expr<"boolean">,
	): SelectChainJoinable<TProjection>;
	leftJoin(
		joined: Table,
		on: Expr<"boolean">,
	): SelectChainJoinable<TProjection>;
	where(condition: Expr<"boolean">): SelectChainFiltered<TProjection>;
};

/** Any core builder stage `compile()`/`executeOn` already accept — every select/insert/update/delete stage structurally matches one of `CompileInput`'s `*Query` wrapper shapes. */
type ChainStatement = CompileInput;

/** The `compile()` + thenable pair every chain terminal shares, whatever row shape `TRow` resolves to for that particular statement kind ({@link SelectResult} for select, {@link ReturningRow} for a mutation's `returning()`). */
type ChainTerminal<TRow> = PromiseLike<ReadonlyArray<TRow>> & {
	compile(): CompileResult;
};

/**
 * Runs `stage` through the one shared execute pipeline (`executeOn`, task
 * 4.4-wiring) — the same conversion/error contract as `db.execute`/
 * `tx.execute`, never a second one built for chains. Generic over the
 * resolved row type `TRow` so both the select chain ({@link SelectResult})
 * and every mutation chain ({@link ReturningRow}) share this one runner.
 */
const runChainStatement = <TRow>(
	run: ChainRun,
	stage: ChainStatement,
	tables: Declarations["tables"],
): Promise<ReadonlyArray<TRow>> =>
	run((session) => executeOn(session, stage, tables)) as Promise<
		ReadonlyArray<TRow>
	>;

/**
 * Builds the `then` every chain terminal shares — inert until called
 * (nothing here reads `run` eagerly; `runChainStatement` only runs once
 * `then` itself is invoked, exactly what `await`/`.then()` does and
 * nothing else does).
 *
 * `PromiseLike<T>["then"]` is itself a generic method
 * (`<TResult1, TResult2>`); re-declaring that same genericity by hand here
 * and forwarding straight into the real, concretely-typed
 * `runChainStatement(...)` promise's own `.then()` makes the two
 * independent generic call signatures fight each other during inference
 * (TypeScript collapses one side's `TResult1` to `{}` instead of unifying
 * them). This is instead written as a plain, loosely (`unknown`-)typed
 * passthrough to the real promise's `.then` — runtime behavior is exactly
 * `runChainStatement(...).then(onFulfilled, onRejected)` — and cast once
 * at the return boundary to the precise public signature, the same
 * cast-at-boundary pattern `mutate.ts`/`fn-types.ts`/`compile.ts` use
 * throughout this package.
 */
const makeChainThen = <TRow>(
	run: ChainRun,
	stage: ChainStatement,
	tables: Declarations["tables"],
): ChainTerminal<TRow>["then"] => {
	const then = (
		onFulfilled?: ((value: unknown) => unknown) | null,
		onRejected?: ((reason: unknown) => unknown) | null,
	): PromiseLike<unknown> =>
		runChainStatement<TRow>(run, stage, tables).then(onFulfilled, onRejected);
	return then as ChainTerminal<TRow>["then"];
};

/** The one terminal builder every chain level bottoms out at (select's `SelectChainLimited`, and every mutation's `*ChainFinal`) — `.compile()` is a pure preview (task 7.3), `.then()` runs `stage` through {@link runChainStatement} only once actually awaited. */
const makeChainTerminal = <TRow>(
	run: ChainRun,
	stage: ChainStatement,
	tables: Declarations["tables"],
): ChainTerminal<TRow> => ({
	compile: () => compile(stage),
	// biome-ignore lint/suspicious/noThenProperty: this object IS the thenable (group 7 decision ③, chain termination = thenable) -- inert until awaited, never eagerly resolved.
	then: makeChainThen<TRow>(run, stage, tables),
});

const makeLimitedChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectLimited<TProjection>,
	tables: Declarations["tables"],
): SelectChainLimited<TProjection> =>
	makeChainTerminal<SelectResult<TProjection>>(run, stage, tables);

const makeOrderedChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectOrdered<TProjection>,
	tables: Declarations["tables"],
): SelectChainOrdered<TProjection> => ({
	...makeLimitedChain(run, stage, tables),
	limit: (count) => makeLimitedChain(run, stage.limit(count), tables),
});

const makeFilteredChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectFiltered<TProjection>,
	tables: Declarations["tables"],
): SelectChainFiltered<TProjection> => ({
	...makeOrderedChain(run, stage, tables),
	orderBy: (...terms) => makeOrderedChain(run, stage.orderBy(...terms), tables),
});

const makeJoinableChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectJoinable<TProjection>,
	tables: Declarations["tables"],
): SelectChainJoinable<TProjection> => ({
	...makeFilteredChain(run, stage, tables),
	innerJoin: (joined, on) =>
		makeJoinableChain(run, stage.innerJoin(joined, on), tables),
	leftJoin: (joined, on) =>
		makeJoinableChain(run, stage.leftJoin(joined, on), tables),
	where: (condition) => makeFilteredChain(run, stage.where(condition), tables),
});

/**
 * A mutation chain's terminal shape: awaiting it resolves the `returning()`
 * row shape ({@link ReturningRow}, task 3.13/4.11-mutation reused). A
 * chain that never called `.returning()` at all types identically to one
 * that called `.returning()` with no projection — the same known,
 * documented imprecision `db.ts`'s own `ExecuteResult` already carries
 * (task 4.11-mutation) — and resolves the same way at runtime: an empty
 * array, since neither issues a SQL `RETURNING` clause.
 */
export type InsertChainFinal<
	TTable extends Table = Table,
	TReturning extends ReturningProjection | undefined = undefined,
> = ChainTerminal<ReturningRow<TTable, TReturning>>;

export type InsertChainReturnable<TTable extends Table = Table> =
	InsertChainFinal<TTable> & {
		returning<TProjection extends ReturningProjection | undefined = undefined>(
			projection?: TProjection,
		): InsertChainFinal<TTable, TProjection>;
	};

export type InsertChainConflictable<TTable extends Table = Table> =
	InsertChainReturnable<TTable> & {
		onConflictDoNothing(
			...targetColumns: ReadonlyArray<ColumnRef>
		): InsertChainReturnable<TTable>;
		onConflictDoUpdate(config: {
			readonly target: ReadonlyArray<ColumnRef>;
			readonly set: MutationRow<TTable>;
		}): InsertChainReturnable<TTable>;
	};

export type UpdateChainFinal<
	TTable extends Table = Table,
	TReturning extends ReturningProjection | undefined = undefined,
> = ChainTerminal<ReturningRow<TTable, TReturning>>;

export type UpdateChainReturnable<TTable extends Table = Table> =
	UpdateChainFinal<TTable> & {
		returning<TProjection extends ReturningProjection | undefined = undefined>(
			projection?: TProjection,
		): UpdateChainFinal<TTable, TProjection>;
	};

export type UpdateChainFilterable<TTable extends Table = Table> =
	UpdateChainReturnable<TTable> & {
		where(condition: Expr<"boolean">): UpdateChainReturnable<TTable>;
	};

export type DeleteChainFinal<
	TTable extends Table = Table,
	TReturning extends ReturningProjection | undefined = undefined,
> = ChainTerminal<ReturningRow<TTable, TReturning>>;

export type DeleteChainReturnable<TTable extends Table = Table> =
	DeleteChainFinal<TTable> & {
		returning<TProjection extends ReturningProjection | undefined = undefined>(
			projection?: TProjection,
		): DeleteChainFinal<TTable, TProjection>;
	};

export type DeleteChainFilterable<TTable extends Table = Table> =
	DeleteChainReturnable<TTable> & {
		where(condition: Expr<"boolean">): DeleteChainReturnable<TTable>;
	};

const makeInsertFinalChain = <
	TTable extends Table,
	TReturning extends ReturningProjection | undefined,
>(
	run: ChainRun,
	stage: InsertFinal<TTable, TReturning>,
	tables: Declarations["tables"],
): InsertChainFinal<TTable, TReturning> =>
	makeChainTerminal<ReturningRow<TTable, TReturning>>(run, stage, tables);

const makeInsertReturnableChain = <TTable extends Table>(
	run: ChainRun,
	stage: InsertReturnable<TTable>,
	tables: Declarations["tables"],
): InsertChainReturnable<TTable> => ({
	...makeInsertFinalChain(run, stage, tables),
	returning: (projection) =>
		makeInsertFinalChain(run, stage.returning(projection), tables),
});

const makeInsertConflictableChain = <TTable extends Table>(
	run: ChainRun,
	stage: InsertConflictable<TTable>,
	tables: Declarations["tables"],
): InsertChainConflictable<TTable> => ({
	...makeInsertReturnableChain(run, stage, tables),
	onConflictDoNothing: (...targetColumns) =>
		makeInsertReturnableChain(
			run,
			stage.onConflictDoNothing(...targetColumns),
			tables,
		),
	onConflictDoUpdate: (config) =>
		makeInsertReturnableChain(run, stage.onConflictDoUpdate(config), tables),
});

const makeUpdateFinalChain = <
	TTable extends Table,
	TReturning extends ReturningProjection | undefined,
>(
	run: ChainRun,
	stage: UpdateFinal<TTable, TReturning>,
	tables: Declarations["tables"],
): UpdateChainFinal<TTable, TReturning> =>
	makeChainTerminal<ReturningRow<TTable, TReturning>>(run, stage, tables);

const makeUpdateReturnableChain = <TTable extends Table>(
	run: ChainRun,
	stage: UpdateReturnable<TTable>,
	tables: Declarations["tables"],
): UpdateChainReturnable<TTable> => ({
	...makeUpdateFinalChain(run, stage, tables),
	returning: (projection) =>
		makeUpdateFinalChain(run, stage.returning(projection), tables),
});

const makeUpdateFilterableChain = <TTable extends Table>(
	run: ChainRun,
	stage: UpdateFilterable<TTable>,
	tables: Declarations["tables"],
): UpdateChainFilterable<TTable> => ({
	...makeUpdateReturnableChain(run, stage, tables),
	where: (condition) =>
		makeUpdateReturnableChain(run, stage.where(condition), tables),
});

const makeDeleteFinalChain = <
	TTable extends Table,
	TReturning extends ReturningProjection | undefined,
>(
	run: ChainRun,
	stage: DeleteFinal<TTable, TReturning>,
	tables: Declarations["tables"],
): DeleteChainFinal<TTable, TReturning> =>
	makeChainTerminal<ReturningRow<TTable, TReturning>>(run, stage, tables);

const makeDeleteReturnableChain = <TTable extends Table>(
	run: ChainRun,
	stage: DeleteReturnable<TTable>,
	tables: Declarations["tables"],
): DeleteChainReturnable<TTable> => ({
	...makeDeleteFinalChain(run, stage, tables),
	returning: (projection) =>
		makeDeleteFinalChain(run, stage.returning(projection), tables),
});

const makeDeleteFilterableChain = <TTable extends Table>(
	run: ChainRun,
	stage: DeleteFilterable<TTable>,
	tables: Declarations["tables"],
): DeleteChainFilterable<TTable> => ({
	...makeDeleteReturnableChain(run, stage, tables),
	where: (condition) =>
		makeDeleteReturnableChain(run, stage.where(condition), tables),
});

/**
 * The `select`/mutation entry points a `db()` handle, a `db.as(context)`
 * scope, and a `tx` all assemble onto themselves (tasks 7.1/7.2/7.4) — one
 * shared factory parameterized by `run`, so the chain surface is
 * structurally identical on all three (group 7 header, decision ③).
 */
export type ChainApi = {
	/**
	 * Starts a thenable `select` chain, mirroring core's own two call
	 * forms (`query/select.ts`): `select(table)` projects every declared
	 * column, `select({alias: expr}, table)` projects an object of
	 * expressions. Every stage delegates to the corresponding core builder
	 * stage (D94: no second statement vocabulary) — the chain is inert
	 * until awaited, and `.compile()` never touches the driver.
	 */
	select<TProjection extends SelectProjection>(
		projection: TProjection,
		from?: Table,
	): SelectChainJoinable<TProjection>;
	/**
	 * Starts a thenable `insert` chain, mirroring core's own
	 * `insert(target).values(rows)` (`query/mutate.ts`). Awaiting without
	 * ever calling `.returning()` resolves exactly like `db.execute` of
	 * the same statement (empty rows, no `RETURNING` clause sent).
	 */
	insert<TTable extends Table>(
		target: TTable,
	): {
		values(
			rows: MutationRow<TTable> | ReadonlyArray<MutationRow<TTable>>,
		): InsertChainConflictable<TTable>;
	};
	/** Starts a thenable `update` chain, mirroring core's own `update(target).set(values)`. */
	update<TTable extends Table>(
		target: TTable,
	): { set(values: MutationRow<TTable>): UpdateChainFilterable<TTable> };
	/** Starts a thenable `deleteFrom` chain, mirroring core's own `deleteFrom(target)`. */
	deleteFrom<TTable extends Table>(
		target: TTable,
	): DeleteChainFilterable<TTable>;
};

export const createChainApi = (
	run: ChainRun,
	tables: Declarations["tables"],
): ChainApi => ({
	select: (projection, from) =>
		makeJoinableChain(run, coreSelect(projection, from), tables),
	insert: (target) => ({
		values: (rows) =>
			makeInsertConflictableChain(run, coreInsert(target).values(rows), tables),
	}),
	update: (target) => ({
		set: (values) =>
			makeUpdateFilterableChain(run, coreUpdate(target).set(values), tables),
	}),
	deleteFrom: (target) =>
		makeDeleteFilterableChain(run, coreDeleteFrom(target), tables),
});

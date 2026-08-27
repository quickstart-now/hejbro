import type {
	Expr,
	OrderTermInput,
	SelectFiltered,
	SelectJoinable,
	SelectLimited,
	SelectOrdered,
	SelectProjection,
	Table,
} from "@hejbro/core";
import { select as coreSelect } from "@hejbro/core";
import type { CompileResult } from "../compile/compile";
import { compile } from "../compile/compile";
import type { DriverSession } from "../driver/contract";
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

/**
 * Runs `stage` (any select builder stage — they all structurally extend
 * {@link SelectLimited}) through the one shared execute pipeline
 * (`executeOn`, task 4.4-wiring) — the same conversion/error contract as
 * `db.execute`/`tx.execute`, never a second one built for chains.
 */
const runSelectStage = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectLimited<TProjection>,
	tables: Declarations["tables"],
): Promise<ReadonlyArray<SelectResult<TProjection>>> =>
	run((session) => executeOn(session, stage, tables)) as Promise<
		ReadonlyArray<SelectResult<TProjection>>
	>;

/**
 * Builds the `then` every select chain level shares — inert until called
 * (nothing here reads `run` eagerly; `runSelectStage` only runs once
 * `then` itself is invoked, exactly what `await`/`.then()` does and
 * nothing else does).
 *
 * `PromiseLike<T>["then"]` is itself a generic method
 * (`<TResult1, TResult2>`); re-declaring that same genericity by hand here
 * and forwarding straight into the real, concretely-typed
 * `runSelectStage(...)` promise's own `.then()` makes the two independent
 * generic call signatures fight each other during inference (TypeScript
 * collapses one side's `TResult1` to `{}` instead of unifying them). This
 * is instead written as a plain, loosely (`unknown`-)typed passthrough to
 * the real promise's `.then` — runtime behavior is exactly
 * `runSelectStage(...).then(onFulfilled, onRejected)` — and cast once at
 * the return boundary to the precise public signature, the same
 * cast-at-boundary pattern `mutate.ts`/`fn-types.ts`/`compile.ts` use
 * throughout this package.
 */
const makeThen = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectLimited<TProjection>,
	tables: Declarations["tables"],
): SelectChainLimited<TProjection>["then"] => {
	const then = (
		onFulfilled?: ((value: unknown) => unknown) | null,
		onRejected?: ((reason: unknown) => unknown) | null,
	): PromiseLike<unknown> =>
		runSelectStage(run, stage, tables).then(onFulfilled, onRejected);
	return then as SelectChainLimited<TProjection>["then"];
};

const makeLimitedChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectLimited<TProjection>,
	tables: Declarations["tables"],
): SelectChainLimited<TProjection> => ({
	compile: () => compile(stage),
	// biome-ignore lint/suspicious/noThenProperty: this object IS the thenable (group 7 decision ③, chain termination = thenable) -- inert until awaited, never eagerly resolved.
	then: makeThen(run, stage, tables),
});

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
};

export const createChainApi = (
	run: ChainRun,
	tables: Declarations["tables"],
): ChainApi => ({
	select: (projection, from) =>
		makeJoinableChain(run, coreSelect(projection, from), tables),
});

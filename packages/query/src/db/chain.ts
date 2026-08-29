import type {
	ColumnRef,
	Condition,
	CteBuilder,
	DeleteFilterable,
	DeleteFinal,
	DeleteReturnable,
	Expr,
	InsertConflictable,
	InsertFinal,
	InsertReturnable,
	OrderTermInput,
	ReturningProjection,
	SelectDistinctable,
	SelectFiltered,
	SelectGrouped,
	SelectHaving,
	SelectJoinable,
	SelectLimited,
	SelectNode,
	SelectOrdered,
	SelectProjection,
	SetOpNode,
	SetOpStage,
	Table,
	UpdateFilterable,
	UpdateFinal,
	UpdateReturnable,
	WithNode,
	WithStage,
} from "@hejbro/core";
import {
	deleteFrom as coreDeleteFrom,
	insert as coreInsert,
	select as coreSelect,
	update as coreUpdate,
	withCte as coreWithCte,
	isTable,
	resolveOrderTerm,
} from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import { compile } from "../compile/compile";
import type { DriverSession } from "../driver/contract";
import type { InsertInput, UpdateInput } from "../types/insert-input";
import type {
	RelatedResult,
	RelatedSpec,
	RelationKeysOf,
} from "../types/relations";
import type { ReturningRow } from "../types/returning";
import type { SelectResult } from "../types/select-result";
import type { SetOpResult } from "../types/set-op";
import type { Declarations } from "./db";
import { executeOn } from "./execute";
import { buildRelatedProjection } from "./related";

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
	/** The underlying statement — runtime surface a combinator on ANOTHER chain reads to take this side as a branch. */
	readonly selectQuery: SelectNode;
} & SetOpChainCombinators<SelectResult<TProjection>>;

export type SelectChainOrdered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainLimited<TProjection> & {
	limit(count: number): SelectChainLimitedThenOffset<TProjection>;
	/** `offset` without a `limit` is legal SQL and useful on its own. */
	offset(count: number): SelectChainLimited<TProjection>;
};

export type SelectChainLimitedThenOffset<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainLimited<TProjection> & {
	offset(count: number): SelectChainLimited<TProjection>;
};

/** After `having`: `order by`/`limit`/`offset` still follow, `group by` and a second `having` do not. */
export type SelectChainHaving<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainOrdered<TProjection> & {
	orderBy(
		...terms: ReadonlyArray<OrderTermInput>
	): SelectChainOrdered<TProjection>;
};

export type SelectChainGrouped<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainHaving<TProjection> & {
	/** Filters GROUPS, after aggregation — `where` filters rows before it. */
	having(condition: Condition): SelectChainHaving<TProjection>;
};

export type SelectChainFiltered<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainOrdered<TProjection> & {
	orderBy(
		...terms: ReadonlyArray<OrderTermInput>
	): SelectChainOrdered<TProjection>;
	groupBy(...terms: ReadonlyArray<Expr>): SelectChainGrouped<TProjection>;
};

export type SelectChainJoinable<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainFiltered<TProjection> & {
	innerJoin(joined: Table, on: Condition): SelectChainJoinable<TProjection>;
	leftJoin(joined: Table, on: Condition): SelectChainJoinable<TProjection>;
	where(condition: Condition): SelectChainFiltered<TProjection>;
};

/** What `db.select(...)` returns: joinable, and still able to take `distinct` — which SQL allows only between `select` and the projection, so the chain allows it first and exactly once (#437). */
export type SelectChainDistinctable<
	TProjection extends SelectProjection = SelectProjection,
> = SelectChainJoinable<TProjection> & {
	distinct(): SelectChainJoinable<TProjection>;
	distinctOn(...columns: ReadonlyArray<Expr>): SelectChainJoinable<TProjection>;
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

/**
 * Wraps a core `withCte()` result into a chain terminal (add-ctes, task
 * 5.4) — the same `{ withQuery }` shape `compile()`/`executeOn` already
 * accept (task 5.1/5.3), so no new execution path is needed, only the
 * thenable wrapper every other chain terminal already gets.
 */
const makeWithChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: WithStage<TProjection>,
	tables: Declarations["tables"],
): WithChainTerminal<TProjection> => ({
	withQuery: stage.withQuery,
	...makeChainTerminal<SelectResult<TProjection>>(
		run,
		{ withQuery: stage.withQuery },
		tables,
	),
});

/** The statement behind any chain branch a combinator accepts — a select stage wrapper or a prior set-op chain stage. */
const chainBranchNode = (branch: unknown): SelectNode | SetOpNode => {
	const record = branch as {
		readonly selectQuery?: SelectNode;
		readonly setOpQuery?: SetOpNode;
	};
	if (record.setOpQuery !== undefined) {
		return record.setOpQuery;
	}
	if (record.selectQuery !== undefined) {
		return record.selectQuery;
	}
	return throwQueryChainError();
};

const throwQueryChainError = (): never => {
	const error = new Error(
		"a set-op combinator's other side carries no statement. Next: pass a select chain stage or a prior combination.",
	);
	throw Object.assign(error, { code: "invalid-set-op-branch" });
};

const makeSetOpChain = <TRow>(
	run: ChainRun,
	node: SetOpNode,
	tables: Declarations["tables"],
): SelectChainSetOp<TRow> => ({
	setOpQuery: node,
	...makeChainTerminal<TRow>(run, { setOpQuery: node }, tables),
	...chainSetOpCombinators<TRow>(run, () => node, tables),
	orderBy: (...terms) =>
		makeSetOpChain<TRow>(
			run,
			{ ...node, orderBy: [...node.orderBy, ...terms.map(resolveOrderTerm)] },
			tables,
		),
	limit: (count) =>
		makeSetOpChain<TRow>(run, { ...node, limit: count }, tables),
});

const chainSetOpCombinators = <TRow>(
	run: ChainRun,
	left: () => SelectNode | SetOpNode,
	tables: Declarations["tables"],
): SetOpChainCombinators<TRow> => {
	const combine = <TOther>(
		operator: SetOpNode["operator"],
		all: boolean,
		other: SetOpChainBranch<TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>> =>
		makeSetOpChain<SetOpResult<TRow, TOther>>(
			run,
			{
				queryKind: "setOp",
				operator,
				all,
				left: left(),
				right: chainBranchNode(other),
				orderBy: [],
				limit: null,
				offset: null,
			},
			tables,
		);
	return {
		union: (other) => combine("union", false, other),
		unionAll: (other) => combine("union", true, other),
		intersect: (other) => combine("intersect", false, other),
		intersectAll: (other) => combine("intersect", true, other),
		except: (other) => combine("except", false, other),
		exceptAll: (other) => combine("except", true, other),
	};
};

const makeLimitedChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectLimited<TProjection>,
	tables: Declarations["tables"],
): SelectChainLimited<TProjection> => ({
	// the underlying statement rides along (runtime-only surface) so a
	// set-op combinator on ANOTHER chain can read this side as a branch.
	selectQuery: stage.selectQuery,
	...makeChainTerminal<SelectResult<TProjection>>(run, stage, tables),
	...chainSetOpCombinators<SelectResult<TProjection>>(
		run,
		() => stage.selectQuery,
		tables,
	),
});

const makeOrderedChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectOrdered<TProjection>,
	tables: Declarations["tables"],
): SelectChainOrdered<TProjection> => ({
	...makeLimitedChain(run, stage, tables),
	limit: (count) => ({
		...makeLimitedChain(run, stage.limit(count), tables),
		offset: (offsetCount: number) =>
			makeLimitedChain(run, stage.limit(count).offset(offsetCount), tables),
	}),
	offset: (count) => makeLimitedChain(run, stage.offset(count), tables),
});

const makeFilteredChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectFiltered<TProjection>,
	tables: Declarations["tables"],
): SelectChainFiltered<TProjection> => ({
	...makeOrderedChain(run, stage, tables),
	orderBy: (...terms) => makeOrderedChain(run, stage.orderBy(...terms), tables),
	groupBy: (...terms) => makeGroupedChain(run, stage.groupBy(...terms), tables),
});

const makeHavingChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectHaving<TProjection>,
	tables: Declarations["tables"],
): SelectChainHaving<TProjection> => ({
	...makeOrderedChain(run, stage, tables),
	orderBy: (...terms) => makeOrderedChain(run, stage.orderBy(...terms), tables),
});

const makeGroupedChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectGrouped<TProjection>,
	tables: Declarations["tables"],
): SelectChainGrouped<TProjection> => ({
	...makeOrderedChain(run, stage, tables),
	orderBy: (...terms) => makeOrderedChain(run, stage.orderBy(...terms), tables),
	having: (condition) => makeHavingChain(run, stage.having(condition), tables),
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

const makeDistinctableChain = <TProjection extends SelectProjection>(
	run: ChainRun,
	stage: SelectDistinctable<TProjection>,
	tables: Declarations["tables"],
): SelectChainDistinctable<TProjection> => ({
	...makeJoinableChain(run, stage, tables),
	distinct: () => makeJoinableChain(run, stage.distinct(), tables),
	distinctOn: (...columns) =>
		makeJoinableChain(run, stage.distinctOn(...columns), tables),
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
			readonly set: UpdateInput<TTable>;
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
		where(condition: Condition): UpdateChainReturnable<TTable>;
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
		where(condition: Condition): DeleteChainReturnable<TTable>;
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
/**
 * The chain family `related()` returns (D102 sugar, task 3.3) — typed by
 * the MERGED row directly (`SelectResult<parent> & RelatedResult<…>`),
 * not by a projection: routing the rebuilt object projection through the
 * generic projection typing would degrade the parent's columns to the
 * family-widened fallback (#311), and the whole point of the sugar is
 * that nothing degrades. Runtime delegates to the same core stages as
 * every other chain level.
 */
/** The thenable set-op stage (add-set-operations, D103): further combinators, whole-set orderBy/limit, `compile()` parity with the core builder, and the awaited row = {@link SetOpResult} over the two branches. */
/** Poisons a combinator call whose branches are not row-compatible — `SetOpResult` resolving `never` turns the PARAMETER to `never`, so the mismatch errors at the call site (the database would reject the statement; D103 decision 4). */
type CompatibleBranch<TRow, TOther> = [SetOpResult<TRow, TOther>] extends [
	never,
]
	? never
	: unknown;

export type SelectChainSetOp<TRow> = ChainTerminal<TRow> & {
	readonly setOpQuery: SetOpNode;
	union<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	unionAll<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	intersect<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	intersectAll<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	except<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	exceptAll<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	orderBy(...terms: ReadonlyArray<OrderTermInput>): SelectChainSetOp<TRow>;
	limit(count: number): SelectChainSetOp<TRow>;
};

/** What a chain combinator accepts as its other side: any select chain stage (whole-table or object projection) or a prior chain combination — anything carrying the underlying statement. */
export type SetOpChainBranch<TRow> = PromiseLike<ReadonlyArray<TRow>>;

/** The six combinators every select chain stage carries (add-set-operations) — typed by the RESULT rows, so a branch-shape mismatch resolves `SetOpResult` to `never` and poisons the call. */
export type SetOpChainCombinators<TRow> = {
	union<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	unionAll<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	intersect<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	intersectAll<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	except<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
	exceptAll<TOther>(
		other: SetOpChainBranch<TOther> & CompatibleBranch<TRow, TOther>,
	): SelectChainSetOp<SetOpResult<TRow, TOther>>;
};

export type SelectChainRelatedLimited<TRow> = ChainTerminal<TRow>;

export type SelectChainRelatedOrdered<TRow> =
	SelectChainRelatedLimited<TRow> & {
		limit(count: number): SelectChainRelatedLimited<TRow>;
	};

export type SelectChainRelated<TRow> = SelectChainRelatedOrdered<TRow> & {
	where(condition: Condition): SelectChainRelatedFiltered<TRow>;
	orderBy(
		...terms: ReadonlyArray<OrderTermInput>
	): SelectChainRelatedOrdered<TRow>;
};

export type SelectChainRelatedFiltered<TRow> =
	SelectChainRelatedOrdered<TRow> & {
		orderBy(
			...terms: ReadonlyArray<OrderTermInput>
		): SelectChainRelatedOrdered<TRow>;
	};

const makeRelatedOrdered = <TRow>(
	run: ChainRun,
	stage: SelectFiltered<SelectProjection> | SelectOrdered<SelectProjection>,
	tables: Declarations["tables"],
): SelectChainRelatedOrdered<TRow> => ({
	...makeChainTerminal<TRow>(run, stage, tables),
	limit: (count) => makeChainTerminal<TRow>(run, stage.limit(count), tables),
});

const makeRelatedChain = <TRow>(
	run: ChainRun,
	stage: SelectJoinable<SelectProjection>,
	tables: Declarations["tables"],
): SelectChainRelated<TRow> => ({
	...makeRelatedOrdered<TRow>(run, stage, tables),
	where: (condition) => ({
		...makeRelatedOrdered<TRow>(run, stage.where(condition), tables),
		orderBy: (...terms) =>
			makeRelatedOrdered<TRow>(
				run,
				stage.where(condition).orderBy(...terms),
				tables,
			),
	}),
	orderBy: (...terms) =>
		makeRelatedOrdered<TRow>(run, stage.orderBy(...terms), tables),
});

/** The `related()` member a whole-`Table` select chain gains — see {@link SelectChainRelated}. */
export type RelatedCapable<TSchema, TTable extends Table> = [
	RelationKeysOf<TSchema, TTable>,
] extends [never]
	? // a table with no derivable relations has no `.related` AT ALL (the
		// spec's last clause, closed at group 3 delta review R2) — absence
		// beats a callable that could only ever take `{}`.
		unknown
	: RelatedCapableMembers<TSchema, TTable>;

type RelatedCapableMembers<TSchema, TTable extends Table> = {
	related<TSpec extends RelatedSpec<TSchema, TTable>>(
		// The intersection forces every key OUTSIDE the derivable set to
		// `never`, so a misspelled key fails to type-check even when mixed
		// with valid ones (the F3 finding: generic constraint checking
		// alone lets excess literal keys through).
		spec: TSpec &
			Record<Exclude<keyof TSpec, RelationKeysOf<TSchema, TTable>>, never>,
	): SelectChainRelated<
		SelectResult<TTable> & RelatedResult<TSchema, TTable, TSpec>
	>;
};

/**
 * A chain-built `WITH` statement's terminal shape (add-ctes, task 5.4) —
 * mirrors core's own `WithStage`, not {@link SelectChainLimited}: a
 * `WithNode` has no set-op combinators of its own (`union()`/etc. apply to
 * the body BEFORE `withCte()` wraps it, inside the callback, exactly as
 * core's own builder already requires), so there is nothing here beyond
 * `compile()`/thenable plus the underlying node for symmetry with every
 * other chain terminal.
 *
 * Surface: `db.with(...)`'s own return type can't reuse
 * `SelectChainLimited` (it structurally promises combinators a `WithNode`
 * doesn't have) or `ChainTerminal` alone (callers need `withQuery` to
 * combine a with-chain the way `chainBranchNode` reads `selectQuery`/
 * `setOpQuery` off the others). `<Verb>ChainTerminal` matches this
 * package's own `ChainTerminal` naming for the same role.
 */
export type WithChainTerminal<TProjection extends SelectProjection> =
	PromiseLike<ReadonlyArray<SelectResult<TProjection>>> & {
		compile(): CompileResult;
		readonly withQuery: WithNode;
	};

export type ChainApi<TSchema = Record<string, unknown>> = {
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
	): SelectChainDistinctable<TProjection> &
		(TProjection extends Table
			? RelatedCapable<TSchema, TProjection>
			: unknown);
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
			rows: InsertInput<TTable> | ReadonlyArray<InsertInput<TTable>>,
		): InsertChainConflictable<TTable>;
	};
	/** Starts a thenable `update` chain, mirroring core's own `update(target).set(values)`. */
	update<TTable extends Table>(
		target: TTable,
	): { set(values: UpdateInput<TTable>): UpdateChainFilterable<TTable> };
	/** Starts a thenable `deleteFrom` chain, mirroring core's own `deleteFrom(target)`. */
	deleteFrom<TTable extends Table>(
		target: TTable,
	): DeleteChainFilterable<TTable>;
	/**
	 * Starts a thenable `WITH` statement, mirroring core's own `withCte()`
	 * exactly — the SAME callback signature (`CteBuilder`, `w.as(...)`),
	 * because this takes the core-built list rather than growing a second,
	 * parallel entry chain (task 5.4): a chain-built statement compiles
	 * byte-identically to `compile(coreWithCte(build))`.
	 *
	 * Surface: kept as `with`, not `withCte` — a chain method is a
	 * property name, so the reserved word is legal here (unlike core's own
	 * standalone export, task 3.1), and D102 reserved exactly this slot.
	 * The asymmetry with core's `withCte` is deliberate, not an
	 * inconsistency (`skills/hejbro`, task 7.2, carries the same line).
	 */
	with<TProjection extends SelectProjection>(
		build: (
			w: CteBuilder,
		) => SelectLimited<TProjection> | SetOpStage<TProjection>,
	): WithChainTerminal<TProjection>;
};

export const createChainApi = (
	run: ChainRun,
	tables: Declarations["tables"],
): ChainApi => ({
	select: ((projection: SelectProjection, from?: Table) => {
		const base = makeDistinctableChain(
			run,
			coreSelect(projection, from),
			tables,
		);
		if (!isTable(projection)) {
			return base;
		}
		return {
			...base,
			related: (spec: Readonly<Record<string, true>>) =>
				makeRelatedChain(
					run,
					coreSelect(
						buildRelatedProjection(projection, spec, tables),
						projection,
					),
					tables,
				),
		};
	}) as ChainApi["select"],
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
	with: (build) => makeWithChain(run, coreWithCte(build), tables),
});

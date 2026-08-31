import type {
	DeleteFinal,
	FunctionDeclaration,
	InsertFinal,
	Role,
	SelectLimited,
	SelectProjection,
	Table,
	UpdateFinal,
} from "@hejbro/core";
import { getTableMeta, isTable } from "@hejbro/core";
import type { CompileInput } from "../compile/compile";
import type { Driver, DriverRow } from "../driver/contract";
import type { ReturningRow } from "../types/returning";
import type { SelectResult } from "../types/select-result";
import type { ChainApi, ChainRun } from "./chain";
import { createChainApi } from "./chain";
import type {
	ContextProvider,
	DbContext,
	ProviderRun,
	ScopedDb,
} from "./context";
import { createAsApi, createProviderRun } from "./context";
import { executeOn } from "./execute";
import { createFnApi } from "./fn";
import type { FunctionsOf, TypedFnApi } from "./fn-types";
import type { Tx } from "./transaction";
import {
	buildTx,
	createTransactionApi,
	guardedProviderTransactionOpener,
} from "./transaction";

/**
 * A declared schema module, passed through exactly as its own exports
 * arrive (owner decision (c′): `import * as schema from "./app.schema";
 * db(schema, driver)`) — a flat, heterogeneous record. `db()` classifies
 * each value by its own runtime shape (`isTable`/`declarationKind`), not
 * by which key it was exported under or which bucket the caller sorted
 * it into, so tables/functions/grants/RLS-bearing tables can all live in
 * the same module and an incidental non-declaration export (a constant,
 * a re-exported type) is simply ignored rather than rejected.
 */
export type Schema = Readonly<Record<string, unknown>>;

/**
 * `db()`'s only opt-in extension point (owner decision (c′)/③): role
 * values the caller explicitly wants recognized, on top of whatever a
 * `grant`/RLS policy already inside `schema` names. Each entry must be a
 * branded {@link Role} (`roleName("...")`, core's public export) — a
 * bare string here is a `tsc` error, not a silent pass-through.
 *
 * **Deliberately not auto-collected from `schema`'s own string exports.**
 * A schema module can export arbitrary strings for reasons that have
 * nothing to do with roles (labels, enum-like constants, …); treating
 * every string export as a role candidate would let a *typo'd* role name
 * coincidentally match one of them and pass validation — exactly the
 * silent, non-deterministic failure `db.as`'s "reject a typo immediately"
 * (task 4.7, owner decision) exists to rule out. Opt-in via `roles` keeps
 * that rejection deterministic: only a name the caller explicitly
 * branded and listed here is ever recognized as a role through this
 * path — if a future revision "simplifies" this to scanning `schema` for
 * strings, that determinism is exactly what it gives up.
 */
export type DbOptions = {
	readonly roles?: ReadonlyArray<Role>;
	/**
	 * A registered execution-context provider (add-context-provider): a
	 * resolver consulted once per execution, applied through the exact
	 * same mechanism `db.as(context)` uses (`./context.ts`'s
	 * `createProviderRun`, sharing `assertDeclaredRole`/`applyContext`
	 * with the explicit path -- never a second one). An explicit
	 * `db.as(context)` call still always wins and never consults this.
	 */
	readonly context?: ContextProvider;
};

/**
 * `db()`'s internal, classified view of `schema` plus `options` —
 * computed once at construction (not recomputed per call), read by
 * `execute()`'s column-meta resolver (task 4.4), `db.fn` (task 4.9), and
 * `db.as`'s role whitelist (task 4.7).
 */
export type Declarations = {
	readonly tables: Readonly<Record<string, Table>>;
	readonly functions: Readonly<Record<string, FunctionDeclaration>>;
	/**
	 * The declared-role whitelist (owner decision (c′), task 4.7's 4-way
	 * union): every `grant`'s role, every RLS policy's roles (walked from
	 * each declared table), `options.roles`, and `driver.contributedRoles`
	 * — plain strings throughout. `Role`'s own brand is compile-time only;
	 * `GrantDeclaration.role`/`PolicyDeclaration.roles` were never branded
	 * to begin with, so a `Set<string>` is the honest common type here,
	 * not a re-branding exercise.
	 */
	readonly roles: ReadonlySet<string>;
};

/**
 * `true` when `value` is a declaration object of `kind` — every
 * declaration in core except {@link Table} (hidden behind its own
 * `tableMeta` symbol, `isTable` is the only way to recognize one) carries
 * a plain, enumerable `declarationKind` string.
 */
const isDeclarationKind = (value: unknown, kind: string): boolean =>
	typeof value === "object" &&
	value !== null &&
	"declarationKind" in value &&
	(value as { readonly declarationKind: unknown }).declarationKind === kind;

const tablesOf = (schema: Schema): Readonly<Record<string, Table>> =>
	Object.fromEntries(
		Object.entries(schema).filter((entry): entry is [string, Table] =>
			isTable(entry[1]),
		),
	);

const functionsOf = (
	schema: Schema,
): Readonly<Record<string, FunctionDeclaration>> =>
	Object.fromEntries(
		Object.entries(schema).filter(
			(entry): entry is [string, FunctionDeclaration] =>
				isDeclarationKind(entry[1], "function"),
		),
	);

/** The minimal shape this module reads off a `grant(...).to(...)` result — never the full `GrantSetDeclaration` import, so this stays a structural, not nominal, dependency. */
type GrantSetLike = {
	readonly grants: ReadonlyArray<{ readonly role: string }>;
};

const grantRolesOf = (schema: Schema): ReadonlyArray<string> =>
	Object.values(schema)
		.filter((value): value is GrantSetLike =>
			isDeclarationKind(value, "grant-set"),
		)
		.flatMap((grantSet) => grantSet.grants.map((grant) => grant.role));

const policyRolesOf = (
	tables: Readonly<Record<string, Table>>,
): ReadonlyArray<string> =>
	Object.values(tables).flatMap((table) => {
		const rls = getTableMeta(table).rls;
		if (rls === null) {
			return [];
		}
		return rls.policies.flatMap((policy) => policy.roles);
	});

const rolesOf = (
	schema: Schema,
	tables: Readonly<Record<string, Table>>,
	driver: Driver,
	options: DbOptions | undefined,
): ReadonlySet<string> =>
	new Set([
		...grantRolesOf(schema),
		...policyRolesOf(tables),
		...(options?.roles ?? []),
		...(driver.contributedRoles ?? []),
	]);

/**
 * The row type `execute(statement)` resolves to (tasks 4.11/4.11-mutation)
 * — dispatches on `statement`'s own **structural** shape, not a name
 * check:
 *
 * - Any `select()` builder stage (`select(table)`/`.where()`/
 *   `.orderBy()`/`.limit()`/a join all structurally extend
 *   `SelectLimited`, core's `query/select.ts`) carries `projectionInput`
 *   AND the left-joined set core's own `leftJoin` accumulated (narrow-
 *   join-nullability, task 3.3), so {@link SelectResult}<TProjection,
 *   TLeftJoined> (task 2.1) resolves the declared row shape — whole-table
 *   richness (numeric mode, `IntervalValue`, `notNull`) included, and an
 *   object-projection field narrows per-column once its own source table
 *   is provably not among the left-joined ones.
 *
 *   `infer TLeftJoined` yields the phantom's own optional-property type,
 *   `… | undefined`, stripped here with `Exclude<TLeftJoined,
 *   undefined>` — deliberately NOT the builtin `NonNullable`, which is
 *   `T & {}` as of the TypeScript version this package builds against.
 *   Measured: `NonNullable<unknown>` is `{}`, not `unknown`, so for a
 *   stage that never called `leftJoin` at all (the untracked default),
 *   `NonNullable` would hand `SelectResult` `{}` instead of `unknown` —
 *   `IsTrackedLeftJoinedSet`'s own `[UntrackedJoins] extends
 *   [TLeftJoined]` check would then read `[unknown] extends [{}]`
 *   (false) instead of `[unknown] extends [unknown]` (true), flipping
 *   "untracked" to "tracked" and narrowing every object-projection field
 *   of every plain `db.execute(select(...))` call regardless of whether
 *   anything was actually left-joined — a false narrowing (a lie), not
 *   the fail-safe direction every other failure mode in this change
 *   takes. `Exclude<T, undefined> = T extends undefined ? never : T`
 *   does not have this defect: measured against `unknown`, `never`, a
 *   single `Table`, and a `Table | Table` union (each with and without
 *   `| undefined`), it returns every one of them unchanged.
 * - An `insert()`/`update()`/`deleteFrom()` chain (any stage —
 *   `InsertConflictable`/`InsertReturnable`/`InsertFinal` and their
 *   update/delete equivalents all structurally carry `TTable`/
 *   `TReturning` the same way, core's `query/mutate.ts`, task
 *   4.11-mutation) resolves {@link ReturningRow}<TTable, TReturning> —
 *   `TReturning` `undefined` (no `.returning()` call, or `.returning()`
 *   with no projection) means the whole declared table's shape,
 *   matching `ReturningRow`'s own default. **Known, documented
 *   imprecision**: a chain that never called `.returning()` at all types
 *   identically to one that called `.returning()` with no projection,
 *   even though the former never issues a SQL `RETURNING` clause and
 *   always resolves to an empty array at runtime — an empty array is a
 *   structurally valid (if unhelpfully typed) instance of
 *   `ReadonlyArray<ReturningRow<TTable, undefined>>`, so this is
 *   imprecise typing, not an unsound one (no element could ever violate
 *   the promised shape, because there are never any elements).
 * - Everything else — a bare, already-unwrapped `QueryNode` (that
 *   builder-stage richness is gone once unwrapped) or the `sql` escape
 *   hatch — resolves to the plain {@link DriverRow} shape, exactly as it
 *   always has.
 */
export type ExecuteResult<TStatement> =
	TStatement extends SelectLimited<
		infer TProjection extends SelectProjection,
		infer TLeftJoined
	>
		? ReadonlyArray<SelectResult<TProjection, Exclude<TLeftJoined, undefined>>>
		: TStatement extends InsertFinal<
					infer TTable extends Table,
					infer TReturning
				>
			? ReadonlyArray<ReturningRow<TTable, TReturning>>
			: TStatement extends UpdateFinal<
						infer TTable extends Table,
						infer TReturning
					>
				? ReadonlyArray<ReturningRow<TTable, TReturning>>
				: TStatement extends DeleteFinal<
							infer TTable extends Table,
							infer TReturning
						>
					? ReadonlyArray<ReturningRow<TTable, TReturning>>
					: ReadonlyArray<DriverRow>;

/**
 * A `db()` handle. `execute` is every other db operation's foundation —
 * `transaction()` (4.6), `as()` (4.7), and `fn` (4.9) each start from
 * their own factory in their own file (`transaction.ts`/`context.ts`/
 * `fn.ts`) and this factory assembles their result onto the handle as a
 * real member (the delta specs' own `db.as`/`db.fn`/transaction-API SHALLs
 * require an owned member, not a free function taking `Db` as a
 * parameter) — `db.ts` is the one file allowed to grow across those
 * tasks to do that assembly.
 *
 * `declarations`/`driver` are exposed only as that **internal assembly
 * surface** for `transaction.ts`/`context.ts`/`fn.ts` to build against —
 * whether either is re-exported on the public barrel is group 7's call
 * (task 7.1), not decided here.
 *
 * `TFunctions` (task 4.10) carries the schema module's own function
 * exports, keyed and typed exactly as declared (`fn-types.ts`'s
 * `FunctionsOf<TSchema>`) — defaulted to the widest
 * `Record<string, FunctionDeclaration>` so every existing consumer that
 * only cares about `Db["execute"]` (unaffected by this parameter)
 * keeps compiling against the bare `Db` name unchanged, the same
 * defaulted-generic pattern as every other type this group added
 * (`FunctionDeclaration`, `InsertFinal`/`UpdateFinal`/`DeleteFinal`).
 */
export type Db<
	TFunctions extends Record<string, FunctionDeclaration> = Record<
		string,
		FunctionDeclaration
	>,
	TSchema = Record<string, unknown>,
> = {
	/**
	 * The schema module exactly as passed to `db()` — every declaration it
	 * exports, not only the tables/functions `declarations` classifies.
	 * The same object reference, never copied or rebuilt: a startup
	 * assertion reads this as the ground truth the handle was typed
	 * against, and a defensive copy here would let that truth silently
	 * diverge from what the caller actually declared.
	 */
	readonly schema: TSchema;
	readonly declarations: Declarations;
	readonly driver: Driver;
	/**
	 * Compiles and executes `statement`, resolving to {@link ExecuteResult}
	 * — a `select()` builder stage resolves its declared row type (task
	 * 4.11); everything else resolves the plain {@link DriverRow} shape.
	 */
	execute<TStatement extends CompileInput>(
		statement: TStatement,
	): Promise<ExecuteResult<TStatement>>;
	/**
	 * Runs `callback` inside one transaction (task 4.6): commits and
	 * resolves the callback's own return value on success; on a thrown
	 * error, rolls back and rethrows that exact error, unchanged. Checks
	 * `"interactive-transactions"` before any send (task 4.2's guard), and
	 * fails fast with `nested-transaction-unsupported` when called again
	 * from inside an already-open callback of this same member.
	 */
	transaction<T>(callback: (tx: Tx<TSchema>) => Promise<T>): Promise<T>;
	/**
	 * Scopes every statement in the returned {@link ScopedDb} to `context`
	 * (task 4.7): validates `context.role` against the declared-role
	 * whitelist immediately (fail-closed, `undeclared-role` if not),
	 * applies `SET LOCAL ROLE`/`set_config` inside a wrapping transaction
	 * on the actual work, and never touches this (unscoped) handle at all.
	 */
	as(context: DbContext): ScopedDb<TFunctions, TSchema>;
	/**
	 * `db.fn.*` (tasks 4.9/4.10): one callable per declared function,
	 * keyed **exactly** to the declarations record's own export names —
	 * a nonexistent key is a compile error (owner decision ③'s static
	 * pinning, `fn-types.ts`'s `TypedFnApi`). A `setofTable`-returning
	 * function renders an explicit column list (never `select *`) and
	 * resolves to typed rows, exactly like a whole-table `select()`; a
	 * scalar-returning function resolves to the mapped scalar value
	 * itself, not rows (typed-function-execution spec).
	 */
	readonly fn: TypedFnApi<TFunctions>;
	/**
	 * Thenable `select` chain (task 7.1, group 7 decision ②): mirrors
	 * core's own `select(table)`/`select({alias: expr}, table)` forms,
	 * every stage delegating to the corresponding core builder stage (D94
	 * — no second statement vocabulary). Inert until awaited; `.compile()`
	 * on any stage never touches the driver.
	 */
	select: ChainApi<TSchema>["select"];
	/** Thenable `insert` chain (task 7.2, group 7 decision ②) — mirrors core's `insert(target).values(rows)`. */
	insert: ChainApi["insert"];
	/** Thenable `update` chain (task 7.2, group 7 decision ②) — mirrors core's `update(target).set(values)`. */
	update: ChainApi["update"];
	/** Thenable `deleteFrom` chain (task 7.2, group 7 decision ②) — mirrors core's `deleteFrom(target)`. */
	deleteFrom: ChainApi["deleteFrom"];
	/** Thenable `WITH` chain (add-ctes, task 5.4) — mirrors core's own `withCte()` exactly, the same callback signature. */
	with: ChainApi["with"];
};

/**
 * `execute`'s own runtime body always produces the plain {@link DriverRow}
 * shape structurally (a plain object keyed by column alias) — the cast to
 * `Db["execute"]` at the call site is {@link ExecuteResult}'s
 * compile-time-only narrowing of that same value, never a distinct
 * runtime reshape: `executeOn` (task 4.4-wiring) already converts
 * numeric-mode/`interval` cells per `declarations.tables` before this
 * returns, so the cast's promise (`bigint`/`IntervalValue`, …) actually
 * holds at runtime, not just at the type level. Same cast reasoning as
 * `compile.ts`'s own `handler` cast (g2).
 */
const executeImpl = (
	driver: Driver,
	tables: Declarations["tables"],
	statement: CompileInput,
): Promise<ReadonlyArray<DriverRow>> => executeOn(driver, statement, tables);

/** The operation name every provider-run call site on the unscoped handle shares for `assertCapability`'s error, except `transaction` (named separately below) -- mirrors `db.as(context)`'s own choice (`context.ts`'s `scopedRun("db.as", ...)`) of one shared name for chain/execute/fn. */
const PROVIDER_OPERATION = "db.context";

/** Builds and throws the `context-required`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3, task 3.8). `operation` names the surface that was refused, the same way `driver-missing-capability`'s own message does. */
function throwContextRequired(operation: string): never {
	throw Object.assign(
		new Error(
			`this driver requires an execution context for ${operation}, and none was provided. Next: call db.as(context) explicitly, or register a context provider (db()'s "context" option).`,
		),
		{ code: "context-required", operation },
	);
}

/**
 * The single seam every context-mandatory refusal shares (task 3.1-3.4,
 * #556): a {@link ProviderRun} that refuses `operation` immediately,
 * before `send` is ever consulted -- installed in `providerRun`'s own
 * "no provider registered" slot below, so every execution surface that
 * already shares that seam (chain/fn via {@link providerChainRun},
 * `execute`, `transaction`) refuses alike with no further wiring per
 * surface. Coverage comes from the structure the provider mechanism
 * already established, not from a check repeated at each call site.
 */
const refusingProviderRun: ProviderRun = async (operation) => {
	throwContextRequired(operation);
};

/**
 * The `run` a handle's chain members and `db.fn` share (add-context-
 * provider, task 1.3): with no provider registered, sends straight to
 * `driver` (unchanged behavior); with one registered, every send goes
 * through `providerRun` -- the single primitive that resolves, validates,
 * and applies the context (`context.ts`'s `createProviderRun`) -- so a
 * chain member and `db.fn` can never diverge on whether context applies.
 */
const providerChainRun = (
	driver: Driver,
	providerRun: ProviderRun | undefined,
): ChainRun => {
	if (providerRun === undefined) {
		return (send) => send(driver);
	}
	return (send) => providerRun(PROVIDER_OPERATION, send);
};

/** `execute`'s own provider-aware body (task 1.3): the plain, direct-to-driver path when no provider is registered, or `providerRun`'s one primitive otherwise -- never a second validation/application path. */
const executeWithProvider = (
	driver: Driver,
	tables: Declarations["tables"],
	providerRun: ProviderRun | undefined,
	statement: CompileInput,
): Promise<ReadonlyArray<DriverRow>> => {
	if (providerRun === undefined) {
		return executeImpl(driver, tables, statement);
	}
	return providerRun(PROVIDER_OPERATION, (session) =>
		executeOn(session, statement, tables),
	);
};

/**
 * `transaction`'s own provider-aware body (task 1.3, re-worked): with no
 * provider, the existing `createTransactionApi` unchanged. With one
 * registered, `providerRun` resolves and applies the context exactly
 * *once* for the whole callback (task 1.4 -- the context applies to the
 * transaction, not to each statement inside it), then hands the callback
 * the same {@link buildTx} every other transactional surface in this
 * package builds against -- wrapped in
 * `transaction.ts`'s own {@link guardedProviderTransactionOpener}, so a
 * provider handle's `db.transaction` keeps the exact same
 * `nested-transaction-unsupported` reentrant guard the unprovided path
 * has always had (query-execution's own nested-transaction requirement
 * names "the db handle", not any particular opener -- a registered
 * provider does not change which handle this member belongs to, and the
 * guard exists because reentry opens a second connection out of the
 * pool regardless of how the first one was opened).
 */
const transactionWithProvider = (
	driver: Driver,
	tables: Declarations["tables"],
	providerRun: ProviderRun | undefined,
): (<T>(callback: (tx: Tx) => Promise<T>) => Promise<T>) => {
	if (providerRun === undefined) {
		return createTransactionApi(driver, tables);
	}
	const guardedOpen = guardedProviderTransactionOpener(providerRun);
	return async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> =>
		guardedOpen((session) => callback(buildTx(session, tables)));
};

/**
 * Builds a `db()` handle from a declared `schema` module and `driver`
 * (owner decision (c′)): `import * as schema from "./app.schema"; db(
 * schema, driver, { roles: [appReaderRole] })`. Classifies `schema` once
 * (tables/functions/grant-roles/policy-roles) and folds in `options.roles`
 * and `driver.contributedRoles`, producing the {@link Declarations} every
 * other db operation reads.
 *
 * `execute` hands `driver` the exact {@link CompileResult} `compile()`
 * itself would preview for the same statement — `sql`, `params`, and
 * `kind` together, never `sql`/`params` unpacked into separate arguments
 * — so `kind` reaches the driver boundary unchanged (task 4.3). A driver
 * rejection wraps as `query-execution-failed` (task 4.5, `./execute.ts`'s
 * `executeOn`): the message carries the parameterized SQL text (every
 * value already a `$n` placeholder by the time `compile()` produced it)
 * and `kind`, the driver's own error becomes `cause`, and
 * `compiled.params` never appears anywhere on the thrown error.
 * `transaction` is assembled from `./transaction.ts`'s own factory (task
 * 4.6) so a statement run inside it shares that exact same `executeOn`
 * pipeline.
 */
export const db = <TSchema extends Schema>(
	schema: TSchema,
	driver: Driver,
	options?: DbOptions,
): Db<FunctionsOf<TSchema>, TSchema> => {
	const tables = tablesOf(schema);
	const declarations: Declarations = {
		tables,
		functions: functionsOf(schema),
		roles: rolesOf(schema, tables, driver, options),
	};
	// `functionsOf`'s own runtime return type is deliberately the widened
	// `Record<string, FunctionDeclaration>` (a runtime classification has
	// no reason to carry per-key literal types) -- `FunctionsOf<TSchema>`
	// is the same values, viewed through the precise, per-key-typed
	// compile-time filter `db.fn` (task 4.10) needs. Narrows only: every
	// key `functionsOf` actually returns was already one `FunctionsOf`
	// would keep, since both filter by the exact same runtime/type-level
	// classification (`isDeclarationKind(_, "function")` vs `extends
	// FunctionDeclaration`) applied to the same `schema` object.
	const typedFunctions = declarations.functions as FunctionsOf<TSchema>;
	// undefined with no `context` option (every surface below then runs
	// exactly as before this option existed) -- built once here, not per
	// call, since `assertDeclaredRole`/`applyContext` reuse (the group's
	// own invariant) needs exactly one `providerRun` all eight surfaces
	// share, never one re-derived per surface (task 1.3).
	const buildProviderRun = (): ProviderRun | undefined => {
		if (options?.context === undefined) {
			return undefined;
		}
		return createProviderRun(driver, declarations.roles, options.context);
	};
	// A registered provider always wins (task 3.6); with none registered,
	// a context-mandatory driver (task 3.1-3.4, #556) gets the refusing
	// seam instead of the plain pass-through -- an explicit `db.as(context)`
	// never consults `providerRun` at all (`context.ts`'s own `createAsApi`),
	// so it is unaffected either way (task 3.6's other half).
	const providerRun =
		buildProviderRun() ??
		(driver.contextRequired === true ? refusingProviderRun : undefined);
	return {
		// Spread first, not last (7.4 review finding): every explicit member
		// below is this group's own established contract (task 4.x); a
		// future `ChainApi` key colliding with one of them must never
		// silently win over it just because object literals let a later
		// key overwrite an earlier one -- spreading first guarantees the
		// explicit members always take precedence, and `tsc` still catches
		// a genuine `ChainApi` member that's missing from this object
		// (structural excess from the spread is never a problem; silently
		// losing an explicit member to it would be). Unscoped chains run
		// directly on the driver with no provider registered, exactly like
		// the unscoped `fn` member below -- driver already structurally
		// satisfies DriverSession, no transaction to open; with a provider
		// registered, both instead run through the one shared `providerRun`
		// (task 1.3).
		...createChainApi(
			providerChainRun(driver, providerRun),
			declarations.tables,
		),
		schema,
		declarations,
		driver,
		execute: ((statement: CompileInput) =>
			executeWithProvider(
				driver,
				declarations.tables,
				providerRun,
				statement,
			)) as Db["execute"],
		transaction: transactionWithProvider(
			driver,
			declarations.tables,
			providerRun,
		),
		as: createAsApi<FunctionsOf<TSchema>, TSchema>(
			driver,
			declarations.tables,
			typedFunctions,
			declarations.roles,
		),
		fn: createFnApi(
			providerChainRun(driver, providerRun),
			declarations.tables,
			declarations.functions,
		) as TypedFnApi<FunctionsOf<TSchema>>,
	};
};

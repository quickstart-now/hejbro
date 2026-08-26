import type {
	FunctionDeclaration,
	Role,
	SelectLimited,
	SelectProjection,
	Table,
} from "@hejbro/core";
import { getTableMeta, isTable } from "@hejbro/core";
import type { CompileInput } from "../compile/compile";
import type { Driver, DriverRow } from "../driver/contract";
import type { SelectResult } from "../types/select-result";
import type { DbContext, ScopedDb } from "./context";
import { createAsApi } from "./context";
import { executeOn } from "./execute";
import type { Tx } from "./transaction";
import { createTransactionApi } from "./transaction";

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
 * The row type `execute(statement)` resolves to (task 4.11) — dispatches
 * on `statement`'s own **structural** shape, not a name check: any
 * `select()` builder stage (`select(table)`/`.where()`/`.orderBy()`/
 * `.limit()`/a join all structurally extend `SelectLimited`, core's
 * `query/select.ts`) carries `projectionInput`, so
 * {@link SelectResult}<TProjection> (task 3.10) resolves the declared row
 * shape — whole-table richness (numeric mode, `IntervalValue`, `notNull`)
 * included, object-projection's own narrower, honest widening included.
 * Everything else — a bare, already-unwrapped `QueryNode` (that
 * builder-stage richness is gone once unwrapped), an insert/update/delete
 * builder stage, or the `sql` escape hatch — resolves to the plain
 * {@link DriverRow} shape, exactly as it always has: mutation's
 * `InsertFinal`/`UpdateFinal`/`DeleteFinal` (core's `query/mutate.ts`) are
 * non-generic today (the same erasure task 4.10 hit on `defineFunction`),
 * so `returning()` typing is out of this task's scope pending an owner
 * decision, not silently guessed at here.
 */
export type ExecuteResult<TStatement> =
	TStatement extends SelectLimited<infer TProjection extends SelectProjection>
		? ReadonlyArray<SelectResult<TProjection>>
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
 */
export type Db = {
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
	transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T>;
	/**
	 * Scopes every statement in the returned {@link ScopedDb} to `context`
	 * (task 4.7): validates `context.role` against the declared-role
	 * whitelist immediately (fail-closed, `undeclared-role` if not),
	 * applies `SET LOCAL ROLE`/`set_config` inside a wrapping transaction
	 * on the actual work, and never touches this (unscoped) handle at all.
	 */
	as(context: DbContext): ScopedDb;
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
export const db = (schema: Schema, driver: Driver, options?: DbOptions): Db => {
	const tables = tablesOf(schema);
	const declarations: Declarations = {
		tables,
		functions: functionsOf(schema),
		roles: rolesOf(schema, tables, driver, options),
	};
	return {
		declarations,
		driver,
		execute: ((statement: CompileInput) =>
			executeImpl(driver, declarations.tables, statement)) as Db["execute"],
		transaction: createTransactionApi(driver, declarations.tables),
		as: createAsApi(driver, declarations.tables, declarations.roles),
	};
};

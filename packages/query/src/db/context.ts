import type { FunctionDeclaration, Role } from "@hejbro/core";
import { quoteIdentifier } from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import type {
	ContextRendering,
	DbContext,
	Driver,
	DriverSession,
} from "../driver/contract";
import { assertCapability } from "../driver/errors";
import type { ChainApi } from "./chain";
import { createChainApi } from "./chain";
import type { Declarations, ExecuteResult } from "./db";
import { executeOn, sendCompiled } from "./execute";
import { createFnApi } from "./fn";
import type { TypedFnApi } from "./fn-types";
import type { Tx } from "./transaction";
import { buildTx } from "./transaction";

/**
 * `db.as(context)`'s own argument (task 2.10, #554/#555): re-exported
 * from the driver contract, its own canonical home now that the two
 * context types are one -- see {@link DbContext}'s own tsdoc there for
 * the full shape/validation story. Kept here too, at this public-surface
 * path, so `@hejbro/query`'s own `index.ts` export line
 * (`export type { ... DbContext ... } from "./db/context"`) never moves.
 */
export type { DbContext } from "../driver/contract";

/**
 * `db()`'s `context` option (add-context-provider, owner-settled shape
 * (B)): a resolver consulted once per execution, returning the
 * {@link DbContext} that execution runs under. Non-nullable on purpose --
 * "no context" is a type error here, never a value this type admits, so a
 * caller whose correct behavior is "no identity, no query" throws from
 * the resolver instead of being given a slot to yield nothing into.
 */
export type ContextProvider = () => DbContext | Promise<DbContext>;

/**
 * What `db.as(context)` returns: `execute`/`transaction`/`fn`, all
 * scoped to that context, plus the same thenable chain members every
 * other surface carries (task 7.4, group 7 decision ③) — no `.as` of its
 * own (re-scoping a scoped handle isn't a decided shape; nesting
 * `transaction()` calls through *this* handle is exactly as unsupported
 * as the unscoped one, task 4.6's own guard). `TFunctions` mirrors
 * `db.ts`'s own `Db<TFunctions>` (task 4.10) — defaulted the same way,
 * for the same reason.
 */
export type ScopedDb<
	TFunctions extends Record<string, FunctionDeclaration> = Record<
		string,
		FunctionDeclaration
	>,
	TSchema = Record<string, unknown>,
> = ChainApi<TSchema> & {
	execute<TStatement extends CompileInput>(
		statement: TStatement,
	): Promise<ExecuteResult<TStatement>>;
	transaction<T>(callback: (tx: Tx<TSchema>) => Promise<T>): Promise<T>;
	/** `db.fn.*`, scoped to this context (task 4.7 × 4.9/4.10): every call opens its own context-applied transaction, exactly like `execute`. */
	readonly fn: TypedFnApi<TFunctions>;
};

/** The declared-role list for an `undeclared-role` message: `sorted`'s comma-joined names, or an explicit "(none declared)" for the empty case (house style: no ternary, a guard clause instead). */
const declaredRolesList = (sorted: ReadonlyArray<string>): string => {
	if (sorted.length === 0) {
		return "(none declared)";
	}
	return sorted.join(", ");
};

/** Builds and throws the `undeclared-role`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). Lists every declared role by name (sorted, deterministic) so the caller can see what *is* valid, not just that their own value wasn't. */
function throwUndeclaredRole(
	role: string,
	declaredRoles: ReadonlySet<string>,
): never {
	const sorted = Array.from(declaredRoles).sort();
	const list = declaredRolesList(sorted);
	throw Object.assign(
		new Error(
			`"${role}" is not a declared role. Declared roles: ${list}. Next: grant/policy the role in your schema, add roleName("${role}") to db()'s "roles" option, or check for a typo.`,
		),
		{ code: "undeclared-role" },
	);
}

/** Builds and throws the `context-provider-empty`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). `ContextProvider`'s return type is non-nullable, so this is only reachable from a caller who bypassed that type; a throwing resolver never reaches here at all (its own error propagates unchanged, task 1.1/1.5). */
function throwProviderContextEmpty(): never {
	throw Object.assign(
		new Error(
			'A registered context provider\'s resolver yielded no context. Next: return a context from the resolver on every call -- a resolver whose correct behavior is "no identity, no query" should throw instead of yielding nothing.',
		),
		{ code: "context-provider-empty" },
	);
}

/** Builds and throws the `context-rendering-empty`-coded, enriched plain `Error` (D57, harden-context-boundary task 1.1) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). States the observation only: a mandatory-context declaration is not satisfied by a context whose rendering, in effect, applies nothing. */
function throwContextRenderingEmpty(): never {
	throw Object.assign(
		new Error(
			"the rendering in effect produced no statement for this context; a mandatory context that applies nothing is not applied. Next: fill the context with what the platform requires, or use a driver that does not require one.",
		),
		{ code: "context-rendering-empty" },
	);
}

/**
 * Fail-closed, no escape hatch (owner decision, task 4.7): `role` must be
 * in `declaredRoles` — the union `db()` already computed from every
 * grant, every RLS policy, `options.roles`, and `driver.contributedRoles`
 * — or this throws immediately, before any driver call. `"public"` gets
 * no special case here; it is rejected exactly like any other name that
 * was never declared (core's own `renderRoleName` bare-`public` handling
 * is a `GRANT`-clause keyword rule, not a role-identity rule — irrelevant
 * to `SET LOCAL ROLE`, which never needs it).
 */
const assertDeclaredRole = (
	role: Role,
	declaredRoles: ReadonlySet<string>,
): void => {
	if (!declaredRoles.has(role)) {
		throwUndeclaredRole(role, declaredRoles);
	}
};

/** Builds and throws the `context-role-missing`-coded, enriched plain `Error` (D57) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3, task 2.9). Never joins the `undeclared-role` family (task 2.9's own settled reasoning): that error's body lists the declared roles as the fix, which is meaningless when no role was named at all -- the fix here is naming one, or using a driver whose platform has none. */
function throwContextRoleMissing(): never {
	throw Object.assign(
		new Error(
			'A context named no role, and this driver has not declared its platform role-less. Next: name a role in the context ("role") the platform-appropriate way, or use a driver that declares Driver.roleLessPlatform.',
		),
		{ code: "context-role-missing" },
	);
}

/**
 * Validates `context.role` against `driver`/`declaredRoles` (task 2.4,
 * #555): a named role is always checked against the whitelist,
 * regardless of `driver.roleLessPlatform` -- that declaration grants no
 * exemption from it (task 2.5). A role-less context is admitted only on
 * a driver declaring its platform role-less; on any other driver it is
 * refused with `context-role-missing`, before any I/O.
 */
const assertContextRole = (
	driver: Driver,
	role: Role | undefined,
	declaredRoles: ReadonlySet<string>,
): void => {
	if (role !== undefined) {
		assertDeclaredRole(role, declaredRoles);
		return;
	}
	if (driver.roleLessPlatform !== true) {
		throwContextRoleMissing();
	}
};

const roleStatement = (role: Role): CompileResult => ({
	sql: `set local role ${quoteIdentifier(role)}`,
	params: [],
	kind: "sql",
});

const settingStatement = (key: string, value: string): CompileResult => ({
	sql: "select set_config($1, $2, true)",
	params: [key, value],
	kind: "sql",
});

/**
 * `defaultContextRendering`'s own role-statement slice (task 2.1, #555):
 * empty when `context.role` is `undefined` -- a role-less context is only
 * ever handed to this rendering once a driver has declared its platform
 * role-less (task 2.4's job, not this function's), so this omission is
 * the correct behavior for that case, not a gap. Filter+map, never a
 * ternary (house style): the single-element-or-empty array is
 * `Array.prototype.filter`'s own idiom for "maybe one item".
 */
const roleStatements = (role: Role | undefined): ReadonlyArray<CompileResult> =>
	[role]
		.filter((value): value is Role => value !== undefined)
		.map(roleStatement);

/**
 * The query layer's own default context-rendering contribution (task
 * 2.1, #555, spec: driver-contract "Contributing nothing keeps the
 * existing statements") -- extracted from `applyContext`'s own sequence
 * below, byte-identical to what every driver received before this
 * contribution point existed: `SET LOCAL ROLE` first, then one
 * parameterized `select set_config($1, $2, true)` per setting entry, in
 * declaration order. A pure mapping, never a side effect (spec: "The
 * contribution SHALL be a pure mapping") -- exported here, and
 * re-exported from `@hejbro/query`'s public entry point (`index.ts`,
 * #554/#555 review F1), so a driver package can compose it with its own
 * statements rather than restate this sequence (spec: "reachable by a
 * driver package" -- a module-level export one file down is not
 * reachability across the package boundary; the public specifier is).
 */
export const defaultContextRendering: ContextRendering = (context) => [
	...roleStatements(context.role),
	...Object.entries(context.settings ?? {}).map(([key, value]) =>
		settingStatement(key, value),
	),
];

/**
 * Applies `context` on `session` (task 2.2, #555): `driver`'s own
 * rendering when it contributes one, `defaultContextRendering` otherwise
 * (spec: "Contributing nothing keeps the existing statements") — the
 * driver's own rendering fully replaces the default, never runs
 * alongside it. Every returned statement is sent one at a time, in the
 * rendering's own order (a `reduce`-chained sequential await, not
 * `Promise.all` — these share one connection, and issuing them
 * concurrently would race on it, task 2.6). Every statement here goes
 * through `sendCompiled` (task 4.5's `query-execution-failed` contract),
 * never a bespoke error path.
 */
const applyContext = async (
	driver: Driver,
	session: DriverSession,
	context: DbContext,
): Promise<void> => {
	const rendering = driver.renderContext ?? defaultContextRendering;
	const statements = rendering(context);
	if (statements.length === 0 && driver.contextRequired === true) {
		throwContextRenderingEmpty();
	}
	await statements.reduce<Promise<void>>(
		(previous, statement) =>
			previous.then(async () => {
				await sendCompiled(session, statement);
			}),
		Promise.resolve(),
	);
};

/**
 * The primitive a registered `context` provider runs every execution
 * surface through (add-context-provider, task 1.1/1.2): asserts the
 * interactive-transaction capability *before* consulting the resolver (so
 * the failure belongs to the driver alone, task 1.6), resolves the
 * context, rejects fail-closed if the resolver yielded nothing, validates
 * the resolved role through the exact same {@link assertDeclaredRole}
 * `db.as(context)` uses, then applies it via the exact same
 * {@link applyContext} inside one fresh `driver.transaction` -- the same
 * two functions the explicit path calls, never a second implementation of
 * either (the invariant every task in this group serves).
 */
export type ProviderRun = <T>(
	operation: string,
	send: (session: DriverSession) => Promise<T>,
) => Promise<T>;

export const createProviderRun = (
	driver: Driver,
	declaredRoles: Declarations["roles"],
	provider: ContextProvider,
): ProviderRun => {
	return async <T>(
		operation: string,
		send: (session: DriverSession) => Promise<T>,
	): Promise<T> => {
		assertCapability(driver, "interactive-transactions", operation);
		const context = await provider();
		if (context === undefined || context === null) {
			throwProviderContextEmpty();
		}
		assertContextRole(driver, context.role, declaredRoles);
		return driver.transaction(async (session) => {
			await applyContext(driver, session, context);
			return send(session);
		});
	};
};

/**
 * Builds the `as()` member `db()` assembles onto its handle (task 4.7):
 * validates `context.role` against the declared-role whitelist
 * immediately (synchronously, before any I/O), then returns a
 * {@link ScopedDb} whose every `execute`/`transaction` call opens its
 * *own* fresh `driver.transaction` — `db.as(ctx).transaction(cb)` is
 * therefore never a nested transaction (task 4.6's nested guard lives on
 * the unscoped `db.transaction` member entirely; this is a separate
 * `driver.transaction` call, not a second call into that guarded one) —
 * applies `context` as that transaction's first statement(s), then runs
 * the caller's actual work on the exact same session. The original,
 * unscoped handle this was built alongside is never touched: its own
 * `execute`/`transaction` (assembled separately in `db.ts`) share no
 * mutable state with this closure at all.
 */
export const createAsApi = <
	TFunctions extends Record<string, FunctionDeclaration>,
	TSchema = Record<string, unknown>,
>(
	driver: Driver,
	tables: Declarations["tables"],
	functions: TFunctions,
	declaredRoles: Declarations["roles"],
): ((context: DbContext) => ScopedDb<TFunctions, TSchema>) => {
	return (context: DbContext): ScopedDb<TFunctions, TSchema> => {
		assertContextRole(driver, context.role, declaredRoles);
		/**
		 * Opens one fresh, context-applied transaction and runs `send` on
		 * it — the single primitive `execute`/`fn`/`transaction` (task 4.7
		 * × 4.9) all build on, so context application can never cover some
		 * and miss another. `operation` names the caller for
		 * `assertCapability`'s error, so folding three call sites into one
		 * doesn't blur "which member did this" out of the missing-
		 * capability message.
		 */
		const scopedRun = async <T>(
			operation: string,
			send: (session: DriverSession) => Promise<T>,
		): Promise<T> => {
			assertCapability(driver, "interactive-transactions", operation);
			return driver.transaction(async (session) => {
				await applyContext(driver, session, context);
				return send(session);
			});
		};
		const scopedExecute = (statement: CompileInput): Promise<unknown> =>
			scopedRun("db.execute", (session) =>
				executeOn(session, statement, tables),
			);
		const scopedTransaction = <T>(
			callback: (tx: Tx) => Promise<T>,
		): Promise<T> =>
			scopedRun("transaction", async (session) =>
				callback(buildTx(session, tables)),
			);
		return {
			// spread first (same reasoning as `db.ts`'s own handle literal,
			// task 7.4 review finding): the explicit `execute`/`transaction`/
			// `fn` members below are this context's own established contract
			// and must never be silently overwritten by a future `ChainApi`
			// key collision.
			...createChainApi(
				(operation) => (send) => scopedRun(operation, send),
				tables,
			),
			execute: scopedExecute as ScopedDb<TFunctions>["execute"],
			transaction: scopedTransaction,
			fn: createFnApi(
				(send) => scopedRun("db.fn", send),
				tables,
				functions,
			) as TypedFnApi<TFunctions>,
		};
	};
};

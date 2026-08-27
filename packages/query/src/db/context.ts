import type { FunctionDeclaration, Role } from "@hejbro/core";
import { quoteIdentifier } from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import type { Driver, DriverSession } from "../driver/contract";
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
 * `db.as(context)`'s own argument: the role to run under, plus optional
 * session settings (Supabase's JWT-claim `set_config` calls are the
 * motivating case, group 6) applied alongside it. `role` must already be
 * in {@link Declarations}`.roles` — the 4-source whitelist `db()` itself
 * computed (grant/policy/`roles` option/`driver.contributedRoles`) —
 * this type says nothing about validity on its own.
 */
export type DbContext = {
	readonly role: Role;
	readonly settings?: Readonly<Record<string, string>>;
};

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
> = ChainApi & {
	execute<TStatement extends CompileInput>(
		statement: TStatement,
	): Promise<ExecuteResult<TStatement>>;
	transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T>;
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
 * Applies `context` on `session`: `SET LOCAL ROLE` first (identifier-quoted
 * via core's public `quoteIdentifier` — `SET LOCAL ROLE` takes no bind
 * parameter, so quoting is the only defense, and it is a real one: an
 * embedded `"` is doubled, never passed through raw), then one
 * parameterized `select set_config($1, $2, true)` per setting entry, in
 * declaration order and one at a time (a `reduce`-chained sequential
 * await, not `Promise.all` — these share one connection, and issuing them
 * concurrently would race on it). Every statement here goes through
 * `sendCompiled` (task 4.5's `query-execution-failed` contract), never a
 * bespoke error path.
 */
const applyContext = async (
	session: DriverSession,
	context: DbContext,
): Promise<void> => {
	await sendCompiled(session, roleStatement(context.role));
	const settingEntries = Object.entries(context.settings ?? {});
	await settingEntries.reduce<Promise<void>>(
		(previous, [key, value]) =>
			previous.then(async () => {
				await sendCompiled(session, settingStatement(key, value));
			}),
		Promise.resolve(),
	);
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
>(
	driver: Driver,
	tables: Declarations["tables"],
	functions: TFunctions,
	declaredRoles: Declarations["roles"],
): ((context: DbContext) => ScopedDb<TFunctions>) => {
	return (context: DbContext): ScopedDb<TFunctions> => {
		assertDeclaredRole(context.role, declaredRoles);
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
				await applyContext(session, context);
				return send(session);
			});
		};
		const scopedExecute = (statement: CompileInput): Promise<unknown> =>
			scopedRun("db.as", (session) => executeOn(session, statement, tables));
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
			...createChainApi((send) => scopedRun("db.as", send), tables),
			execute: scopedExecute as ScopedDb<TFunctions>["execute"],
			transaction: scopedTransaction,
			fn: createFnApi(
				(send) => scopedRun("db.as", send),
				tables,
				functions,
			) as TypedFnApi<TFunctions>,
		};
	};
};

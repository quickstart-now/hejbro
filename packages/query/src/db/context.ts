import type { FunctionDeclaration, Role } from "@hejbro/core";
import { quoteIdentifier } from "@hejbro/core";
import type { CompileInput, CompileResult } from "../compile/compile";
import type {
	ContextRendering,
	DbContext,
	Driver,
	DriverCapabilityKey,
	DriverRow,
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
import { runCallbackWithTx, TRANSACTION_OPERATION } from "./transaction";

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

/** Builds and throws the `context-rendering-empty`-coded, enriched plain `Error` (D57, harden-context-boundary task 1.1) — a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). States the observation only: a mandatory-context declaration is not satisfied by a context whose rendering, in effect, applies nothing. `operation` names the surface the caller invoked (task 1.9): on a scoped handle this is the only refusal the mandatory-context requirement can raise at all, since `context-required` cannot fire where a context already exists by construction. */
function throwContextRenderingEmpty(operation: string): never {
	throw Object.assign(
		new Error(
			"the rendering in effect produced no statement for this context; a mandatory context that applies nothing is not applied. Next: fill the context with what the platform requires, or use a driver that does not require one.",
		),
		{ code: "context-rendering-empty", operation },
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
 * `context`'s own statements (task 1.3, #486): `driver`'s own rendering
 * when it contributes one, `defaultContextRendering` otherwise (spec:
 * "Contributing nothing keeps the existing statements") -- the driver's
 * own rendering fully replaces the default, never runs alongside it.
 * Shared by the interactive path ({@link applyContext}) and the batch
 * path (`runContextInBatch`) so both send "the same statements, from the
 * same built-in or contributed rendering, in the same order" (delta) by
 * construction, never by two call sites happening to agree. `operation`
 * is threaded through only to name an empty-rendering refusal's surface
 * (task 1.9) -- it never reaches a statement or the rendering itself.
 */
const contextStatements = (
	driver: Driver,
	context: DbContext,
	operation: string,
): ReadonlyArray<CompileResult> => {
	const rendering = driver.renderContext ?? defaultContextRendering;
	const statements = rendering(context);
	if (statements.length === 0 && driver.contextRequired === true) {
		throwContextRenderingEmpty(operation);
	}
	return statements;
};

/**
 * Applies `context` on `session` (task 2.2, #555): every statement from
 * {@link contextStatements} sent one at a time, in the rendering's own
 * order (a `reduce`-chained sequential await, not `Promise.all` — these
 * share one connection, and issuing them concurrently would race on it,
 * task 2.6). Every statement here goes through `sendCompiled` (task
 * 4.5's `query-execution-failed` contract), never a bespoke error path.
 */
const applyContext = async (
	driver: Driver,
	session: DriverSession,
	context: DbContext,
	operation: string,
): Promise<void> => {
	const statements = contextStatements(driver, context, operation);
	await statements.reduce<Promise<void>>(
		(previous, statement) =>
			previous.then(async () => {
				await sendCompiled(session, statement);
			}),
		Promise.resolve(),
	);
};

/** "1 result" vs "N results" -- guard clause, not ternary (house style). */
const resultNoun = (count: number): string => {
	if (count === 1) {
		return "1 result";
	}
	return `${count} results`;
};

/** "1 statement" vs "N statements" -- guard clause, not ternary (house style). */
const memberNoun = (count: number): string => {
	if (count === 1) {
		return "1 statement";
	}
	return `${count} statements`;
};

/**
 * Builds and throws the `batch-result-count-mismatch`-coded, enriched
 * plain `Error` (D57) -- a driver contract violation (task 1.3, #486;
 * review finding N3): `Driver.batch` must resolve exactly one row list
 * per member sent, and any other count -- fewer, more, or zero -- is a
 * wrong answer, not merely a missing one, since silently returning a
 * context statement's own rows as the caller's would go unnoticed. Names
 * both counts so the message is falsifiable regardless of which
 * direction the driver got it wrong. Absorbs the former "zero results"
 * internal-invariant case (486/R14): zero is one instance of a count
 * mismatch, not a separate failure mode -- unlike `result-rows.ts`'s own
 * zero-length-array case (task 1.6, #892/R6), which is a different site
 * entirely (a single node-postgres multi-command result, never a driver
 * batch result) and keeps its own uncoded internal-invariant error.
 */
function throwBatchResultCountMismatch(sent: number, returned: number): never {
	throw Object.assign(
		new Error(
			`driver.batch returned ${resultNoun(returned)}, but the query layer sent ${memberNoun(sent)} -- one row list per member is required. Next: use a driver whose batch member honors that contract, or file an issue against this one.`,
		),
		{ code: "batch-result-count-mismatch", sent, returned },
	);
}

const isBatchResultCountMismatchError = (
	error: unknown,
): error is Error & { readonly code: "batch-result-count-mismatch" } =>
	error instanceof Error &&
	(error as { code?: unknown }).code === "batch-result-count-mismatch";

/**
 * The last entry of a driver batch result (task 1.3, #486), after
 * checking `results` holds exactly one entry per `members` sent (task
 * 1.3, #486/R14, review finding N3) -- `members.length` is always at
 * least 1 ({@link runContextInBatch} always appends the caller's own
 * statement), so a checked-equal `results` always has a defined last
 * entry; the second guard exists only so `tsc` can see that, and folds
 * into the same coded error rather than a second failure shape.
 */
const lastBatchRowsChecked = (
	members: ReadonlyArray<CompileResult>,
	results: ReadonlyArray<ReadonlyArray<DriverRow>>,
): ReadonlyArray<DriverRow> => {
	if (results.length !== members.length) {
		throwBatchResultCountMismatch(members.length, results.length);
	}
	const last = results[results.length - 1];
	if (last === undefined) {
		throwBatchResultCountMismatch(members.length, results.length);
	}
	return last;
};

/** What `sendCompiled`'s own `throwQueryExecutionFailed` (`execute.ts`, task 4.5) enriches its `Error` with -- read back here (task 1.3b, #486/R9) to recover the caller's own `kind` and the driver's own raw `cause`, both already correct, without importing `execute.ts`'s private builder. */
type QueryExecutionFailedError = Error & {
	readonly code: "query-execution-failed";
	readonly kind: CompileResult["kind"];
	readonly cause: unknown;
};

const isQueryExecutionFailedError = (
	error: unknown,
): error is QueryExecutionFailedError =>
	error instanceof Error &&
	(error as { code?: unknown }).code === "query-execution-failed";

/**
 * Builds and throws the batch-shaped `query-execution-failed` report
 * (task 1.3b, #486/R9): `code` and `kind` stay what `sendCompiled` had
 * already gotten right, `cause` is the driver's own rejection verbatim
 * -- only the message changes, from a claim that the caller's own
 * statement alone failed (false whenever a context statement was the
 * actual cause) to naming the whole batch and admitting what a batch
 * result cannot say: which member failed. `members` lists every
 * statement actually sent, in order, so nothing known is withheld.
 */
/** "1 context statement" vs "N context statements" -- a guard clause, not a ternary (house style); the singular is the common case (one role, no settings) and reads as broken English left plural. */
const contextStatementNoun = (count: number): string => {
	if (count === 1) {
		return "1 context statement";
	}
	return `${count} context statements`;
};

/**
 * Every batch member, numbered (`1) …`, never `;`-joined: this PR gives
 * `;` its own meaning inside a single multi-command `sql` text (#892,
 * task 1.6 -- "the last command's rows"), so joining a *list of separate
 * statements* with the same character would read as one more multi-
 * command text instead of what it is here, a report of what was sent.
 */
const numberedStatementList = (members: ReadonlyArray<CompileResult>): string =>
	members.map((member, index) => `${index + 1}) ${member.sql}`).join(" ");

const throwBatchExecutionFailed = (
	members: ReadonlyArray<CompileResult>,
	contextStatementCount: number,
	kind: CompileResult["kind"],
	cause: unknown,
): never => {
	throw Object.assign(
		new Error(
			`query execution failed for a batch of ${contextStatementNoun(contextStatementCount)} and this "${kind}" statement; the driver does not report which member failed. Statement: ${numberedStatementList(members)}. Next: the driver's full error (fields like "detail" and "hint" included) is on "cause" -- this wrapper never retries or reinterprets it.`,
		),
		{ code: "query-execution-failed", kind, cause },
	);
};

/**
 * Runs `send` on a single-`execute` session backed by one `driver.batch`
 * call (task 1.3, #486): the context's own statements ({@link
 * contextStatements}) plus `send`'s one caller statement, sent as one
 * batch, resolving to the last member's rows. Never a second
 * implementation of the context-application sequence -- the batch path's
 * only difference from {@link applyContext}'s interactive path is where
 * the statements travel, not what they are or what order they're in.
 *
 * A driver rejection surfaces through `sendCompiled` first (task 4.5,
 * `execute.ts`), already carrying the correct `kind`/`cause` but the
 * wrong message (it names only `compiled`, the caller's own statement --
 * task 1.3b, #486/R9: a context statement could equally have been the
 * actual cause, and a batch result never says which). `sent` records the
 * one statement this session's own `execute` actually received, so the
 * catch below can rebuild the report naming the whole batch instead,
 * without a second implementation of `sendCompiled`'s own enrichment.
 */
const runContextInBatch = async <T>(
	driver: Driver,
	context: DbContext,
	operation: string,
	send: (session: DriverSession) => Promise<T>,
): Promise<T> => {
	const statements = contextStatements(driver, context, operation);
	const sent: Array<CompileResult> = [];
	try {
		return await send({
			execute: async (compiled) => {
				sent.push(compiled);
				const members = [...statements, compiled];
				const results = await driver.batch(members);
				return lastBatchRowsChecked(members, results);
			},
		});
	} catch (error) {
		const callerStatement = sent[0];
		if (callerStatement === undefined || !isQueryExecutionFailedError(error)) {
			throw error;
		}
		// `sendCompiled` (task 4.5) wraps whatever `execute` throws as
		// `query-execution-failed`, `cause` set to the original -- so a
		// count-mismatch thrown above arrives here as `error.cause`, not
		// `error` itself (review finding N3, "trap 2"). Rethrown unwrapped,
		// ahead of the 1.3b rebuild below, so its own code reaches the
		// caller rather than being re-wrapped a second time under the
		// wrong one.
		if (isBatchResultCountMismatchError(error.cause)) {
			throw error.cause;
		}
		return throwBatchExecutionFailed(
			[...statements, callerStatement],
			statements.length,
			error.kind,
			error.cause,
		);
	}
};

/**
 * Opens one fresh, context-applied transaction and runs `send` on it —
 * the interactive path both {@link createProviderRun} and
 * {@link createAsApi} share (task 1.3, #486), so a capability check
 * choosing this path can never diverge from what actually runs.
 */
const runContextInteractively = <T>(
	driver: Driver,
	context: DbContext,
	operation: string,
	send: (session: DriverSession) => Promise<T>,
): Promise<T> =>
	driver.transaction(async (session) => {
		await applyContext(driver, session, context, operation);
		return send(session);
	});

/**
 * The capability keys a given operation may run under (task 1.3, #486):
 * `"transaction"` is the callback-scoped surface (`db.transaction`/
 * `db.as(context).transaction`) -- inherently interactive, so it is
 * never a batch candidate and asserts the single legacy key. Every other
 * operation (execute, chain, `db.fn`) can run either way, preferring
 * interactive where both are declared (delta: "Interactive transactions
 * win where both are declared"), so it asserts both, interactive first.
 */
const capabilitiesForOperation = (
	operation: string,
): ReadonlyArray<DriverCapabilityKey> => {
	if (operation === TRANSACTION_OPERATION) {
		return ["interactive-transactions"];
	}
	return ["interactive-transactions", "batched-transactions"];
};

/**
 * The primitive a registered `context` provider runs every execution
 * surface through (add-context-provider, task 1.1/1.2; batch path, task
 * 1.3, #486): asserts capability *before* consulting the resolver (so
 * the failure belongs to the driver alone, task 1.6), resolves the
 * context, rejects fail-closed if the resolver yielded nothing, validates
 * the resolved role through the exact same {@link assertDeclaredRole}
 * `db.as(context)` uses, then runs it either interactively or as one
 * batch -- declaration alone decides which (never a runtime probe of
 * `driver.batch`'s presence): `"transaction"` (routed here by
 * `transaction.ts`'s `guardedProviderTransactionOpener`) always runs
 * interactively, every other operation follows
 * `driver.capabilities["interactive-transactions"]`.
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
		assertCapability(driver, capabilitiesForOperation(operation), operation);
		const context = await provider();
		if (context === undefined || context === null) {
			throwProviderContextEmpty();
		}
		assertContextRole(driver, context.role, declaredRoles);
		if (
			operation === TRANSACTION_OPERATION ||
			driver.capabilities["interactive-transactions"]
		) {
			return runContextInteractively(driver, context, operation, send);
		}
		return runContextInBatch(driver, context, operation, send);
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
		 * Runs `send` interactively or as one batch (task 4.7 × 4.9; batch
		 * path task 1.3, #486) — the single primitive `execute`/`fn`/chain
		 * all build on, so context application can never cover some and
		 * miss another. `operation` names the caller for `assertCapability`'s
		 * error, so folding these call sites into one doesn't blur "which
		 * member did this" out of the missing-capability message. Never
		 * used for `transaction` (see {@link scopedRunInteractive} below):
		 * a callback is inherently interactive, so it must not fall through
		 * to the batch path just because both keys are asserted here.
		 */
		const scopedRun = async <T>(
			operation: string,
			send: (session: DriverSession) => Promise<T>,
		): Promise<T> => {
			assertCapability(
				driver,
				["interactive-transactions", "batched-transactions"],
				operation,
			);
			if (driver.capabilities["interactive-transactions"]) {
				return runContextInteractively(driver, context, operation, send);
			}
			return runContextInBatch(driver, context, operation, send);
		};
		/** `transaction`'s own primitive (task 1.3, #486): a callback is inherently interactive, so this asserts the single legacy key and never falls through to the batch path. */
		const scopedRunInteractive = async <T>(
			operation: string,
			send: (session: DriverSession) => Promise<T>,
		): Promise<T> => {
			assertCapability(driver, ["interactive-transactions"], operation);
			return runContextInteractively(driver, context, operation, send);
		};
		const scopedExecute = (statement: CompileInput): Promise<unknown> =>
			scopedRun("db.execute", (session) =>
				executeOn(session, statement, tables),
			);
		const scopedTransaction = <T>(
			callback: (tx: Tx) => Promise<T>,
		): Promise<T> =>
			scopedRunInteractive(TRANSACTION_OPERATION, (session) =>
				runCallbackWithTx(session, tables, callback),
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

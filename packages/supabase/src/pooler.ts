import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverRow,
	DriverSession,
} from "@hejbro/query";
import { throwMissingCapability } from "@hejbro/query";

/**
 * Fixed per tasks.md group 1 header / design.md: a transaction-mode
 * pooler (Supavisor) holds a real backend connection for the lifetime of
 * one `BEGIN`/`COMMIT` (`interactive-transactions: true`), but does not
 * reliably keep that same backend across separate transactions or
 * separate single-statement executions (`session-state: false`) --
 * measured against a local stack (design.md's Measurement record).
 * `batched-transactions` is fixed `false` (task 1.2a, #486/R5/R7): this
 * decorator builds its own capability record rather than spreading the
 * wrapped driver's, so its member set must agree with that declaration
 * independently of what the base driver underneath declares -- see
 * {@link batch} below for the member half of that agreement. An
 * explicit constant, never a spread of the wrapped driver's own
 * `capabilities`: a future capability key added to the contract must be a
 * type error here, not a silently inherited value.
 */
// Frozen (486, reviewer finding N2): every poolerDriver(...) value shared
// this one object unfrozen, so a write through any one of them mutated
// every other -- `@hejbro/pg` and `@hejbro/neon` already freeze their own
// records for the same reason.
const CAPABILITIES: DriverCapabilities = Object.freeze({
	"interactive-transactions": true,
	"session-state": false,
	"prepared-statements": false,
	"batched-transactions": false,
});

/**
 * `Driver.batch`'s own body on this decorator (task 1.2a, #486/R7):
 * refuses before touching the wrapped driver at all. Declared
 * explicitly, never inherited via `...driver` the way `execute`/
 * `transaction`/`setupSession` are overridden below -- an inherited
 * `batch` would read as working while {@link CAPABILITIES} declares
 * `false`, exactly the hole "A capability explicitly declared false
 * fails closed" forbids, regardless of what the wrapped driver's own
 * `batch` does.
 */
const refuseBatch = async (
	_statements: ReadonlyArray<CompileResult>,
): Promise<ReadonlyArray<ReadonlyArray<DriverRow>>> => {
	throwMissingCapability("batched-transactions", "batch");
};

/**
 * The transaction-local pin statements (task 1.2, owner decision ②
 * "Settled contract details"): restated here, never delegated to the
 * wrapped driver's own session-setup member -- that member sends
 * session-scoped `SET` (`@hejbro/pg`'s `SETUP_SESSION_SQL`), which is
 * the failure this path exists to remove and which would leave that
 * state on a pooled backend afterwards. `SET LOCAL`, not `SET`: measured
 * (design.md M2/M3) to hold for exactly one transaction's statements and
 * expire at commit, regardless of whether the endpoint reassigns the
 * backend afterwards. Duplicates the vanilla driver's own list
 * (`@hejbro/pg/src/driver.ts`'s `SETUP_SESSION_SQL`) -- the drift
 * trigger this creates is named, not assumed: if this list stops
 * matching what the value conversion layer needs, 1.4's value-shape
 * assertions go red (an `interval` arriving in the client library's
 * default shape instead of raw text, a `bytea` arriving in the unpinned
 * encoding). That is the test to look at when this constant is edited.
 */
export const PIN_STATEMENTS: ReadonlyArray<CompileResult> = [
	{ sql: "set local intervalstyle to 'postgres'", params: [], kind: "sql" },
	{ sql: "set local bytea_output to 'hex'", params: [], kind: "sql" },
];

/**
 * Sends {@link PIN_STATEMENTS} on `session`, in order, one at a time --
 * a `reduce`-chained sequential await, not `Promise.all` (mirrors
 * `@hejbro/query`'s own `applyContext`, `db/context.ts`): these statements
 * share one connection, and issuing them concurrently would race on it.
 */
export const sendPins = async (session: DriverSession): Promise<void> => {
	await PIN_STATEMENTS.reduce<Promise<void>>(
		(previous, statement) =>
			previous.then(async () => {
				await session.execute(statement);
			}),
		Promise.resolve(),
	);
};

/**
 * Builds `poolerDriver`'s transaction-mode capability declaration,
 * `transaction()` wiring, and `execute()` wiring onto `driver` (tasks
 * 1.1/1.3/1.4): both members send the pins as the wrapped driver's own
 * transaction's first statements, on the exact session the caller's
 * statement (or callback) then runs on, so the pins and the caller's own
 * work are provably inside the **same** transaction -- never a second
 * transaction wrapped around the caller's (one wrapped-driver
 * `transaction()` call per operation, not two). `execute` returns
 * whatever `session.execute(compiled)` resolves to -- the caller's own
 * rows, never the pins' own (empty) results, since those are never
 * returned from this function at all. The session-setup member lands in
 * 1.5. Module-internal (tasks.md "Settled contract details" ①): the
 * factory option (group 2) is the only way a caller reaches this, and
 * this package's own tests import the module directly, so isolation
 * testing is not an argument for a public export.
 *
 * `setupSession` (task 1.5) is a no-op: this path carries its pins per
 * transaction/execution instead (mirrors the other `session-state: false`
 * driver's own reasoning, `packages/neon/src/http.ts`), so there is
 * nothing left for a once-per-connection hook to do. This does **not**
 * suppress the wrapped driver's own checkout pin -- the vanilla driver
 * resolves that member on its own object, captured before this decorator
 * ever runs, so a decorator that returns a new object is never consulted
 * for it; its session-scoped `SET` still runs at checkout (see #531).
 * Suppressing it is not needed either: this path's correctness rests on
 * the transaction-local pins (1.2-1.4) alone, never on the wrapped
 * driver's own checkout behavior.
 */
export const poolerDriver = (driver: Driver): Driver => ({
	...driver,
	capabilities: CAPABILITIES,
	execute: (compiled) =>
		driver.transaction(async (session) => {
			await sendPins(session);
			return session.execute(compiled);
		}),
	transaction: <T>(callback: (session: DriverSession) => Promise<T>) =>
		driver.transaction(async (session) => {
			await sendPins(session);
			return callback(session);
		}),
	batch: refuseBatch,
	setupSession: async () => {},
});

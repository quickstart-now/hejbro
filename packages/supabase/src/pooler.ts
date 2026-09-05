import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";

/**
 * Fixed per tasks.md group 1 header / design.md: a transaction-mode
 * pooler (Supavisor) holds a real backend connection for the lifetime of
 * one `BEGIN`/`COMMIT` (`interactive-transactions: true`), but does not
 * reliably keep that same backend across separate transactions or
 * separate single-statement executions (`session-state: false`) --
 * measured against a local stack (design.md's Measurement record). An
 * explicit constant, never a spread of the wrapped driver's own
 * `capabilities`: a future capability key added to the contract must be a
 * type error here, not a silently inherited value.
 */
const CAPABILITIES: DriverCapabilities = {
	"interactive-transactions": true,
	"session-state": false,
	"prepared-statements": false,
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
	setupSession: async () => {},
});

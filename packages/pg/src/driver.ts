import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import type { CustomTypesConfig, PoolClient } from "pg";
import { Pool, types as pgTypes } from "pg";

/**
 * Fixed per owner decision ①, tasks.md group 5 header -- both capabilities
 * are `true` because a single physical TCP connection to Postgres
 * inherently supports `BEGIN`/`COMMIT` across round trips and preserves
 * `SET`-style session state across sequential statements on the same
 * connection.
 */
const CAPABILITIES: DriverCapabilities = {
	"interactive-transactions": true,
	"session-state": true,
};

/** Postgres's builtin `interval` type oid -- pg's own default parser turns it into a `PostgresInterval` object with no lossless way back to text (5.0 scout: `String()` gives `"[object Object]"`, and even `.toPostgres()` reorders/reformats fields rather than reproducing the original). */
const INTERVAL_OID = 1186;

/** Postgres's builtin `_interval` (`interval[]`) type oid (task 1.3, #320) -- pg's own default *array* parser would run the same lossy `PostgresInterval` conversion element-wise, one level up from {@link INTERVAL_OID}'s own problem. `@hejbro/query`'s own `array-text.ts` parses this raw array-literal text and converts each element via `parseInterval` instead (task 1.2). */
const INTERVAL_ARRAY_OID = 1187;

/** Postgres's builtin `_numeric` (`numeric[]`) type oid (task B2.1, #320) -- found via the postgres:17 integration proof (task 1.5): pg's own default *array* parser for this oid returns an array of already-`parseFloat`'d JS numbers (unlike scalar `numeric`, oid 1700, which pg already leaves as raw text), silently destroying the exact decimal text a `'string'`/`'bigint'`-mode `numeric[]` column needs. `bigint[]` (oid 1016) has no matching entry here -- pg's own default array parser already returns text elements for it, so no override is needed there. */
const NUMERIC_ARRAY_OID = 1231;

/**
 * The per-query `types` override every `execute`/session call sends
 * (owner decision ③, extended by tasks 1.3/B2.1). Passing `types` at all
 * replaces the client's own `TypeOverrides` wholesale rather than falling
 * back to it (5.0 scout, `pg/lib/client.js:743-744`) -- so this object has
 * to fully implement "oid 1186/1187/1231 are raw text, every other oid is
 * pg's own default" itself, never a blanket identity function that would
 * also defeat pg's int8/numeric/timestamptz/array parsing.
 */
const intervalPassthroughTypes: CustomTypesConfig = {
	getTypeParser: (oid, format) => {
		// `pg`'s own `CustomTypesConfig.getTypeParser` types `oid` as its
		// scalar-only `TypeId` union (no array oid, including 1187/1231, is
		// a member) -- widened to `number` here only for the comparison;
		// the real runtime value is always a plain oid number regardless of
		// what the (incomplete) upstream type declares.
		const oidValue = oid as number;
		if (
			oidValue === INTERVAL_OID ||
			oidValue === INTERVAL_ARRAY_OID ||
			oidValue === NUMERIC_ARRAY_OID
		) {
			return (value: string): string => value;
		}
		return pgTypes.getTypeParser(oid, format);
	},
};

/**
 * The queryable node-postgres exposes on both a `Pool` and a checked-out
 * `PoolClient` -- the minimal surface {@link makeSession} needs, kept
 * narrow so it never has to distinguish which one it was handed.
 */
type Queryable = Pick<Pool, "query">;

/**
 * Wraps `queryable` (a `Pool` or a single checked-out `PoolClient`) as a
 * {@link DriverSession} -- the one place a {@link CompileResult} becomes a
 * node-postgres query config, always carrying {@link intervalPassthroughTypes}
 * (task 5.3). Checkout pinning (task 5.5, {@link checkoutGuard}) happens
 * one level up, before a caller's statement ever reaches this function.
 */
const makeSession = (queryable: Queryable): DriverSession => ({
	execute: async (compiled: CompileResult) => {
		const result = await queryable.query({
			text: compiled.sql,
			values: [...compiled.params],
			types: intervalPassthroughTypes,
		});
		return result.rows;
	},
});

/**
 * The IntervalStyle pin (owner decision ④): fixed to `'postgres'` so the
 * arrival-shape table task 5.7 documents (interval as raw text via
 * {@link intervalPassthroughTypes}) holds regardless of the connecting
 * role's own `intervalstyle` default. The bytea_output pin (F1 owner
 * ruling, add-relational-reads group 2) is the same move for the same
 * reason: a nested read's `bytea` value JSON-encodes per this GUC, so
 * pinning `'hex'` is what makes the arrival shape deterministic.
 */
const SETUP_SESSION_SQL =
	"set intervalstyle to 'postgres'; set bytea_output to 'hex'";

/**
 * The `Driver.setupSession` member itself -- the actual session-setup
 * statement, sent through the same {@link makeSession}/`execute` path as
 * every other statement (task 5.5). `@hejbro/query` never calls this
 * directly (contract.ts's own tsdoc); {@link checkoutGuard} below is this
 * driver's own connection-acquisition code calling it, at the one moment
 * the contract requires: before any caller statement on a fresh physical
 * connection.
 */
const setupSession = async (session: DriverSession): Promise<void> => {
	await session.execute({ sql: SETUP_SESSION_SQL, params: [], kind: "sql" });
};

/**
 * Builds the per-driver checkout guard (owner decision ④): a `WeakSet`
 * scoped to one {@link buildDriver} call, not module-level -- two drivers
 * built over two different pools must never share pin state, and a
 * client's pinned-ness is meaningless once it's returned to a pool this
 * driver doesn't hold. Pins strictly before returning, so a caller that
 * awaits this function's result has the pin's own statement already
 * flushed on `client` ahead of anything it sends next (the ordering
 * decision ④ exists for -- a connect-listener-only pin is not awaited by
 * the pool and would race the first caller statement; 5.0 scout).
 *
 * `pinnedConnections.add(client)` runs only *after* `setupSession`
 * resolves (owner review defect fix) -- adding it beforehand recorded a
 * client as pinned even when the pin statement itself threw, so a later
 * checkout of that same physical connection would skip the pin and run
 * the caller's own statement unpinned, with no error at all. Marking a
 * client as pinned before the pool ever hands the same client to two
 * concurrent callers isn't a concern this ordering trades away either --
 * a pool never does that while one checkout is in flight.
 *
 * `getSetupSession` is read **at checkout time**, every checkout (task
 * 1.4, #323) -- never a `setupSession` reference captured once when this
 * guard is built. A preset decorator that replaces `driver.setupSession`
 * after `pgDriver()` returns (wrapping the original, e.g. to run
 * additional session setup) has to take effect on every checkout from
 * then on; closing over the original function reference here would make
 * that wrapper permanently unreachable from the checkout path, silently.
 */
const checkoutGuard = (
	getSetupSession: () => (session: DriverSession) => Promise<void>,
): ((client: PoolClient) => Promise<void>) => {
	const pinnedConnections = new WeakSet<PoolClient>();
	return async (client) => {
		if (pinnedConnections.has(client)) {
			return;
		}
		await getSetupSession()(makeSession(client));
		pinnedConnections.add(client);
	};
};

/**
 * Ends the transaction's one held client after the callback threw
 * (owner ruling (b), the ROLLBACK-itself-fails question): attempts
 * `ROLLBACK` and, if it succeeds, releases `client` back to the pool
 * normally. If `ROLLBACK` itself throws, the connection is left in an
 * unknown state -- returning it to the pool would let the *next*
 * caller inherit a broken session, so it is discarded instead via
 * `release(true)`, the same boolean-shorthand `pg-pool`'s own `_release`
 * treats identically to an `Error` (installed `pg-pool@3.14.0`
 * `index.js:392`: `if (err || ...)` before deciding to `_remove` rather
 * than idle the client -- verified against the installed source, 5.0
 * scout style). Exactly one `release()` call either way: calling it
 * twice throws (`pg-pool`'s own `_releaseOnce` guard, same source,
 * line 374), so this is the transaction path's single release site,
 * never paired with a `finally`. Never throws itself and never wraps or
 * annotates the caller's own error -- the ROLLBACK failure is
 * deliberately unobservable to the caller (owner ruling: zero new
 * contract surface), the caller's original error is `transaction()`'s
 * own `throw error` right after calling this.
 */
const releaseAfterFailedTransaction = async (
	client: PoolClient,
): Promise<void> => {
	const rolledBack = await client
		.query("ROLLBACK")
		.then(() => true)
		.catch(() => false);
	if (rolledBack) {
		client.release();
		return;
	}
	client.release(true);
};

/** Resolves either overload's argument to the one `Pool` {@link buildDriver} needs -- a string constructs and owns a fresh `Pool`, a `Pool` is used exactly as given (owner decisions ①/②). */
const resolvePool = (poolOrConnectionString: Pool | string): Pool => {
	if (typeof poolOrConnectionString === "string") {
		return new Pool({ connectionString: poolOrConnectionString });
	}
	return poolOrConnectionString;
};

/**
 * [task 2.6, 836/R4/R5, closes #864] Node treats an unhandled `'error'`
 * event as fatal -- without this listener, an idle pool client's own
 * failure (a terminated backend, a dropped connection) kills the whole
 * process before any `catch` in this driver or in the CLI above it ever
 * runs, regardless of whether a caller's own statement was in flight at
 * the time. A no-op is deliberate, not a missing feature: the statement
 * that was actually running still rejects through its own promise (`pg`'s
 * own client-level error path, unaffected by this listener), which is
 * what lets the ledger classifier above render it; this listener's only
 * job is keeping the process alive long enough for that rejection to be
 * observed. Called from {@link buildDriver}, not from {@link resolvePool}
 * (string-only) -- a caller-supplied `Pool` (the instance overload) can
 * be just as unlistened as a fresh one, so both overloads need it.
 */
const silenceUnhandledPoolError = (pool: Pool): void => {
	pool.on("error", () => {});
};

/**
 * [task 2.6, 836/R4/R5, closes #864] The Pool-level listener above only
 * covers a client that is *idle* (node-postgres's own documented scope
 * for `Pool`'s own `'error'` event) -- measured against a real server: a
 * checked-out client whose backend is terminated mid-query emits
 * `'error'` on the `PoolClient` itself ("Connection terminated
 * unexpectedly"), a second, separate unhandled-event crash the pool
 * listener does nothing for. A no-op here too, for the same reason: the
 * statement actually in flight still rejects through its own promise
 * (verified: silencing this event does not swallow that rejection),
 * this listener's only job is keeping the process alive long enough for
 * it to be observed. Called once per checkout, from both `execute` and
 * `transaction` -- the client object is different every time `pool.connect()`
 * resolves, so there is no one place to attach it once.
 */
const silencedClients = new WeakSet<PoolClient>();

const silenceUnhandledClientError = (client: PoolClient): void => {
	// Once per client object, not per checkout: the pool hands the same
	// physical connection back many times, and Node warns past ten
	// listeners on one emitter (measured: a healthy five-migration run
	// printed MaxListenersExceededWarning, D106 R1 N1).
	if (silencedClients.has(client)) {
		return;
	}
	silencedClients.add(client);
	client.on("error", () => {});
};

/**
 * A statement failure that means the connection itself is gone: a
 * connection-class SQLSTATE (08xxx), the server's own shutdown /
 * termination codes (57P01-57P03), or a driver-level error carrying no
 * server code at all ("Connection terminated unexpectedly"). Such a
 * client is discarded on release so the next checkout -- the ledger
 * classifier's own `select current_user` among them -- gets a live
 * connection (D106 R1 B1). An ordinary statement error leaves the
 * connection usable and the client goes back as it is.
 */
const connectionLost = (error: unknown): boolean => {
	const code = (error as { readonly code?: unknown } | null)?.code;
	if (typeof code !== "string") {
		return true;
	}
	return code.startsWith("08") || ["57P01", "57P02", "57P03"].includes(code);
};

const releaseAfterFailedStatement = (
	client: PoolClient,
	error: unknown,
): void => {
	if (connectionLost(error)) {
		client.release(true);
		return;
	}
	client.release();
};

/**
 * One driver shape shared by both {@link pgDriver} overloads -- built once
 * `pool` is settled, so the instance and connection-string forms can
 * never diverge in what they hand back. `ensurePinned` closes over
 * `() => driver.setupSession` (task 1.4) -- referencing the `const
 * driver` binding before its own declaration is fine here: the arrow
 * function is only ever *invoked* from inside `driver.execute`/
 * `driver.transaction`, i.e. strictly after this whole function has
 * returned `driver` fully initialized, so there is no TDZ hazard despite
 * the textual forward reference.
 */
const buildDriver = (pool: Pool): Driver & { readonly client: Pool } => {
	silenceUnhandledPoolError(pool);
	const ensurePinned = checkoutGuard(() => driver.setupSession);
	const driver: Driver & { readonly client: Pool } = {
		client: pool,
		capabilities: CAPABILITIES,
		execute: async (compiled) => {
			const client = await pool.connect();
			silenceUnhandledClientError(client);
			const rows = await (async () => {
				await ensurePinned(client);
				return await makeSession(client).execute(compiled);
			})().catch((error: unknown) => {
				releaseAfterFailedStatement(client, error);
				throw error;
			});
			client.release();
			return rows;
		},
		transaction: async (callback) => {
			const client = await pool.connect();
			silenceUnhandledClientError(client);
			try {
				await ensurePinned(client);
				await client.query("BEGIN");
				const result = await callback(makeSession(client));
				await client.query("COMMIT");
				client.release();
				return result;
			} catch (error) {
				await releaseAfterFailedTransaction(client);
				throw error;
			}
		},
		setupSession,
	};
	return driver;
};

/**
 * Instance form (owner decision ①): wraps a caller-owned `Pool` as-is --
 * `driver.client` is that same `pool` reference, never a copy, so there is
 * exactly one surface regardless of which overload built the driver.
 */
export function pgDriver(pool: Pool): Driver & { readonly client: Pool };
/**
 * Connection-string form (owner decision ②): constructs and owns a new
 * `Pool` from `connectionString`, exposed as `driver.client` -- never
 * auto-closed (Drizzle convention: pool lifetime = process lifetime).
 * Callers that need teardown call `driver.client.end()` themselves.
 */
export function pgDriver(
	connectionString: string,
): Driver & { readonly client: Pool };
export function pgDriver(
	poolOrConnectionString: Pool | string,
): Driver & { readonly client: Pool } {
	return buildDriver(resolvePool(poolOrConnectionString));
}

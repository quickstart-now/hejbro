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

/**
 * The per-query `types` override every `execute`/session call sends
 * (owner decision ③). Passing `types` at all replaces the client's own
 * `TypeOverrides` wholesale rather than falling back to it (5.0 scout,
 * `pg/lib/client.js:743-744`) -- so this object has to fully implement
 * "oid 1186 is raw text, every other oid is pg's own default" itself,
 * never a blanket identity function that would also defeat pg's
 * int8/numeric/timestamptz parsing.
 */
const intervalPassthroughTypes: CustomTypesConfig = {
	getTypeParser: (oid, format) => {
		if (oid === INTERVAL_OID) {
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
 * role's own `intervalstyle` default.
 */
const SETUP_SESSION_SQL = "set intervalstyle to 'postgres'";

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
 */
const checkoutGuard = (): ((client: PoolClient) => Promise<void>) => {
	const pinnedConnections = new WeakSet<PoolClient>();
	return async (client) => {
		if (pinnedConnections.has(client)) {
			return;
		}
		pinnedConnections.add(client);
		await setupSession(makeSession(client));
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

/** One driver shape shared by both {@link pgDriver} overloads -- built once `pool` is settled, so the instance and connection-string forms can never diverge in what they hand back. */
const buildDriver = (pool: Pool): Driver & { readonly client: Pool } => {
	const ensurePinned = checkoutGuard();
	return {
		client: pool,
		capabilities: CAPABILITIES,
		execute: async (compiled) => {
			const client = await pool.connect();
			try {
				await ensurePinned(client);
				return await makeSession(client).execute(compiled);
			} finally {
				client.release();
			}
		},
		transaction: async (callback) => {
			const client = await pool.connect();
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

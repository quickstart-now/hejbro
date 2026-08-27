import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import type { CustomTypesConfig } from "pg";
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
 * (task 5.3). Checkout pinning is added by task 5.5; this is the shape it
 * builds on.
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

/** Resolves either overload's argument to the one `Pool` {@link buildDriver} needs -- a string constructs and owns a fresh `Pool`, a `Pool` is used exactly as given (owner decisions ①/②). */
const resolvePool = (poolOrConnectionString: Pool | string): Pool => {
	if (typeof poolOrConnectionString === "string") {
		return new Pool({ connectionString: poolOrConnectionString });
	}
	return poolOrConnectionString;
};

/** One driver shape shared by both {@link pgDriver} overloads -- built once `pool` is settled, so the instance and connection-string forms can never diverge in what they hand back. */
const buildDriver = (pool: Pool): Driver & { readonly client: Pool } => ({
	client: pool,
	capabilities: CAPABILITIES,
	execute: (compiled) => makeSession(pool).execute(compiled),
	transaction: async (callback) => {
		const client = await pool.connect();
		try {
			return await callback(makeSession(client));
		} finally {
			client.release();
		}
	},
	setupSession: async () => {},
});

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

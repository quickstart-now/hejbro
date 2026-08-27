import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import { Pool } from "pg";

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

/**
 * The queryable node-postgres exposes on both a `Pool` and a checked-out
 * `PoolClient` -- the minimal surface {@link makeSession} needs, kept
 * narrow so it never has to distinguish which one it was handed.
 */
type Queryable = Pick<Pool, "query">;

/**
 * Wraps `queryable` (a `Pool` or a single checked-out `PoolClient`) as a
 * {@link DriverSession} -- the one place a {@link CompileResult} becomes a
 * node-postgres query config. `types`/checkout pinning are added by later
 * tasks in this group (5.3/5.5); this is the shape every one of them
 * builds on.
 */
const makeSession = (queryable: Queryable): DriverSession => ({
	execute: async (compiled: CompileResult) => {
		const result = await queryable.query({
			text: compiled.sql,
			values: [...compiled.params],
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

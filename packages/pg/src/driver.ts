import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import type { Pool } from "pg";

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

/**
 * The `pg` driver for `@hejbro/query` (owner decision ①): instance-based
 * factory over a caller-owned `Pool`, with nominal `pg` typing (`pg` is a
 * peerDependency; `@types/pg` supplies the types). The connection-string
 * convenience overload is task 5.2's.
 */
export const pgDriver = (pool: Pool): Driver & { readonly client: Pool } => ({
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

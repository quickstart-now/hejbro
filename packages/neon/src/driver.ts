import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import type {
	CustomTypesConfig,
	Pool,
	PoolClient,
} from "@neondatabase/serverless";
import { types as neonTypes } from "@neondatabase/serverless";
import { buildHttpDriver, type HttpQueryable } from "./http";
import { anonymousRole, authenticatedRole } from "./roles";

/**
 * Fixed per task 3.4, measured against a local proxy (`design.md`), not
 * assumed from the client's node-postgres compatibility: a Neon `Pool`
 * holds one physical connection open across round trips (`BEGIN`/
 * `COMMIT`) and preserves `SET`-style session state across sequential
 * statements on it, exactly like `@hejbro/pg`'s own `Pool`.
 */
const WS_CAPABILITIES: DriverCapabilities = {
	"interactive-transactions": true,
	"session-state": true,
};

/**
 * Same builtin oids `@hejbro/pg` pins (`packages/pg/src/driver.ts`) and
 * `http.ts` pins for its own path — duplicated a third time here, never
 * imported across either boundary: a preset may only use `@hejbro/query`'s
 * driver contract type, never a concrete driver implementation
 * (`.claude/rules/provider-preset.md`), and `http.ts`/`driver.ts` stay
 * independently reviewable per their own group's file list rather than
 * sharing a module across groups 2 and 3.
 */
const INTERVAL_OID = 1186;
const INTERVAL_ARRAY_OID = 1187;
const NUMERIC_ARRAY_OID = 1231;

/**
 * The `types` override every query sends over the WebSocket path (task
 * 3.6) — the same three oids `http.ts` forces to raw text, and the same
 * reason: Neon's `Pool` ships its own bundled parsers, not `pg-types`,
 * so without this a returned `interval` arrives as a parsed object and a
 * `numeric[]` as already-`parseFloat`'d numbers — the two outcomes the
 * contract's arrival-shape requirement forbids, one of them lossy
 * (`numeric`'s exact scale/precision). A different mechanism from
 * {@link setupSession}'s pins below: those decide what the *server*
 * renders; this decides whether the *client's* parser is bypassed.
 */
const intervalPassthroughTypes: CustomTypesConfig = {
	getTypeParser: (oid, format) => {
		const oidValue = oid as number;
		if (
			oidValue === INTERVAL_OID ||
			oidValue === INTERVAL_ARRAY_OID ||
			oidValue === NUMERIC_ARRAY_OID
		) {
			return (value: string): string => value;
		}
		return neonTypes.getTypeParser(oid, format);
	},
};

/**
 * The queryable surface {@link makeSession} needs from either a `Pool` or
 * a single checked-out `PoolClient` — kept narrow (mirrors
 * `@hejbro/pg`'s own `Queryable`) so this never has to distinguish which
 * one it was handed.
 */
type Queryable = Pick<Pool, "query">;

/** Wraps `queryable` as a {@link DriverSession}, always carrying {@link intervalPassthroughTypes} (task 3.6). Checkout pinning happens one level up, before a caller's statement ever reaches this function. */
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
 * The two session pins `@hejbro/pg` sends, sent here as one
 * semicolon-joined simple-query string — the WebSocket path is a real
 * physical connection, so (unlike the HTTP batch's own extended-protocol
 * members) node-postgres's simple-query form accepts both statements
 * together (task 3.4).
 */
const SETUP_SESSION_SQL =
	"set intervalstyle to 'postgres'; set bytea_output to 'hex'";

/** The `Driver.setupSession` member — sent through {@link makeSession}/`execute`, like every other statement. `@hejbro/query` never calls this directly; {@link checkoutGuard} below is this driver's own connection-acquisition code calling it. */
const setupSession = async (session: DriverSession): Promise<void> => {
	await session.execute({ sql: SETUP_SESSION_SQL, params: [], kind: "sql" });
};

/**
 * Builds the per-driver checkout guard (mirrors `@hejbro/pg`'s own): a
 * `WeakSet` scoped to one {@link buildWebSocketDriver} call, pinning
 * strictly before returning so a caller's next statement on the same
 * client is never sent unpinned.
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
 * (mirrors `@hejbro/pg`'s own ruling): a successful `ROLLBACK` releases
 * the client normally; a `ROLLBACK` that itself throws discards the
 * connection (`release(true)`) rather than returning a possibly-broken
 * session to the pool. Never throws itself and never wraps the caller's
 * own error.
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

/** Builds the WebSocket `Driver` — `neonDriver`'s (task 3.1) target when handed a Neon `Pool`. */
const buildWebSocketDriver = (pool: Pool): Driver => {
	const ensurePinned = checkoutGuard(() => driver.setupSession);
	const driver: Driver = {
		capabilities: WS_CAPABILITIES,
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
		// Neon's two Data API roles (task 3.5, consumes group 4's
		// constants) -- so db.as(...)'s fail-closed role allowlist admits
		// them without a declaration that grants them.
		contributedRoles: [authenticatedRole, anonymousRole],
	};
	return driver;
};

/**
 * `neonDriver`, overloaded on the client it is handed (task 3.1) -- a
 * Neon `Pool` selects the WebSocket path, the `neon()` query function
 * selects the HTTP path. The overload, not an option flag and never a
 * runtime probe, fixes the capability set: `typeof client === "function"`
 * is a check on the *value the caller already constructed*, decided
 * synchronously with no connection attempt of any kind -- never a query
 * against the database to learn what it supports (D95's rejected
 * alternative, `driver-contract`'s "instead of probing behavior at
 * runtime").
 */
export function neonDriver(pool: Pool): Driver;
export function neonDriver(sql: HttpQueryable): Driver;
export function neonDriver(client: Pool | HttpQueryable): Driver {
	if (typeof client === "function") {
		return buildHttpDriver(client);
	}
	return buildWebSocketDriver(client);
}

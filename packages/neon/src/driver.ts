import { createHash } from "node:crypto";
import type {
	CompileKind,
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import { buildHttpDriver, type HttpQueryable } from "./http";
import { anonymousRole, authenticatedRole } from "./roles";
import { intervalPassthroughTypes } from "./type-overrides";

/**
 * `interactive-transactions` and `session-state` are fixed `true` (task
 * 3.4, measured against a local proxy, `design.md`): a Neon `Pool` holds
 * one physical connection open across round trips (`BEGIN`/`COMMIT`) and
 * preserves `SET`-style session state across sequential statements on
 * it, exactly like `@hejbro/pg`'s own `Pool`. `prepared-statements` is
 * the caller's own (task 1.3, #303), stated through
 * {@link NeonDriverOptions}.
 */
const wsCapabilitiesFor = (preparedStatements: boolean): DriverCapabilities =>
	Object.freeze({
		"interactive-transactions": true,
		"session-state": true,
		"prepared-statements": preparedStatements,
	});

/** The second-argument shape `neonDriver`'s `Pool` overload accepts (task 1.3, #303, add-prepared-statements design Q3) -- the HTTP overload has no session to prepare in, so its own type offers none. */
export type NeonDriverOptions = {
	readonly preparedStatements?: boolean;
};

/**
 * `hejbro_` + the first 32 hex digits of SHA-256 over the statement text
 * (add-prepared-statements design Q4) -- duplicated from `@hejbro/pg`'s
 * own copy rather than imported: the provider-preset boundary
 * (`.claude/rules/provider-preset.md`) forbids this package from
 * depending on a concrete driver implementation, even for a pure helper.
 */
const preparedStatementName = (sql: string): string =>
	`hejbro_${createHash("sha256").update(sql).digest("hex").slice(0, 32)}`;

/**
 * The kinds a prepared statement may carry (mirrors `@hejbro/pg`'s own
 * `BUILT_KINDS`): an explicit allowlist, never `kind !== "sql"` -- a
 * future `CompileKind` this set doesn't yet name fails closed (sent
 * unnamed) rather than being named by default.
 */
const BUILT_KINDS: ReadonlySet<CompileKind> = new Set([
	"select",
	"insert",
	"update",
	"delete",
	"setOp",
]);

/**
 * The queryable surface {@link makeSession} needs from either a `Pool` or
 * a single checked-out `PoolClient` — kept narrow (mirrors
 * `@hejbro/pg`'s own `Queryable`) so this never has to distinguish which
 * one it was handed.
 */
type Queryable = Pick<Pool, "query">;

/** The `name` key {@link makeSession} spreads into a query config -- an empty object when the statement is not to be named (mirrors `@hejbro/pg`'s own helper), never `{ name: undefined }`. */
const nameForQueryConfig = (
	compiled: CompileResult,
	preparedStatements: boolean,
): { readonly name?: string } => {
	if (preparedStatements && BUILT_KINDS.has(compiled.kind)) {
		return { name: preparedStatementName(compiled.sql) };
	}
	return {};
};

/**
 * Wraps `queryable` as a {@link DriverSession}, always carrying
 * {@link intervalPassthroughTypes} (task 3.6). Checkout pinning happens
 * one level up, before a caller's statement ever reaches this function.
 * `preparedStatements` gates naming exactly as `@hejbro/pg`'s own
 * `makeSession` does (task 1.3, #303): built kinds only, never `"sql"`.
 */
const makeSession = (
	queryable: Queryable,
	preparedStatements: boolean,
): DriverSession => ({
	execute: async (compiled: CompileResult) => {
		const result = await queryable.query({
			text: compiled.sql,
			values: [...compiled.params],
			types: intervalPassthroughTypes,
			...nameForQueryConfig(compiled, preparedStatements),
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
 * client is never sent unpinned. `preparedStatements` is threaded to
 * {@link makeSession} exactly as every other call site does -- no
 * special case for the checkout pin; `nameForQueryConfig`'s own kind
 * check is what keeps the pin's `kind: "sql"` statement unnamed.
 */
const checkoutGuard = (
	getSetupSession: () => (session: DriverSession) => Promise<void>,
	preparedStatements: boolean,
): ((client: PoolClient) => Promise<void>) => {
	const pinnedConnections = new WeakSet<PoolClient>();
	return async (client) => {
		if (pinnedConnections.has(client)) {
			return;
		}
		await getSetupSession()(makeSession(client, preparedStatements));
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

/**
 * Builds the WebSocket `Driver` — `neonDriver`'s (task 3.1) target when
 * handed a Neon `Pool`. `client: pool` mirrors `@hejbro/pg`'s own
 * `pgDriver` exactly (#458 review round 1, task 1.10, lead ruling
 * 458/R3): this path holds a real connection, so the CLI's own
 * configured-driver factory can close it the same way it closes
 * `pgDriver`'s -- `driver.client.end()`. `preparedStatements` is the
 * caller's own answer (task 1.3, #303), threaded into every
 * {@link makeSession} call site.
 */
const buildWebSocketDriver = (
	pool: Pool,
	preparedStatements: boolean,
): Driver & { readonly client: Pool } => {
	const ensurePinned = checkoutGuard(
		() => driver.setupSession,
		preparedStatements,
	);
	const driver: Driver & { readonly client: Pool } = {
		client: pool,
		capabilities: wsCapabilitiesFor(preparedStatements),
		execute: async (compiled) => {
			const client = await pool.connect();
			try {
				await ensurePinned(client);
				return await makeSession(client, preparedStatements).execute(compiled);
			} finally {
				client.release();
			}
		},
		transaction: async (callback) => {
			const client = await pool.connect();
			try {
				await ensurePinned(client);
				await client.query("BEGIN");
				const result = await callback(makeSession(client, preparedStatements));
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
export function neonDriver(
	pool: Pool,
	options?: NeonDriverOptions,
): Driver & { readonly client: Pool };
export function neonDriver(
	sql: HttpQueryable,
): Driver & { readonly client: { end(): Promise<void> } };
export function neonDriver(
	client: Pool | HttpQueryable,
	options?: NeonDriverOptions,
):
	| (Driver & { readonly client: { end(): Promise<void> } })
	| (Driver & { readonly client: Pool }) {
	if (typeof client === "function") {
		return buildHttpDriver(client);
	}
	return buildWebSocketDriver(client, options?.preparedStatements === true);
}

import type { Role } from "@hejbro/core";
import type { CompileResult } from "../compile/compile";

/**
 * The context value a rendering contribution turns into statements
 * (#554/task 1.1). Declared independently of the query layer's own
 * execution-context type — this is the driver contract's own lower layer,
 * and it must not import from `db/` — but the two are kept structurally
 * identical on purpose, so any value the query layer resolves is already
 * assignable here with no adapter. `role` is optional from this layer's
 * first day: a rendering must already accept a role-less value before any
 * driver can declare its platform has no roles to name (task 1.2).
 */
export type ContextValue = {
	readonly role?: Role;
	readonly settings?: Readonly<Record<string, string>>;
};

/**
 * A pure mapping from a {@link ContextValue} to the statements that apply
 * it — never a side effect, never a connection, never a lookup (spec:
 * driver-contract, "A driver may contribute how a context becomes
 * statements"). The query layer is the only caller, and it is the only
 * thing that ever sends what this returns.
 */
export type ContextRendering = (
	context: ContextValue,
) => ReadonlyArray<CompileResult>;

/**
 * The two capabilities a driver may or may not support (owner decision ①,
 * tasks.md group 4 header, 2026-08-26). What is deliberately **not** listed
 * here: a mandatory prerequisite every driver must supply just to be a
 * driver at all (parameterized statement execution) — that lives on
 * {@link Driver} itself, unconditionally, never as a capability that could
 * read `false`.
 *
 * - `"interactive-transactions"`: the driver can hold one connection open
 *   across multiple round trips inside a `BEGIN`/`COMMIT` — required by
 *   the callback-scoped `transaction()` API (task 4.6) and by `db.as()`'s
 *   wrapping transaction (task 4.7).
 * - `"session-state"`: the driver preserves connection-scoped state (e.g.
 *   a `SET`-style setting) across sequential statements on the same
 *   connection — required for the IntervalStyle session pin (owner
 *   decision ④) to actually stick for more than one statement. The exact
 *   boundary of what counts as "preserved" is refined by the drivers that
 *   declare it (`@hejbro/pg`/Supabase, groups 5/6); this key only fixes
 *   its name and its presence requirement.
 */
export type DriverCapabilityKey = "interactive-transactions" | "session-state";

/**
 * Exhaustive per {@link DriverCapabilityKey} — deliberately not
 * `Partial<...>`, no optional (`?`) key, and no `??` fallback anywhere
 * this is read: a driver author who forgets a key gets a `tsc` error at
 * their own capabilities object literal (owner criterion ②), never a
 * silently-defaulted value. `false` is a first-class, equally-explicit
 * answer — read by task 4.2's `driver-missing-capability` check, which
 * always fails closed rather than treating `false` as "try anyway" (owner
 * criterion ③).
 */
export type DriverCapabilities = Readonly<Record<DriverCapabilityKey, boolean>>;

/**
 * One row a driver hands back — raw driver-shaped values, keyed by
 * column/alias name (`renderSelect`/`renderInsert`/etc. already emit
 * snake_case aliases, so this is the same key a Postgres client returns
 * unchanged). Turning this into the declared TypeScript shape (numeric
 * mode, `IntervalValue`, …) is task 4.4's job, not this contract's.
 */
export type DriverRow = Readonly<Record<string, unknown>>;

/**
 * The shape a single already-open connection executes against — the same
 * `execute` contract as {@link Driver} itself, scoped to one connection so
 * every statement inside a `transaction()` callback (task 4.6) or a
 * `db.as()` context (task 4.7) provably shares one connection instead of
 * each call silently borrowing a fresh one from a pool.
 */
export type DriverSession = {
	/**
	 * Executes one statement, taking {@link CompileResult} whole — never
	 * `sql`/`params` unpacked into separate positional arguments, so `kind`
	 * travels with the statement all the way to the driver boundary (task
	 * 4.3's byte-identical passthrough assertion depends on this).
	 */
	execute(compiled: CompileResult): Promise<ReadonlyArray<DriverRow>>;
};

/**
 * The contract every driver (`@hejbro/pg`, group 5; the Supabase driver,
 * group 6) implements. Structurally includes {@link DriverSession}'s
 * `execute` — the mandatory prerequisite owner criterion ① keeps out of
 * {@link DriverCapabilities} lives here instead, unconditionally.
 */
export type Driver = DriverSession & {
	readonly capabilities: DriverCapabilities;
	/**
	 * Runs `callback` inside one `BEGIN`/`COMMIT` on a single held
	 * connection (task 4.6): commits on normal return, rolls back and
	 * rethrows on a thrown error. Requires `"interactive-transactions"` —
	 * the capability check itself is task 4.2/4.6's job, not this
	 * contract's; a driver without the capability still has to implement
	 * this method (e.g. by always throwing `driver-missing-capability`
	 * before any statement is sent).
	 */
	transaction<T>(callback: (session: DriverSession) => Promise<T>): Promise<T>;
	/**
	 * Called by the driver's own connection-acquisition code on every new
	 * connection, before it is handed to any caller — the hook that pins
	 * IntervalStyle to `'postgres'` (owner decision ④). Contract
	 * requirement only here; `@hejbro/query` never calls this itself —
	 * groups 5/6 wire it into their own connection setup.
	 */
	setupSession(session: DriverSession): Promise<void>;
	/**
	 * Role names this driver/preset contributes to `db.as(context)`'s
	 * declared-role whitelist (task 4.7, owner decision ④) — e.g.
	 * Supabase's `anon`/`authenticated`/`service_role`, which exist
	 * whether or not the declared schema's own `grant`/policy mentions
	 * them. Without this, a minimal schema with no grants/policies would
	 * lock `asUser`/`asAnon` out of their own roles — the first failure a
	 * new Supabase user would hit. Optional and additive: most drivers
	 * (`@hejbro/pg`) contribute none; this contract only reserves the
	 * slot, group 6 is the first to populate it.
	 */
	readonly contributedRoles?: ReadonlyArray<string>;
	/**
	 * This platform's own way of turning a context into statements (task
	 * 1.1, #554) — a driver that contributes nothing is applied the query
	 * layer's default rendering instead (group 2's job, not this
	 * contract's). Optional and additive, same shape as
	 * {@link contributedRoles}: most drivers declare none.
	 */
	readonly renderContext?: ContextRendering;
};

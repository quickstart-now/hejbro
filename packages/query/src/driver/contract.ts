import type { Role } from "@hejbro/core";
import type { CompileResult } from "../compile/compile";

/**
 * `db.as(context)`'s own argument, and the shape a rendering contribution
 * turns into statements (#554/#555, task 2.10) — one type, declared here
 * because the driver contract is the lower layer (`db/context.ts` already
 * imports from this module; the reverse direction would be a layer
 * inversion) and re-exported from `db/context.ts` for its public-surface
 * home (`@hejbro/query`'s own index still exports it from there, path
 * unchanged). `role` is optional: a context naming one must already be in
 * the caller's declared-role whitelist (`db/context.ts`'s own
 * `assertContextRole`, which this contract has no visibility into); a
 * context naming none is only admitted on a driver that declares its
 * platform role-less (`Driver.roleLessPlatform` below) — a rendering must
 * already accept that role-less shape before any driver can declare it
 * (task 1.2).
 */
export type DbContext = {
	readonly role?: Role;
	readonly settings?: Readonly<Record<string, string>>;
};

/**
 * A pure mapping from a {@link DbContext} to the statements that apply
 * it — never a side effect, never a connection, never a lookup (spec:
 * driver-contract, "A driver may contribute how a context becomes
 * statements"). The query layer is the only caller, and it is the only
 * thing that ever sends what this returns.
 */
export type ContextRendering = (
	context: DbContext,
) => ReadonlyArray<CompileResult>;

/**
 * The four capabilities a driver may or may not support (owner decision ①,
 * tasks.md group 4 header, 2026-08-26; extended to a third key by task 1.1,
 * #303; extended to a fourth by task 1.1, #486). What is deliberately
 * **not** listed here: a mandatory prerequisite every driver must supply
 * just to be a driver at all (parameterized statement execution) — that
 * lives on {@link Driver} itself, unconditionally, never as a capability
 * that could read `false`.
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
 * - `"prepared-statements"`: the driver names its built statements so a
 *   connection parses and plans each distinct text once (add-prepared-
 *   statements spec). Requires session state to survive across
 *   executions to be meaningful, but is declared independently: a path
 *   without session state (a transaction-mode pooler) MUST declare this
 *   `false` regardless of what its base driver would otherwise support.
 * - `"batched-transactions"`: the driver runs a pre-assembled list of
 *   statements as one transaction, in one round trip where possible,
 *   returning one row list per member ({@link Driver.batch}). Says
 *   nothing about a held session or about interactivity: a batch never
 *   carries state to another batch, and no member may depend on an
 *   earlier member's rows (#486).
 */
export type DriverCapabilityKey =
	| "interactive-transactions"
	| "session-state"
	| "prepared-statements"
	| "batched-transactions";

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
	 * Runs `statements` as one transaction, returning each member's row
	 * list in the same order (task 1.1, #486). Mandatory on every `Driver`
	 * regardless of `"batched-transactions"`: a driver that declares the
	 * capability `false` still implements this member, by throwing
	 * `driver-missing-capability` before sending anything (the pattern
	 * `transaction` above already uses on a non-interactive driver).
	 */
	batch(
		statements: ReadonlyArray<CompileResult>,
	): Promise<ReadonlyArray<ReadonlyArray<DriverRow>>>;
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
	/**
	 * Declares that this platform has no roles a context could name (task
	 * 1.2, #554) — fixed data on the driver value, never discovered by
	 * querying the server. Absence means the opposite: "this platform has
	 * roles", so no existing driver changes meaning by staying silent. A
	 * context that names a role is still validated against the whitelist
	 * regardless of this declaration (group 2's job, not this contract's).
	 */
	readonly roleLessPlatform?: true;
	/**
	 * Declares that no statement may run against this driver without an
	 * execution context (task 1.3, #554) — fixed data on the driver value,
	 * never inferred from the platform or an observed error. Absence
	 * leaves existing behavior exactly as it is. The refusal this enables
	 * belongs to the query layer (group 3's job, not this contract's): a
	 * driver cannot satisfy this declaration on its own, since the point
	 * is refusing before a statement exists to send.
	 */
	readonly contextRequired?: true;
};

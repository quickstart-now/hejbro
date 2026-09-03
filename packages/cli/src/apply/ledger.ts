import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";

/*
 * [design, task 1.1] The error codes `add-apply-engine` raises, settled
 * here in one place rather than in whichever group first raises each one
 * -- `add-check-schema` paid for the alternative (task 2.1 there: "a code
 * born elsewhere still gets its shape from this list"), and this file is
 * the first one this change writes. Every code SHALL originate through
 * `@hejbro/core`'s `hejbroError`/`throwHejbroError` factory:
 * `scripts/check-next-marker.mjs` walks only those call sites, so a code
 * built as a bare `{ code }` object literal would silently escape the
 * `Next:` gate. **This file raises none of them** -- `ledger.ts`'s own
 * functions never throw a `HejbroError`; an absent table is a state
 * (`{ exists: false }`), not a failure. The list below is for the groups
 * that do, kept here so a code born there still gets its shape from one
 * place.
 *
 * [design, task 7.2, settled] A prefix names the OPERATION a code belongs
 * to, never the one command that happened to mint it first. `check-*`
 * stays `check-*` because checking is the only thing `hejbro check` does
 * -- command and operation coincide there. Applying does not coincide
 * with any one command: `migrate`, `reset`, and `raise` all apply DDL
 * inside a transaction, through the same `execute.ts` machinery, so a
 * code that names one of them (a `migrate-`-prefixed one) is wrong the
 * moment a second command can raise it -- `hejbro raise` failing under a
 * code that names `migrate` is the exact defect this rule exists to
 * refuse (owner/lead review, #613; the same defect `check-*` reused
 * as-is would have shipped into `migrate`, task 7.2's own originating
 * question). The apply-wide family is prefixed `apply-*`.
 * Two carve-outs: a condition only ONE command can ever raise keeps that
 * command's own name (`reset-*`, `raise-not-empty` -- no other command
 * can raise them, so there is no mismatch to cause); a condition named
 * for itself, not for any command, also stays as it is
 * (`migration-requires-split`, core-owned).
 *
 * - `apply-ledger-orphan-row` (group 2, task 2.2) -- the ledger records
 *   a migration the repository does not contain. `apply-*`, not
 *   `migrate-*`: `status` reports this same fact and `migrate` refuses
 *   with it -- two commands, one operation (reading the ledger against
 *   the chain).
 * - `apply-ledger-out-of-order` (group 2, task 2.2) -- the ledger
 *   records a migration the chain orders after one it does not record.
 *   Same `apply-*` reasoning as its sibling above. Exactly these two:
 *   `tasks.md`'s 2.2 originally listed a third member ("a gap") beside
 *   them, flagged here as a discrepancy against the delta's own two
 *   scenarios and since corrected in `tasks.md` itself -- a ledger
 *   holding 0001 and 0003 but not 0002 *is* the second member (a
 *   recorded migration the chain orders after an unrecorded one), not a
 *   separate state.
 * - `apply-failed` (group 3, task 3.3) -- a migration failed to apply;
 *   names the file and carries the database's own code and message.
 *   `apply-*`: `raise` reuses `execute.ts`'s `applyMigration` wholesale
 *   (group 6) and this is its own generic failure path too.
 * - `apply-unsafe-new-enum-value` (group 3, task 3.3) -- the database's
 *   `55P04` translated into hejbro's own terms (regenerate; the enum
 *   change lands in its own migration). `apply-*` for the same reason as
 *   `apply-failed`.
 * - `apply-transaction-control` (group 3, task 3.5) -- a migration
 *   contains its own `begin`/`commit`/`rollback` and is refused before
 *   anything is sent. `apply-*` for the same reason as `apply-failed`.
 * - `apply-missing-capability` (group 7, task 7.3) -- the driver does not
 *   declare `interactive-transactions`. Distinct from `@hejbro/query`'s
 *   own `driver-missing-capability` (not a `HejbroError`, D57: query-
 *   layer packages don't extend it) -- this is the CLI's own coded
 *   refusal, checked before a transaction-needing command ever calls
 *   `transaction()`, not a catch of that lower-layer throw. `apply-*`:
 *   `migrate`, `reset`, and `raise` all need this capability; `status`
 *   does not (it only reads).
 * - `apply-connection-missing` / `apply-driver-missing` /
 *   `apply-connection-failed` (group 7, task 7.2) -- connection
 *   acquisition, mechanically shared with `check/driver.ts` (`--url`,
 *   then `DATABASE_URL`, then a coded refusal; the driver imported
 *   dynamically; a `select 1` probe) but under this apply-owned code
 *   family, not `check-*`'s -- `check-*`'s own three codes (and their
 *   message text, which also names `hejbro check` by name) are
 *   untouched, since checking is still the operation that mints them.
 *   `resolveConnectionString`/`loadCheckDriver`/`assertConnected`/
 *   `withCheckConnection` take a required `commandName` (no default, the
 *   same reason `execute.ts`'s own `nextCommand` is required) so the
 *   message text names whichever of the four commands actually failed to
 *   connect.
 * - `reset-not-confirmed` (group 5, task 5.2) -- `reset` refused without
 *   the confirmation it requires; names what would have been dropped.
 *   Kept `reset-*`: no other command can raise this refusal.
 * - `reset-migration-not-singular` (group 4 rework, #610) -- an internal
 *   invariant, not a spec scenario: `reset`'s own DDL is built by
 *   reusing `generateMigrations` with an empty declaration set
 *   (`apply/reset.ts`'s `resetMigrationSql`), and a drop-only run can
 *   never trigger `engine/split.ts`'s own transaction-boundary condition
 *   today -- but that guarantee belongs to today's split trigger, not to
 *   this function, so it is asserted (exactly one migration comes back)
 *   rather than assumed. Kept `reset-*`: only `reset` ever calls
 *   `resetMigrationSql`.
 * - `raise-not-empty` (group 6, task 6.2) -- `raise` refuses a database
 *   that already holds declared objects (spec). Two layers report the
 *   identical fact under this one code, discovered two different ways:
 *   (1) a cheap precheck, before the apply transaction ever opens, when
 *   the ledger already records at least one applied migration; (2) from
 *   inside that same transaction, when the ledger could not have known --
 *   a database with a colliding object but no ledger row (set up by
 *   another tool, or by hand) -- surfaced as the server's own already-
 *   exists failure (Postgres's `duplicate_*` family, class 42),
 *   translated rather than left as a raw driver dump. This translation is
 *   `raise`-owned, not shared with `migrate` (owner/lead review, #612):
 *   the same server code means a different next step by caller (`raise`:
 *   "point at an empty database"; `migrate`: investigate why the ledger
 *   and the database disagree), and only `raise` has a spec sentence to
 *   translate it into -- `migrate`'s own already-exists failures stay on
 *   `execute.ts`'s fully generic `apply-failed` path, same as any other
 *   unclassified error, until (if ever) a future group's own delta text
 *   earns that translation its own place. Prefix is `apply/raise.ts`'s
 *   own module name, which 7.1 settled as the command's own name too
 *   (`hejbro raise` -- the delta spec's own verb, "A database can be
 *   raised from a snapshot SQL file"), so module, command, and code
 *   prefix now agree; `tasks.md`'s file list still shows the placeholder
 *   `commands/db-up.ts` it was written with.
 * - `raise-file-missing` (group 7, task 7.7, `commands/raise.ts`) --
 *   `--file` is required and has no default (unlike `generate`, `raise`
 *   has no declaration entry to fall back to). Kept `raise-*`: only
 *   `raise` takes this flag.
 * - No code for "a second runner waits" (DD) -- waiting is not a
 *   failure. Task 7.4 names "a lock held by another runner" only as "a
 *   candidate" for its own exit-code answer, not a settled one; no code
 *   is minted for it here.
 * - `migration-requires-split` (group 4 rework, #610) -- the one code in
 *   this list `@hejbro/core` itself raises, not this package: a
 *   `generateMigration` run that adds an enum value and emits it inside
 *   the same transaction cannot be expressed as one migration file, so
 *   it is refused with a `Next:` naming `generateMigrations` (the entry
 *   point that returns the one-or-two-file split) rather than silently
 *   returning half the run. Listed here anyway -- centralizing "every
 *   code born through `hejbroError` gets its shape from one list" was
 *   always about the code, not about which package throws it.
 */

const LEDGER_SCHEMA = "hejbro";
const LEDGER_TABLE = "migration_ledger";
const QUALIFIED_LEDGER_TABLE = `"${LEDGER_SCHEMA}"."${LEDGER_TABLE}"`;

/**
 * [task 16.1, D106 M7] How a ledger row entered the ledger -- a column,
 * not a filename convention: a filename-encoded marker would collide
 * with "a row identifies its migration by the full filename" (task
 * 1.1's own key choice) and is stringly (a marker embedded in the same
 * field a caller also matches on for identity). All three values name
 * the *action* that produced the row, one axis, not a mix of "how it
 * arrived" and "what kind of file it is": `"applied"` is an ordinary
 * migration `migrate` ran; `"registered"` is a baseline migration
 * recorded without its statements ever being sent (task 12.2, #624) --
 * named to match `migrate`'s own report line ("registered ... baseline
 * migration(s)", never "applied"), so the word a user reads and the word
 * the ledger stores are the same one (D106 correction round, second
 * pass: the first draft called this value `"baseline"`, which is a file
 * kind, not an action, and disagreed with the report text); `"raised"`
 * is the one row `hejbro raise` writes for the snapshot SQL file it
 * applied. Nothing is published yet, so this column carries no migration
 * path and no default -- a row with an unstated origin would silently
 * mean something, and there is no compatibility obligation this early to
 * justify choosing what.
 */
export type LedgerOrigin = "applied" | "registered" | "raised";

const LEDGER_ORIGINS: ReadonlyArray<LedgerOrigin> = [
	"applied",
	"registered",
	"raised",
];

/** `'applied', 'registered', 'raised'` -- the `origin` column's own check constraint, built from {@link LEDGER_ORIGINS} so the two can never drift apart. */
const LEDGER_ORIGIN_CHECK_LIST = LEDGER_ORIGINS.map(
	(origin) => `'${origin}'`,
).join(", ");

/** Postgres's own code for "the relation named in this statement does not exist" -- the one failure `readLedger`/`recordAppliedMigration` interpret themselves; every other failure is not this module's to classify and is rethrown as-is. */
const UNDEFINED_TABLE = "42P01";

const isUndefinedTableError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === UNDEFINED_TABLE;

const exec = (
	session: DriverSession,
	sql: string,
	params: ReadonlyArray<unknown> = [],
): Promise<ReadonlyArray<DriverRow>> =>
	session.execute({ sql, params, kind: "sql" } satisfies CompileResult);

/**
 * Creates the ledger's schema and table if either is absent -- idempotent
 * by construction (`if not exists` on both), so a caller running this
 * once per apply run (spec: "SHALL run once per apply run, not once per
 * migration") pays nothing extra when the database already has it. The
 * schema is `"hejbro"`, kept separate from anything a project declares,
 * so nothing this tool creates for its own bookkeeping can collide with
 * a user's own schema of the same name.
 *
 * Ordering comes from `"id"`, an identity column the database assigns --
 * never a value this code supplies (spec: "a row's ordering SHALL come
 * from a value the database assigns"). `"applied_at"` is a
 * server-evaluated timestamp for a human reading the table directly --
 * nothing here reads it back for ordering.
 */
export const bootstrapLedger = async (
	session: DriverSession,
): Promise<void> => {
	await exec(session, `create schema if not exists "${LEDGER_SCHEMA}"`);
	await exec(
		session,
		`create table if not exists ${QUALIFIED_LEDGER_TABLE} (\n\t"id" bigint generated always as identity primary key,\n\t"filename" text not null unique,\n\t"origin" text not null check ("origin" in (${LEDGER_ORIGIN_CHECK_LIST})),\n\t"applied_at" timestamptz not null default now()\n)`,
	);
};

/** [task 16.1, D106 M7] One ledger row, as `readLedger` reads it back: the filename it identifies its migration by, and how it entered the ledger. */
export type LedgerRow = {
	readonly filename: string;
	readonly origin: LedgerOrigin;
};

/**
 * `exists: false` and `exists: true, applied: []` are different facts
 * (spec: "A ledger table that does not exist and a ledger table that
 * holds no rows are different facts") -- the second is what a registered
 * baseline leaves behind, the first is a database this tool has never
 * touched.
 */
export type LedgerState =
	| { readonly exists: false }
	| { readonly exists: true; readonly applied: ReadonlyArray<LedgerRow> };

/**
 * Reads which migrations the ledger records, in the database's own order
 * (the `"id"` identity column `bootstrapLedger` created), each with the
 * origin it was recorded under. `exists: false` only when the read
 * itself fails with Postgres's own "relation does not exist" (42P01);
 * any other failure is not this function's to interpret and is rethrown
 * unchanged.
 */
export const readLedger = async (
	session: DriverSession,
): Promise<LedgerState> => {
	try {
		const rows = await exec(
			session,
			`select "filename", "origin" from ${QUALIFIED_LEDGER_TABLE} order by "id"`,
		);
		return {
			exists: true,
			applied: rows.map((row) => ({
				filename: String(row.filename),
				origin: String(row.origin) as LedgerOrigin,
			})),
		};
	} catch (error) {
		if (isUndefinedTableError(error)) {
			return { exists: false };
		}
		throw error;
	}
};

/**
 * [task 11.1, #620] True when the ledger already records `filename` --
 * meant to be read from inside the caller's own transaction, after that
 * transaction holds `execute.ts`'s advisory lock, so nothing can insert
 * the row between this read and whatever the caller decides next (that
 * ordering guarantee lives in the caller, not here; this function is
 * just the targeted read). A single-row probe (`limit 1`), not a reuse
 * of `readLedger`'s full-table read -- the caller only ever needs one
 * filename's answer, and the caller already holds a lock a full-table
 * read has no need to widen. Table absence reads as "not recorded"
 * (mirrors `readLedger`'s own `{exists:false}` leniency): a caller
 * reaching this always ran `bootstrapLedger` first, so the table is
 * expected to exist, but this function claims nothing stronger than what
 * it can itself observe.
 */
export const isMigrationRecorded = async (
	session: DriverSession,
	filename: string,
): Promise<boolean> => {
	try {
		const rows = await exec(
			session,
			`select 1 from ${QUALIFIED_LEDGER_TABLE} where "filename" = $1 limit 1`,
			[filename],
		);
		return rows.length > 0;
	} catch (error) {
		if (isUndefinedTableError(error)) {
			return false;
		}
		throw error;
	}
};

/**
 * Records one migration as applied, identified by its full filename --
 * never its version prefix alone (spec: `verify`'s own duplicate message
 * is why; a tool keyed on the prefix can only ever apply one of a
 * colliding pair). `origin` (task 16.1, D106 M7) is required, never
 * defaulted: a caller SHALL say how this row entered the ledger, the
 * same reasoning that keeps this column itself `not null` with no
 * default at the database layer.
 *
 * This is also the whole of the baseline path (spec: "A baseline is
 * registered rather than run"): this function has no parameter for a
 * migration's own SQL, so calling it can never send that SQL. Registering
 * a baseline is calling this once, with the baseline migration's
 * filename, `origin: "registered"`, and nothing else.
 */
export const recordAppliedMigration = async (
	session: DriverSession,
	filename: string,
	origin: LedgerOrigin,
): Promise<void> => {
	await exec(
		session,
		`insert into ${QUALIFIED_LEDGER_TABLE} ("filename", "origin") values ($1, $2)`,
		[filename, origin],
	);
};

/**
 * [group 5, task 5.3] Empties the ledger -- every row, not a selected
 * subset: `reset` drops every declared object, so nothing this tool
 * applied is still standing afterward, and the next `migrate` run SHALL
 * apply the chain from its beginning (spec). There is no partial state
 * to express, so there is nothing to select.
 *
 * Deletes rows, never the table: `reset` destroys only what the
 * declarations describe (spec, "A reset destroys only what the
 * declarations manage"), and the ledger table is hejbro's own
 * bookkeeping, not a declared object -- the same reasoning that keeps
 * `reset` off a project's unmanaged inventory keeps it off this table
 * too. A ledger that was never bootstrapped (42P01) is already empty of
 * rows in every sense that matters here, so this is a silent no-op for
 * it, the same leniency `readLedger` already extends to an absent table.
 */
export const clearLedger = async (session: DriverSession): Promise<void> => {
	try {
		await exec(session, `delete from ${QUALIFIED_LEDGER_TABLE}`);
	} catch (error) {
		if (isUndefinedTableError(error)) {
			return;
		}
		throw error;
	}
};

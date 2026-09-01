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
 * - `migrate-ledger-orphan-row` (group 2, task 2.2) -- the ledger records
 *   a migration the repository does not contain.
 * - `migrate-ledger-out-of-order` (group 2, task 2.2) -- the ledger
 *   records a migration the chain orders after one it does not record.
 *   Exactly these two: `tasks.md`'s 2.2 originally listed a third member
 *   ("a gap") beside them, flagged here as a discrepancy against the
 *   delta's own two scenarios and since corrected in `tasks.md` itself --
 *   a ledger holding 0001 and 0003 but not 0002 *is* the second member
 *   (a recorded migration the chain orders after an unrecorded one), not
 *   a separate state.
 * - `migrate-failed` (group 3, task 3.3) -- a migration failed to apply;
 *   names the file and carries the database's own code and message.
 * - `migrate-unsafe-new-enum-value` (group 3, task 3.3) -- the database's
 *   `55P04` translated into hejbro's own terms (regenerate; the enum
 *   change lands in its own migration).
 * - `migrate-transaction-control` (group 3, task 3.5) -- a migration
 *   contains its own `begin`/`commit`/`rollback` and is refused before
 *   anything is sent.
 * - `migrate-missing-capability` (group 7, task 7.3) -- the driver does
 *   not declare `interactive-transactions`. Distinct from
 *   `@hejbro/query`'s own `driver-missing-capability` (not a
 *   `HejbroError`, D57: query-layer packages don't extend it) -- this is
 *   the CLI's own coded refusal, checked before `migrate` ever calls
 *   `transaction()`, not a catch of that lower-layer throw.
 * - Connection acquisition (group 7, task 7.2, `[design]`) -- **left
 *   open on purpose**, as an input to that task rather than a decision
 *   made here: reusing `packages/cli/src/check/driver.ts`'s codes as-is
 *   means `hejbro migrate` answers `error[check-connection-missing]`
 *   (proposal, fork DF); minting `migrate-connection-missing` /
 *   `migrate-driver-missing` / `migrate-connection-failed` is the
 *   alternative. Both are legal shapes; 7.2 picks.
 * - `reset-not-confirmed` (group 5, task 5.2) -- `reset` refused without
 *   the confirmation it requires; names what would have been dropped.
 * - `db-up-not-empty` (group 6, task 6.2) -- refuses raising a snapshot
 *   into a database that already holds declared objects. Prefix is the
 *   placeholder command name `tasks.md`'s own file list uses
 *   (`commands/db-up.ts`) -- the real command name is group 7's
 *   `[design]` (7.1, proposal's `⟦DESIGN⟧`); this code's prefix moves
 *   with whatever 7.1 settles on.
 * - No code for "a second runner waits" (DD) -- waiting is not a
 *   failure. Task 7.4 names "a lock held by another runner" only as "a
 *   candidate" for its own exit-code answer, not a settled one; no code
 *   is minted for it here.
 */

const LEDGER_SCHEMA = "hejbro";
const LEDGER_TABLE = "migration_ledger";
const QUALIFIED_LEDGER_TABLE = `"${LEDGER_SCHEMA}"."${LEDGER_TABLE}"`;

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
		`create table if not exists ${QUALIFIED_LEDGER_TABLE} (\n\t"id" bigint generated always as identity primary key,\n\t"filename" text not null unique,\n\t"applied_at" timestamptz not null default now()\n)`,
	);
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
	| { readonly exists: true; readonly applied: ReadonlyArray<string> };

/**
 * Reads which migrations the ledger records, in the database's own order
 * (the `"id"` identity column `bootstrapLedger` created). `exists: false`
 * only when the read itself fails with Postgres's own "relation does not
 * exist" (42P01); any other failure is not this function's to interpret
 * and is rethrown unchanged.
 */
export const readLedger = async (
	session: DriverSession,
): Promise<LedgerState> => {
	try {
		const rows = await exec(
			session,
			`select "filename" from ${QUALIFIED_LEDGER_TABLE} order by "id"`,
		);
		return {
			exists: true,
			applied: rows.map((row) => String(row.filename)),
		};
	} catch (error) {
		if (isUndefinedTableError(error)) {
			return { exists: false };
		}
		throw error;
	}
};

/**
 * Records one migration as applied, identified by its full filename --
 * never its version prefix alone (spec: `verify`'s own duplicate message
 * is why; a tool keyed on the prefix can only ever apply one of a
 * colliding pair).
 *
 * This is also the whole of the baseline path (spec: "A baseline is
 * registered rather than run"): this function has no parameter for a
 * migration's own SQL, so calling it can never send that SQL. Registering
 * a baseline is calling this once, with the baseline migration's
 * filename, and nothing else.
 */
export const recordAppliedMigration = async (
	session: DriverSession,
	filename: string,
): Promise<void> => {
	await exec(
		session,
		`insert into ${QUALIFIED_LEDGER_TABLE} ("filename") values ($1)`,
		[filename],
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

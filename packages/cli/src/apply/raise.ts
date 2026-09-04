import { hejbroError, throwHejbroError } from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import type { Migration } from "./execute";
import {
	applyMigration,
	codeSuffix,
	driverErrorCode,
	driverErrorReason,
} from "./execute";
import type { LedgerState } from "./ledger";
import { asLedgerAccessFailure, bootstrapLedger, readLedger } from "./ledger";
import {
	throwLedgerReadFailure,
	throwLedgerWriteFailure,
} from "./ledger-diagnostics";
import {
	assertLedgerNotOccupied,
	probeLedgerIdentity,
} from "./ledger-identity";

/**
 * [task 6.1, design] Raise's own input, generalized on purpose (spec,
 * proposal "What changes"): a snapshot SQL file's already-read text plus
 * the name it is recorded under, and an empty database. The file's origin
 * is not part of the contract -- that a consumer repository commonly
 * vendors one from elsewhere is a convention and a config default, this
 * module builds nothing that depends on it. Reading the file from disk is
 * group 7's job (wiring the real command); this module never touches the
 * filesystem, and never parses the SQL it is handed (proposal: "It does
 * not parse SQL") -- both are exactly why this is `execute.ts`'s own
 * `Migration` shape, not a new one: opaque text plus the name the ledger
 * records it under.
 */
export type SnapshotFile = Migration;

/**
 * [task 6.2, design, layer 1 of 2] Refuses before the apply transaction
 * ever opens, when the ledger already records at least one applied
 * migration -- "this database has hejbro history already" is the one
 * fact raise can check without reading the catalog (proposal: "It does
 * not validate the database's shape"). `readLedger`'s own
 * `{exists:false}` vs `{exists:true, applied:[]}` distinction collapses
 * here on purpose: neither carries real history, so both are legal
 * targets.
 *
 * What this precheck cannot see: a database that already has a colliding
 * object but no ledger row at all -- set up by another tool, or by hand,
 * never by hejbro. That gap is not silently accepted: it surfaces from
 * inside the apply transaction itself, translated under this same
 * `raise-not-empty` code (layer 2, see {@link applyRaise}) rather than
 * left as a raw driver dump.
 */
export const assertDatabaseEmptyByLedger = (
	ledgerState: LedgerState,
	commandName: string,
): void => {
	if (!ledgerState.exists || ledgerState.applied.length === 0) {
		return;
	}
	throwHejbroError(
		"raise-not-empty",
		`this database already has ${ledgerState.applied.length} migration(s) recorded in its ledger. Next: point \`${commandName}\` at an empty database, or run \`hejbro migrate\` instead if this database is meant to catch up on the existing chain.`,
	);
};

/**
 * Postgres's own `duplicate_*` family (class 42): the target already has
 * an object this statement tried to create. Kept as a set, not a single
 * code, because "already exists" fans out by object kind -- schema
 * (`42P06`), table/view/index (`42P07`), type/constraint/role/sequence
 * (`42710`), function (`42723`), database (`42P04`) -- the same way this
 * project's own DDL fans out by kind. [G6, #612] Lives here, not in
 * `execute.ts`: only raise owns a spec sentence for this failure (6.2,
 * "refuses with a coded error"), so the classification travels with the
 * one caller that translates it (owner/lead review) rather than sitting
 * in the shared module as a concept `migrate` has no use for.
 */
const ALREADY_EXISTS_CODES = new Set([
	"42P04",
	"42P06",
	"42P07",
	"42710",
	"42723",
]);

/** `error`'s own `.cause`, or `undefined` -- `error` is whatever `applyMigration` threw (a `HejbroError`, which attaches the raw driver failure as `.cause`, `execute.ts`'s own doc comment on `throwApplyFailure`), never re-derived by parsing that error's rendered message text. */
const causeOf = (error: unknown): unknown => {
	if (error instanceof Error) {
		return error.cause;
	}
	return undefined;
};

/**
 * [task 6.2, design, layer 2 of 2] `applyMigration`'s own failure is
 * generic by default (`execute.ts` has no notion of "already exists" --
 * owner/lead review, #612) -- this reads its `.cause` (the raw driver
 * error `throwApplyFailure` attached) to tell a genuine already-exists
 * collision apart from any other apply failure, structurally, never by
 * re-parsing the rendered message. A cause that does not classify as
 * already-exists (or that is not this shape at all -- e.g. the
 * transaction-control refusal, thrown before any driver call ever
 * happens and so never wrapped with a cause) is rethrown unchanged: this
 * function only ever narrows, never invents, a diagnosis.
 *
 * Reuses `raise-not-empty` rather than minting a second code -- see
 * {@link assertDatabaseEmptyByLedger}'s own doc comment: both layers
 * report the identical fact, discovered two different ways.
 */
const rethrowIfAlreadyExists = (
	fileName: string,
	commandName: string,
	error: unknown,
): never => {
	const cause = causeOf(error);
	const code = driverErrorCode(cause);
	if (code === null || !ALREADY_EXISTS_CODES.has(code)) {
		throw error;
	}
	const reason = driverErrorReason(cause);
	throw hejbroError(
		"raise-not-empty",
		`applying "${fileName}" failed${codeSuffix(code)}: ${reason}. This database already has an object this file would create. Next: point \`${commandName}\` at an empty database, or skip it if this one is already set up the way you meant.`,
	);
};

/**
 * [task 6.1/6.3] Stands an empty database up from a snapshot SQL file.
 * [harden-ledger-identity, 783/R2] Probes the ledger's identity first --
 * an occupied name refuses before `readLedger`, `bootstrapLedger`, or the
 * file's own statement ever run. Reads the ledger next (task 16.5, D106
 * m4) -- `readLedger` already tolerates a table that does not exist yet
 * (`{exists: false}`, the same leniency `bootstrapLedger` itself does not
 * need to run for) -- and refuses if it already has history (6.2, layer
 * 1) *before* this call creates anything: a database refused by the
 * ledger precheck no longer gains `hejbro.migration_ledger` as a souvenir
 * of the refusal. This does
 * NOT hold for a layer-2 refusal (D106 m4) -- bootstrap below still runs,
 * idempotently, before the catalog collision that layer discovers is
 * ever reached, so that refusal's own database keeps the (empty) ledger
 * table and schema this call created. Only once past the ledger-history
 * check does it bootstrap (idempotent, run once here since this module
 * is raise's own single entry point -- `ledger.ts`'s own "once per apply
 * run, not once per migration") and reuse `execute.ts`'s own
 * `applyMigration` for everything else the spec asks: one transaction,
 * the advisory lock, the parameterless send, the transaction-control
 * precondition, and the ledger row (6.3) -- the same mechanism `migrate`
 * uses, not a second one, so "applies nothing" on refusal is the
 * transaction's own guarantee rather than something this module
 * re-implements. A failure from that call is re-classified by
 * {@link rethrowIfAlreadyExists} (6.2, layer 2) before it escapes this
 * function.
 *
 * The ledger row `applyMigration` writes uses `snapshotFile.fileName`
 * verbatim -- raise derives no chain-shaped name for it the way
 * `generate`/`baseline` do (`migrationFileName`'s prefix strategies never
 * run here) -- and its `origin` column (task 16.1, D106 M7) is
 * `"raised"`, which is now the mechanism that tells a raised row apart
 * from a migrate-arrived one; a raised filename's own shape was never a
 * reliable signal (`--file` accepts any path) and is not read as one
 * anywhere in this module.
 */
export const applyRaise = async (
	driver: Driver,
	snapshotFile: SnapshotFile,
	commandName: string,
): Promise<void> => {
	const identity = await probeLedgerIdentity(driver, commandName);
	assertLedgerNotOccupied(identity, commandName);
	try {
		const ledgerState = await readLedger(driver);
		assertDatabaseEmptyByLedger(ledgerState, commandName);
		await bootstrapLedger(driver);
		try {
			await applyMigration(driver, snapshotFile, commandName);
		} catch (error) {
			rethrowIfAlreadyExists(snapshotFile.fileName, commandName, error);
		}
	} catch (error) {
		// [task 1.6, harden-ledger-diagnostics] Every ledger statement this
		// function sends (or that applyMigration sends on its behalf, task
		// 1.4) reaches this one catch tagged or not tagged: `readLedger`'s
		// own read, `bootstrapLedger`'s own write, and, escaping
		// `rethrowIfAlreadyExists` untouched, the apply transaction's own
		// ledger row and recheck. `assertDatabaseEmptyByLedger`'s and
		// `rethrowIfAlreadyExists`'s own `raise-not-empty` throws carry no
		// tag and pass through unchanged -- this is the completeness check
		// tasks.md 1.6 names: no ledger statement failure escapes `raise`
		// unclassified.
		const tag = asLedgerAccessFailure(error);
		if (tag === null) {
			throw error;
		}
		if (tag.direction === "read") {
			await throwLedgerReadFailure(driver, error, commandName);
		} else {
			await throwLedgerWriteFailure(
				driver,
				error,
				commandName,
				snapshotFile.fileName,
			);
		}
	}
};

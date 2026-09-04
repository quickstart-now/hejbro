import { hejbroError } from "@hejbro/core";
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
 * `Next:` gate. An absent table is a state (`{ exists: false }`), not a
 * failure -- `readLedger`/`isMigrationRecorded` never classify that case
 * into either of this module's own two codes below. The list below is
 * for every group's codes, kept here so a code born elsewhere still gets
 * its shape from one place.
 *
 * - `apply-ledger-unreadable` (harden-ledger-diagnostics, task 1.2) -- a
 *   read `exec` sent to the ledger failed for any reason other than the
 *   table not existing yet. `apply-*`: `status`, `migrate` and `raise`
 *   all read the ledger, and `execute.ts`'s in-transaction recheck
 *   (`isMigrationRecorded`) shares the same code (design.md D4) since a
 *   caller three layers up cannot tell a recheck's own read failure from
 *   any other read failure except by the tag `exec` already attaches.
 *   Thrown by {@link throwLedgerReadFailure}, the one place either caller
 *   turns the tag into this code.
 * - `apply-ledger-unwritable` (harden-ledger-diagnostics, task 1.3) -- a
 *   write `exec` sent to the ledger failed: its bootstrap, a row it
 *   tried to record, or the clearing of its rows. `apply-*`: `migrate`
 *   and `raise` both bootstrap and record rows, `reset` clears them.
 *   Thrown by {@link throwLedgerWriteFailure}.
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
 * - `apply-ledger-occupied` (harden-ledger-identity, task 1.2) -- the
 *   relation at the ledger's name is not hejbro's ledger. `apply-*`:
 *   `migrate`, `status`, `reset` and `raise` all raise it for the same
 *   one operation (judging the ledger's identity), thrown by
 *   `ledger-identity.ts`'s own `assertLedgerNotOccupied`.
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

/** Shared with `ledger-identity.ts`'s probe -- one spelling of the ledger's schema and table name, never a second one assembled elsewhere. */
export const LEDGER_SCHEMA = "hejbro";
export const LEDGER_TABLE = "migration_ledger";
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

/**
 * [task 1.1, design.md D4] Which way a statement `exec` sent moved data --
 * every ledger-touching command's read is answered by a grant or by
 * another role, every write additionally by the ledger's own shape, so a
 * caller three layers up (`execute.ts`, task 1.4) needs this to choose
 * between the two new codes without reading SQL text back.
 */
export type LedgerAccessDirection = "read" | "write";

/**
 * [task 1.1, design.md D3] Which of `exec`'s own callers sent the
 * statement, in the words task 1.3's diagnostic text reuses verbatim for
 * a write's site; a read is always `"read"` except the recheck `exec`
 * runs from inside the apply transaction, kept distinct because it is the
 * one read a write-side caller (`execute.ts`) can also see.
 */
export type LedgerAccessSite =
	| "bootstrap"
	| "row"
	| "recheck"
	| "clear"
	| "read";

/**
 * [task 1.1, design.md D4] What `exec` attaches to a statement's own
 * failure -- never a `HejbroError` (this module mints none, its own file
 * header states why); `cause` is the server's unmodified error, so a
 * caller that needs its `.code`/`.message`/`.detail` reads them from
 * there, never from this wrapper.
 */
export type LedgerAccessFailure = {
	readonly direction: LedgerAccessDirection;
	readonly site: LedgerAccessSite;
	readonly cause: unknown;
};

const isLedgerAccessFailure = (
	error: unknown,
): error is LedgerAccessFailure & Error =>
	error instanceof Error &&
	"direction" in error &&
	"site" in error &&
	"cause" in error;

/**
 * [task 1.1, design.md D4] Reads back the tag {@link exec} attaches on
 * failure -- `null` for anything that isn't one of this module's own
 * tagged failures. The one way a caller (`readLedger`/`isMigrationRecorded`
 * here, `execute.ts` three layers up) tells a ledger-statement failure
 * apart from anything else, structurally rather than by matching a
 * message or SQL text back.
 */
export const asLedgerAccessFailure = (
	error: unknown,
): LedgerAccessFailure | null => {
	if (!isLedgerAccessFailure(error)) {
		return null;
	}
	return { direction: error.direction, site: error.site, cause: error.cause };
};

/**
 * [task 1.1, design.md D4] The one path every statement this module sends
 * to the ledger goes through. On failure, rethrows the server's error
 * tagged with `direction`/`site` (never summarized, never classified into
 * a `HejbroError` here -- that is task 1.2/1.3's job, one layer up) so a
 * caller can tell which statement failed without reading its SQL or
 * message back.
 */
const exec = async (
	session: DriverSession,
	sql: string,
	params: ReadonlyArray<unknown>,
	direction: LedgerAccessDirection,
	site: LedgerAccessSite,
): Promise<ReadonlyArray<DriverRow>> => {
	try {
		return await session.execute({
			sql,
			params,
			kind: "sql",
		} satisfies CompileResult);
	} catch (error) {
		throw Object.assign(new Error("ledger statement failed"), {
			direction,
			site,
			cause: error,
		});
	}
};

/**
 * The database's own `.code`, mirroring `execute.ts`'s own
 * `driverErrorCode` -- duplicated rather than imported: `execute.ts`
 * already imports from this module, and importing back would make the
 * two modules circular. Both copies read the identical node-postgres
 * field; a future drift between them is a small, generic function to
 * keep in sync, not a shared-module refactor this task's file list
 * covers.
 */
const driverErrorCode = (error: unknown): string | null => {
	if (error === null || typeof error !== "object" || !("code" in error)) {
		return null;
	}
	const code = (error as { readonly code?: unknown }).code;
	if (typeof code === "string") {
		return code;
	}
	return null;
};

/** Mirrors `execute.ts`'s own `driverErrorReason` -- see {@link driverErrorCode}'s own comment on the duplication. */
const driverErrorReason = (error: unknown): string => {
	if (error instanceof Error && error.message !== "") {
		return error.message;
	}
	const code = driverErrorCode(error);
	if (code !== null) {
		return code;
	}
	return String(error);
};

/** [task 1.3, design.md D3] node-postgres's own `.column` field on a constraint-violation error (e.g. `23502`) -- `null` when absent, never parsed from the message text. */
const driverErrorColumn = (error: unknown): string | null => {
	if (error === null || typeof error !== "object" || !("column" in error)) {
		return null;
	}
	const column = (error as { readonly column?: unknown }).column;
	if (typeof column === "string" && column !== "") {
		return column;
	}
	return null;
};

/**
 * [task 1.2, design.md D2] `select current_user` on `session`, only ever
 * called after a statement on that same session already failed -- one
 * extra read, on the failure path only. `null`, never rethrown, when this
 * read itself fails too (D2 option 1: the diagnostic omits the role
 * clause rather than fail twice).
 */
const currentRole = async (session: DriverSession): Promise<string | null> => {
	try {
		const rows = await session.execute({
			sql: 'select current_user as "currentUser"',
			params: [],
			kind: "sql",
		} satisfies CompileResult);
		const value = rows[0]?.currentUser;
		if (typeof value === "string") {
			return value;
		}
		return null;
	} catch {
		return null;
	}
};

/**
 * [task 1.2, design.md D2/D3] `hejbro reads its own ledger...`'s role
 * clause and grant subject -- `role` is `null` exactly when {@link currentRole}
 * couldn't learn it, the one condition both halves branch on together so
 * they never disagree (a role clause naming someone the `Next:` line then
 * tells a stranger to grant).
 */
const roleClause = (role: string | null): string => {
	if (role === null) {
		return "";
	}
	return ` as the role "${role}"`;
};

const grantSubject = (role: string | null): string => {
	if (role === null) {
		return "the connecting role";
	}
	return "that role";
};

/** `" (CODE)"`, or `""` when the failure carried no `.code` -- mirrors `execute.ts`'s own `codeSuffix`, duplicated for the same reason as {@link driverErrorCode}. */
const codeParen = (code: string | null): string => {
	if (code === null) {
		return "";
	}
	return ` (${code})`;
};

/**
 * [task 1.2, design.md D3] Turns a read failure `exec` tagged into
 * `apply-ledger-unreadable`, naming the ledger, the connecting role
 * (best-effort, D2) and the server's own SQLSTATE and message
 * unsummarized, ending with a `Next:` line offering the grant or the
 * applying role. `session` is the same one the failing statement ran
 * on -- reused for the one extra read {@link currentRole} sends, never a
 * second connection. `failure` is whatever `exec` threw (or, defensively,
 * a raw driver error if a caller already unwrapped it); either way the
 * server's own error is what ends up on `.cause`, never this function's
 * own tag object.
 */
export const throwLedgerReadFailure = async (
	session: DriverSession,
	failure: unknown,
	commandName: string,
): Promise<never> => {
	const tag = asLedgerAccessFailure(failure);
	const cause = tag?.cause ?? failure;
	const role = await currentRole(session);
	const code = driverErrorCode(cause);
	const reason = driverErrorReason(cause);
	throw Object.assign(
		hejbroError(
			"apply-ledger-unreadable",
			`\`${QUALIFIED_LEDGER_TABLE}\` could not be read${roleClause(role)}${codeParen(code)}: ${reason}. hejbro reads its own ledger before it can say what this database has applied. Next: grant ${grantSubject(role)} \`select\` on \`${QUALIFIED_LEDGER_TABLE}\` and \`usage\` on the \`"${LEDGER_SCHEMA}"\` schema, or connect as the role that applied, then rerun \`${commandName}\`.`,
		),
		{ cause },
	);
};

/**
 * [task 1.3, design.md D3] The write site named in words -- free for the
 * caller to supply since only it knows which statement it sent (D3's own
 * measured reason: `42501`/`23505`/etc. are byte-identical across all
 * three write sites, so the server's answer alone never says which one).
 * `rowFilename` is read exactly when `site === "row"`, the one site whose
 * words name a file.
 */
const writeSiteWords = (
	site: LedgerAccessSite,
	rowFilename: string | undefined,
): string => {
	if (site === "bootstrap") {
		return "the ledger's own bootstrap";
	}
	if (site === "clear") {
		return "the clearing of the ledger's rows";
	}
	return `the row recording "${rowFilename}"`;
};

/** [task 1.3, design.md D3] The rollback sentence, one per write site -- see {@link writeSiteWords}'s own note on `rowFilename`. */
const writeRollbackSentence = (
	site: LedgerAccessSite,
	rowFilename: string | undefined,
): string => {
	if (site === "bootstrap") {
		return "no migration statement was sent.";
	}
	if (site === "clear") {
		return "the drops ran in the same transaction and rolled back with it, so every declared object is still standing.";
	}
	return `the migration ran in the same transaction and rolled back with it, so nothing from "${rowFilename}" is applied and the ledger records nothing new.`;
};

/** Postgres's own code for a not-null violation -- the one SQLSTATE design.md D3 gives its own sentence, the #823 shape: the ledger's own row insert refused because `id` lost the identity/default `bootstrapLedger` declares. */
const NOT_NULL_VIOLATION = "23502";

/**
 * [task 1.3, design.md D3] `23502`'s own sentence -- named from the
 * driver's own `.column` field when the server supplied one, never
 * parsed from the message text; a generic subject when it did not
 * (design.md leaves this row-shape to this task, not settled verbatim).
 */
const identityLostSentence = (cause: unknown): string => {
	const column = driverErrorColumn(cause);
	if (column === null) {
		return "A column in the ledger has no identity and no default; the ledger hejbro bootstraps declares its `id` column `bigint generated always as identity`, so hejbro never supplies that value itself.";
	}
	return `The ledger's "${column}" column has no identity and no default; the ledger hejbro bootstraps declares it \`bigint generated always as identity\`, so hejbro never supplies that value itself.`;
};

/** `" <sentence>"` for `23502` (D3's one named branch), `""` for every other code -- the leading space matches where {@link throwLedgerWriteFailure} splices it in, right after the rollback sentence's own trailing period. */
const writeExtraSentence = (code: string | null, cause: unknown): string => {
	if (code === NOT_NULL_VIOLATION) {
		return ` ${identityLostSentence(cause)}`;
	}
	return "";
};

/**
 * [task 1.3, design.md D3] Turns a write failure `exec` tagged into
 * `apply-ledger-unwritable`, naming the ledger, the connecting role
 * (best-effort, D2, same as {@link throwLedgerReadFailure}), which write
 * was refused in words, the rollback, and (only for `23502`) the
 * identity/default sentence -- ending with a `Next:` line. `rowFilename`
 * is the caller's own migration filename, needed only when the tagged
 * failure's site is `"row"`.
 */
export const throwLedgerWriteFailure = async (
	session: DriverSession,
	failure: unknown,
	commandName: string,
	rowFilename?: string,
): Promise<never> => {
	const tag = asLedgerAccessFailure(failure);
	const cause = tag?.cause ?? failure;
	const site = tag?.site ?? "row";
	const role = await currentRole(session);
	const code = driverErrorCode(cause);
	const reason = driverErrorReason(cause);
	const extraSentence = writeExtraSentence(code, cause);
	throw Object.assign(
		hejbroError(
			"apply-ledger-unwritable",
			`writing \`${QUALIFIED_LEDGER_TABLE}\` was refused${roleClause(role)}${codeParen(code)}: ${reason}. What was refused is ${writeSiteWords(site, rowFilename)}, hejbro's own bookkeeping — ${writeRollbackSentence(site, rowFilename)}${extraSentence} Next: resolve what the error above describes on the ledger itself (hejbro never grants and never alters it), then rerun \`${commandName}\`.`,
		),
		{ cause },
	);
};

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
	await exec(
		session,
		`create schema if not exists "${LEDGER_SCHEMA}"`,
		[],
		"write",
		"bootstrap",
	);
	await exec(
		session,
		`create table if not exists ${QUALIFIED_LEDGER_TABLE} (\n\t"id" bigint generated always as identity primary key,\n\t"filename" text not null unique,\n\t"origin" text not null check ("origin" in (${LEDGER_ORIGIN_CHECK_LIST})),\n\t"applied_at" timestamptz not null default now()\n)`,
		[],
		"write",
		"bootstrap",
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
			[],
			"read",
			"read",
		);
		return {
			exists: true,
			applied: rows.map((row) => ({
				filename: String(row.filename),
				origin: String(row.origin) as LedgerOrigin,
			})),
		};
	} catch (error) {
		const tag = asLedgerAccessFailure(error);
		if (tag !== null && isUndefinedTableError(tag.cause)) {
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
			"read",
			"recheck",
		);
		return rows.length > 0;
	} catch (error) {
		const tag = asLedgerAccessFailure(error);
		if (tag !== null && isUndefinedTableError(tag.cause)) {
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
		"write",
		"row",
	);
};

/**
 * [D106 R1, B1, #753 reopened; harden-ledger-identity, 783/R2] Deletes
 * every ledger row -- never the table, which is hejbro's own bookkeeping,
 * not a declared object. Carries no leniency for an absent table: the one
 * caller (`applyReset`, which probes the ledger's identity before the
 * transaction this runs inside) SHALL already know the table is the real
 * ledger, so a failure here is a genuine one and SHALL propagate rather
 * than be swallowed into a silent no-op that leaves the transaction's
 * earlier statements (the drops) uncommitted but unreported. A race that
 * drops the table between that probe and this delete surfaces its own
 * 42P01 uncaught, into `reset-drop-failed` -- honest about the race
 * rather than silently rolled back the way B1 was.
 */
export const clearLedgerRows = async (
	session: DriverSession,
): Promise<void> => {
	await exec(
		session,
		`delete from ${QUALIFIED_LEDGER_TABLE}`,
		[],
		"write",
		"clear",
	);
};

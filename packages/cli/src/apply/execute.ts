import { hejbroError, throwHejbroError } from "@hejbro/core";
import type { CompileResult, Driver } from "@hejbro/query";
import { recordAppliedMigration } from "./ledger";

/** One migration ready to apply -- the filename the ledger keys on (G1) and the file's own SQL text, already read from disk by the caller (group 7's job; this module touches no filesystem). */
export type Migration = {
	readonly fileName: string;
	readonly sql: string;
};

const exec = (
	sql: string,
	params: ReadonlyArray<unknown> = [],
): CompileResult => ({ sql, params, kind: "sql" });

/**
 * A fixed, arbitrary advisory-lock key every `migrate` run contends for --
 * `sha256("hejbro:migrate")`'s first 8 hex characters as an integer
 * (4095729033), not a value with any meaning of its own. Fixed and
 * derived rather than picked so two independent readers of this file
 * compute the same number and can confirm it did not drift; any other
 * constant would have worked equally well, as long as it is the same one
 * every run.
 */
const MIGRATE_LOCK_KEY = 4_095_729_033;

/**
 * [design, task 3.4] `pg_advisory_xact_lock`, sent as its own statement
 * inside the same transaction the migration applies in -- never a
 * session-scoped lock. Measured (proposal DD): a session lock taken
 * through a bare `execute()` looks held under sequential calls only
 * because an idle pool happens to reuse one connection; under concurrent
 * calls the lock can be held by a connection a later call never gets.
 * `pg_advisory_xact_lock` has no such gap: it releases automatically when
 * the transaction ends, including when it ends by failing, which is
 * exactly `transaction()`'s own contract.
 */
const LOCK_STATEMENT = exec("select pg_advisory_xact_lock($1)", [
	MIGRATE_LOCK_KEY,
]);

/**
 * Matches a single-quoted string literal starting at `text[from]` (which
 * SHALL be a `'`), returning the index just past its closing quote. SQL
 * escapes an embedded quote by doubling it (`''`), so a `'` immediately
 * followed by another `'` is not a close -- recursion (not a loop, house
 * style) past the pair finds the real one. An unterminated literal
 * returns `text.length`: a malformed file is not this function's problem
 * to diagnose further, only not to hang on.
 */
const singleQuoteEnd = (text: string, from: number): number => {
	const nextQuote = text.indexOf("'", from);
	if (nextQuote === -1) {
		return text.length;
	}
	if (text[nextQuote + 1] === "'") {
		return singleQuoteEnd(text, nextQuote + 2);
	}
	return nextQuote + 1;
};

/** A dollar-quote opening delimiter (`$$`, `$tag$`, ...) starting at index 0 of `text`, or `null` when `text` does not open with one. */
const DOLLAR_QUOTE_OPEN = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** The next single-quote or dollar-quote-open marker in `text`, whichever comes first. */
const QUOTE_START = /'|\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * [design, task 3.5] Returns `sql` with every single-quoted string
 * literal and every dollar-quoted body ($$...$$ / $tag$...$tag$) removed
 * -- the "where does it sit" distinction the precondition needs (a
 * `commit` inside a `plpgsql` function body is not a statement), without
 * building a statement splitter: this never learns where one statement
 * ends and the next begins, only where quoted text starts and ends,
 * which `renderBanner`'s own dollar-quote usage shows is a strictly
 * smaller problem than the one this project has already declined to
 * solve (see "It does not parse SQL", the proposal's own refusal). A
 * `--` line comment is stripped the same way, for the same reason a
 * comment mentioning "commit" in prose is not a statement either.
 *
 * `/* ... *\/` block comments are deliberately NOT stripped -- scope
 * kept narrow on purpose. The failure direction this leaves is the safe
 * one: a real `begin`/`commit`/`rollback` hidden inside a block comment
 * would make this precondition wrongly REFUSE a migration that is
 * actually safe to apply (a false refusal, annoying but inert -- nothing
 * is ever applied on that path), never wrongly ACCEPT one that truly
 * contains a live transaction-control statement (which would be the
 * dangerous direction). hejbro's own generator never emits a block
 * comment either, so this only costs a hand-edited file's author an
 * extra `Next:` round trip, not a silent hazard.
 */
export const stripQuotedAndCommentedText = (sql: string): string => {
	const lineCommentIndex = sql.indexOf("--");
	const quoteMatch = QUOTE_START.exec(sql);
	const nextSpecial = earlierIndex(lineCommentIndex, quoteMatch?.index ?? -1);

	if (nextSpecial === -1) {
		return sql;
	}
	const before = sql.slice(0, nextSpecial);

	if (nextSpecial === lineCommentIndex) {
		const newlineIndex = sql.indexOf("\n", nextSpecial);
		if (newlineIndex === -1) {
			return before;
		}
		return before + stripQuotedAndCommentedText(sql.slice(newlineIndex));
	}

	const rest = sql.slice(nextSpecial);
	if (rest.startsWith("'")) {
		const closeIndex = singleQuoteEnd(sql, nextSpecial + 1);
		return before + stripQuotedAndCommentedText(sql.slice(closeIndex));
	}

	const dollarMatch = DOLLAR_QUOTE_OPEN.exec(rest);
	if (dollarMatch === null) {
		// QUOTE_START matched a lone "$" that isn't a real dollar-quote
		// open (no closing "$") -- not quoting anything; keep scanning
		// past it rather than treating the rest of the file as quoted.
		return `${before}$${stripQuotedAndCommentedText(rest.slice(1))}`;
	}
	const delimiter = dollarMatch[0];
	const closeIndex = rest.indexOf(delimiter, delimiter.length);
	if (closeIndex === -1) {
		return before;
	}
	return (
		before +
		stripQuotedAndCommentedText(rest.slice(closeIndex + delimiter.length))
	);
};

/** The smaller of two indices, treating `-1` ("not found") as larger than any real index -- never a ternary (house style). */
const earlierIndex = (a: number, b: number): number => {
	if (a === -1) {
		return b;
	}
	if (b === -1) {
		return a;
	}
	if (a < b) {
		return a;
	}
	return b;
};

const TRANSACTION_CONTROL = /\b(begin|commit|rollback)\b/i;

/**
 * The transaction-control statement `migration.sql` contains outside any
 * quoted or commented text, or `null` when there is none. Reachability
 * (settled with the planner before implementing this): a hand-edited
 * file that injects `begin`/`commit` without changing what the migration
 * declares to change is NOT caught by chain verification (2.3) -- the
 * banner's `parent`/`snapshot` hashes are hashes of the *declaration
 * snapshot*, computed by the CLI from the snapshot state, never a hash
 * of the migration file's own raw SQL text (`migration-file.ts`'s own
 * `BannerHashes` doc: "the normalized-snapshot sha256 before and after
 * this migration"). So a file's raw bytes can change in ways that never
 * touch its recorded hashes, and this precondition is load-bearing, not
 * dead code guarding an unreachable state.
 */
const findTransactionControlStatement = (sql: string): string | null => {
	const match = TRANSACTION_CONTROL.exec(stripQuotedAndCommentedText(sql));
	if (match === null) {
		return null;
	}
	return match[0];
};

/**
 * Refuses before anything is sent -- no transaction is even opened for a
 * migration that fails this (spec: "it is refused ... and nothing is
 * applied"). Pure text, no I/O: cheaper than opening a connection only
 * to refuse.
 */
const assertNoTransactionControl = (migration: Migration): void => {
	const found = findTransactionControlStatement(migration.sql);
	if (found === null) {
		return;
	}
	throwHejbroError(
		"apply-transaction-control",
		`"${migration.fileName}" contains its own "${found}" statement, outside any string literal or function body. hejbro's generator never emits one; a hand-edited file can, and the consequences are silent rather than loud (a mid-file commit ends the transaction's atomicity with no error, and a failed begin poisons the pooled connection for the calls after it). Next: remove the statement from "${migration.fileName}" and rerun \`hejbro migrate\`.`,
	);
};

/** Postgres's own code for "this transaction refuses to use a value this same transaction just added to an enum type" (PG12+; measured on 17). */
const UNSAFE_NEW_ENUM_VALUE = "55P04";

/**
 * The database's own `.code`, when the failure carries one as a plain
 * string -- never assumed, since not every failure this module sees
 * originates from a driver (e.g. a bug inside this module itself would
 * throw a bare `Error` with no `.code`). Exported: [G6, #612] `raise.ts`
 * reuses this exact classification on `error.cause` (see
 * {@link throwApplyFailure}'s own doc comment) rather than re-deriving
 * it, or worse, re-parsing a rendered message for the code this already
 * read structurally.
 */
export const driverErrorCode = (error: unknown): string | null => {
	if (error === null || typeof error !== "object" || !("code" in error)) {
		return null;
	}
	const code = (error as { readonly code?: unknown }).code;
	if (typeof code === "string") {
		return code;
	}
	return null;
};

/** The database's own reason text, never an empty string -- mirrors `check/error-message.ts`'s own `describeDriverError` (not exported there, so re-derived here rather than reaching into that module's private surface; both read the same driver error shape). Exported for the same reason as {@link driverErrorCode}. */
export const driverErrorReason = (error: unknown): string => {
	if (error instanceof Error && error.message !== "") {
		return error.message;
	}
	const code = driverErrorCode(error);
	if (code !== null) {
		return code;
	}
	return String(error);
};

/** `" (CODE)"`, or `""` when there is no code -- exported alongside {@link driverErrorCode}/{@link driverErrorReason} so a caller building its own message from `error.cause` renders the code the identical way this module does. */
export const codeSuffix = (code: string | null): string => {
	if (code === null) {
		return "";
	}
	return ` (${code})`;
};

/**
 * [design, task 3.3; parameterized for G6, #612] Names the file, carries
 * the database's own code and message unsummarized, and ends with
 * `Next:`. `nextCommand` is the exact command a caller should rerun once
 * the failure above is fixed -- required, not defaulted: `applyMigration`
 * has no production caller yet (group 7 wires `migrate`, group 6 wires
 * `raise`), so a default would be a silent channel for the wrong command
 * name to ship the moment a second caller appears, the same shape of gap
 * `@hejbro/core`'s public surface just closed in the G4 rework.
 *
 * `55P04` gets its own translation (spec): the file was written before
 * this change's generator started separating an enum-value addition from
 * its use, and the remedy is to regenerate so the split happens. That is
 * the ONLY named exception this module's own failure spec (task 3.3)
 * lists -- an "already exists" failure has no sentence here (owner/lead
 * review, #612: only `raise` owns one, and it belongs in `raise.ts`, not
 * folded into this shared, caller-agnostic path), so it stays on the
 * fully generic branch below like any other unclassified error.
 *
 * The thrown error's own `error` argument is attached as `.cause`
 * (standard `Error` field) on every branch -- not to serve this module's
 * own two cases, which already read everything they need before
 * throwing, but so a caller that DOES need to classify the raw failure
 * further (`raise.ts`, for its own already-exists translation) can do so
 * structurally, on `error.cause`, rather than by re-parsing this
 * function's own rendered message text.
 */
const throwApplyFailure = (
	fileName: string,
	nextCommand: string,
	error: unknown,
): never => {
	const code = driverErrorCode(error);
	const reason = driverErrorReason(error);
	if (code === UNSAFE_NEW_ENUM_VALUE) {
		throw Object.assign(
			hejbroError(
				"apply-unsafe-new-enum-value",
				`applying "${fileName}" failed${codeSuffix(code)}: ${reason}. This migration adds a value to an enum type and uses that value in the same transaction -- it was written before this change's generator started separating those statements. Next: regenerate your migrations (the enum change will land in its own migration), then rerun \`${nextCommand}\`.`,
			),
			{ cause: error },
		);
	}
	throw Object.assign(
		hejbroError(
			"apply-failed",
			`applying "${fileName}" failed${codeSuffix(code)}: ${reason}. Next: fix what the error above describes, then rerun \`${nextCommand}\`.`,
		),
		{ cause: error },
	);
};

/**
 * Applies one migration: refuses first if it carries its own transaction
 * control (3.5), otherwise sends its whole text as one parameterless
 * statement inside `transaction()` (3.1) -- the advisory lock (3.4) and
 * the ledger row (G1's `recordAppliedMigration`) go out on the same
 * session, so both are scoped to the same transaction. Any failure
 * inside the callback propagates unmodified to the driver, whose own
 * `transaction()` contract rolls back and rethrows (this module never
 * swallows it to translate it -- rollback itself is the driver's
 * guarantee, proved against a real server by group 8's live witness, not
 * by this module); the translation into a coded diagnostic (3.3) happens
 * once, outside the transaction, on whatever escaped it. `nextCommand`
 * names the command a caller should rerun once a failure is fixed (G6,
 * #612) -- passed straight through to {@link throwApplyFailure}, never
 * assumed.
 */
export const applyMigration = async (
	driver: Driver,
	migration: Migration,
	nextCommand: string,
): Promise<void> => {
	assertNoTransactionControl(migration);
	try {
		await driver.transaction(async (session) => {
			await session.execute(LOCK_STATEMENT);
			await session.execute(exec(migration.sql, []));
			await recordAppliedMigration(session, migration.fileName);
		});
	} catch (error) {
		throwApplyFailure(migration.fileName, nextCommand, error);
	}
};

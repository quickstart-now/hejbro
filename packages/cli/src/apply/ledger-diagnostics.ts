import { hejbroError } from "@hejbro/core";
import type { CompileResult, Driver } from "@hejbro/query";
import { codeSuffix, driverErrorCode, driverErrorReason } from "./execute";
import type { LedgerAccessSite } from "./ledger";
import { asLedgerAccessFailure, LEDGER_SCHEMA, LEDGER_TABLE } from "./ledger";

/**
 * [design.md D4] `ledger.ts` sends every statement it sends to the ledger
 * and tags a failure's direction/site (task 1.1); this sibling module owns
 * the refusal's text -- the same split `apply-ledger-occupied` already
 * sets between `ledger.ts` and `ledger-identity.ts`. Importing
 * `driverErrorCode`/`driverErrorReason` from `execute.ts` rather than
 * duplicating them keeps the dependency graph one-directional
 * (`ledger-diagnostics` -> `execute` -> `ledger`, mirrored by `raise.ts`,
 * which already imports both): `execute.ts` never imports this module
 * (task 1.4 keeps its own catch a rethrower, not a classifier), so there
 * is no cycle to avoid duplication against.
 */
const QUALIFIED_LEDGER_TABLE = `"${LEDGER_SCHEMA}"."${LEDGER_TABLE}"`;

/**
 * [design.md D2] `select current_user` on `driver`'s own top-level
 * `execute` -- never inside a transaction. A statement sent on a
 * transaction that has already failed is itself refused (`25P02`,
 * measured against `postgres:17-alpine`), so both classifiers below are
 * called only after their caller's own transaction has rolled back and
 * `driver.execute` opens a fresh connection for this one read. `null`,
 * never rethrown, when this read itself fails too (D2 option 1: the
 * diagnostic omits the role clause rather than fail twice).
 */
const currentRole = async (driver: Driver): Promise<string | null> => {
	try {
		const rows = await driver.execute({
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
 * [design.md D2/D3] The role clause and grant subject -- `role` is `null`
 * exactly when {@link currentRole} couldn't learn it, the one condition
 * both halves branch on together so they never disagree (a role clause
 * naming someone the `Next:` line then tells a stranger to grant).
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

/**
 * [design.md D8] The read failure's own opening clause -- `"probe"` names
 * the catalog read that judges the ledger's identity (`ledger-
 * identity.ts`'s own statement, never routed through `ledger.ts`'s
 * `exec`, so never tagged); `"read"` (the default) names the ledger
 * table itself, for `readLedger`'s own read and `isMigrationRecorded`'s
 * in-transaction recheck.
 */
type LedgerReadContext = "read" | "probe";

const readOpeningClause = (context: LedgerReadContext): string => {
	if (context === "probe") {
		return `the catalog read that judges \`${QUALIFIED_LEDGER_TABLE}\` was refused`;
	}
	return `\`${QUALIFIED_LEDGER_TABLE}\` could not be read`;
};

/**
 * [design.md D3] Turns a read failure `ledger.ts`'s `exec` tagged into
 * `apply-ledger-unreadable`, naming the ledger, the connecting role
 * (best-effort, D2) and the server's own SQLSTATE and message
 * unsummarized, ending with a `Next:` line offering the grant or the
 * applying role. `failure` is whatever `exec` threw (or, defensively, a
 * raw driver error if a caller already unwrapped it, e.g. the identity
 * probe's own catalog read, task 1.8 -- never tagged, since it never runs
 * through `ledger.ts`'s `exec`); either way the server's own error ends
 * up on `.cause`, never this function's own tag object. Used identically
 * for `readLedger`'s own read and `isMigrationRecorded`'s in-transaction
 * recheck (design.md D4) -- the message names no site because a read has
 * only ever the one shape, besides the probe's own opening clause
 * (design.md D8, `context`).
 */
export const throwLedgerReadFailure = async (
	driver: Driver,
	failure: unknown,
	commandName: string,
	context: LedgerReadContext = "read",
): Promise<never> => {
	const tag = asLedgerAccessFailure(failure);
	const cause = tag?.cause ?? failure;
	const role = await currentRole(driver);
	const code = driverErrorCode(cause);
	const reason = driverErrorReason(cause);
	throw Object.assign(
		hejbroError(
			"apply-ledger-unreadable",
			`${readOpeningClause(context)}${roleClause(role)}${codeSuffix(code)}: ${reason}. hejbro reads its own ledger before it can say what this database has applied. Next: grant ${grantSubject(role)} \`select\` on \`${QUALIFIED_LEDGER_TABLE}\` and \`usage\` on the \`"${LEDGER_SCHEMA}"\` schema, or connect as the role that applied, then rerun \`${commandName}\`.`,
		),
		{ cause },
	);
};

/**
 * [design.md D3] The write site named in words -- free for the caller to
 * supply since only it knows which statement it sent (measured: `42501`/
 * `23505`/etc. are byte-identical across all three write sites, so the
 * server's answer alone never says which one). `rowFilename` is read
 * exactly when `site === "row"`, the one site whose words name a file.
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

/** [design.md D3] The rollback sentence, one per write site -- see {@link writeSiteWords}'s own note on `rowFilename`. */
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

/** [design.md D3] node-postgres's own `.column` field on a constraint-violation error -- `null` when absent, never parsed from the message text. No equivalent exists in `execute.ts` to import; this reader is local to this module, not a duplicate of anything shared. */
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
 * [design.md D3] `23502`'s own sentence -- named from the driver's own
 * `.column` field when the server supplied one, never parsed from the
 * message text; a generic subject when it did not.
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
 * [design.md D3] Turns a write failure `ledger.ts`'s `exec` tagged into
 * `apply-ledger-unwritable`, naming the ledger, the connecting role
 * (best-effort, D2, same as {@link throwLedgerReadFailure}), which write
 * was refused in words, the rollback, and (only for `23502`) the
 * identity/default sentence -- ending with a `Next:` line. `rowFilename`
 * is the caller's own migration filename, needed only when the tagged
 * failure's site is `"row"`.
 */
export const throwLedgerWriteFailure = async (
	driver: Driver,
	failure: unknown,
	commandName: string,
	rowFilename?: string,
): Promise<never> => {
	const tag = asLedgerAccessFailure(failure);
	const cause = tag?.cause ?? failure;
	const site = tag?.site ?? "row";
	const role = await currentRole(driver);
	const code = driverErrorCode(cause);
	const reason = driverErrorReason(cause);
	const extraSentence = writeExtraSentence(code, cause);
	throw Object.assign(
		hejbroError(
			"apply-ledger-unwritable",
			`writing \`${QUALIFIED_LEDGER_TABLE}\` was refused${roleClause(role)}${codeSuffix(code)}: ${reason}. What was refused is ${writeSiteWords(site, rowFilename)}, hejbro's own bookkeeping — ${writeRollbackSentence(site, rowFilename)}${extraSentence} Next: resolve what the error above describes on the ledger itself (hejbro never grants and never alters it), then rerun \`${commandName}\`.`,
		),
		{ cause },
	);
};

import type { DriverCapabilities } from "../driver/contract";

/**
 * Repo-internal conformance kit (#481, tasks.md 1.4/1.5) — never exported
 * from `./index.ts` or `package.json`'s `exports` map. It judges a
 * driver's own declared tier against what its caller already recorded,
 * never a transport it opens itself (`.claude/rules/query-purity.md`):
 * the caller's own stub (mirroring `packages/pg/test/driver.test.ts`'s
 * `stubPoolWithClient`, or neon http's `stubSuccess`) captures what was
 * actually sent, in order, and hands that list here. The kit reads no
 * driver's pin SQL text — only where the caller's own statement lands
 * relative to whatever preceded it, which is what the spec's "in that
 * order" (driver-contract, "A driver without session state guarantees
 * its own statements") actually names.
 *
 * The single exported surface, {@link assertSessionStateConformance},
 * reads which tier applies from the driver's own `capabilities` — a
 * caller never hands it a tier directly. Picking the obligation any
 * other way (letting the caller choose which internal check runs,
 * independent of the declaration) reopens the same hole from the other
 * side of the forbidden move this kit exists to avoid: inferring or
 * correcting a *declaration* from observed behavior is banned, and so is
 * applying an obligation that doesn't match the declaration in hand.
 */

/** One statement as a caller's own stub already captured it -- the same two fields a `CompileResult` carries onward to a driver. */
export type ConformanceStatement = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

/**
 * What a caller hands {@link assertSessionStateConformance} — exactly one
 * of the three shapes below, never more than one, never none. Which one is
 * *required* is decided by `capabilities["session-state"]` together with
 * `capabilities["interactive-transactions"]`, not by which fields happen
 * to be present: a caller that records the wrong shape for the driver's
 * actual declaration is a conformance failure, not a type escape hatch.
 * `recordedOnConnection` is the shape required for `session-state: false`
 * combined with `interactive-transactions: true` — every statement the
 * driver emits on its own connection, transaction control included, since
 * that tier's obligation lives in the transaction envelope and the plain
 * `recordedForOneExecute` shape (scoped to one `execute()` call) cannot
 * show it.
 */
export type ConformanceObservation =
	| {
			readonly recordedForOneExecute: ReadonlyArray<ConformanceStatement>;
			readonly callerStatement: ConformanceStatement;
	  }
	| {
			readonly recordedOnConnection: ReadonlyArray<ConformanceStatement>;
			readonly callerStatement: ConformanceStatement;
	  }
	| {
			readonly recordedForSetupSession: ReadonlyArray<ConformanceStatement>;
	  };

/**
 * Builds and throws the kit's own failure -- same enriched-`Error` idiom
 * as `driver/errors.ts` (D57: this package doesn't extend `HejbroError`).
 */
function throwConformanceViolation(tier: string, reason: string): never {
	throw Object.assign(
		new Error(
			`driver conformance violation (${tier}): ${reason} Next: fix the driver's session handling for this tier, or its capabilities declaration if it doesn't actually belong in this tier.`,
		),
		{ code: "driver-conformance-violation", tier },
	);
}

/**
 * The `session-state: false` tier's own obligation (driver-contract: "A
 * driver without session state guarantees its own statements") — some
 * statement precedes the caller's own compiled statement for that one
 * `execute()` call; nothing is asserted about what follows it (a
 * transaction-wrapping driver's trailing `COMMIT` conforms). Matched by
 * `sql` text only (never `params`): a settings statement and the
 * caller's own statement never share SQL text, so this is enough to
 * place the caller's statement without the kit ever needing to know what
 * the settings text actually is.
 *
 * Blind spot: this observation is taken at the driver's own execute
 * contract (the `CompileResult` domain), where a transaction's own
 * opening never appears -- it cannot tell a pin sent before a transaction
 * opens from one sent after it, and both record identically here. That
 * distinction is exactly what a `session-state: false` driver also
 * declaring `interactive-transactions: true` needs, since a
 * transaction-local setting sent before the transaction opens is
 * discarded without applying -- {@link assertTransactionEnvelopeConformance}
 * is that tier's own obligation, and applies instead of this one for
 * that declaration. Internal -- {@link assertSessionStateConformance}
 * is the one exported surface.
 */
const assertFalseTierConformance = (
	recordedForOneExecute: ReadonlyArray<ConformanceStatement>,
	callerStatement: ConformanceStatement,
): void => {
	const index = recordedForOneExecute.findIndex(
		(statement) => statement.sql === callerStatement.sql,
	);
	if (index <= 0) {
		throwConformanceViolation(
			"session-state:false",
			"nothing preceded the caller's own statement in what was sent for this execution -- a session-state:false driver must carry the settings with every execution, not just declare the capability false.",
		);
	}
};

/** SQL's own transaction-control vocabulary, matched as a whole statement (trimmed, case-insensitive) only — never a substring, so a function body's own `do $$ begin … end $$` or a caller statement carrying one of these words inside a string literal reads as an ordinary statement. The kit still reads no driver's own settings text; this is the one exception, and it stays scoped to SQL's own control words. */
const TRANSACTION_OPEN_STATEMENTS = new Set(["begin", "start transaction"]);
const TRANSACTION_END_STATEMENTS = new Set(["commit", "rollback", "end"]);

type TransactionControlKind = "open" | "end" | undefined;

const transactionControlKind = (sql: string): TransactionControlKind => {
	const normalized = sql.trim().toLowerCase();
	if (TRANSACTION_OPEN_STATEMENTS.has(normalized)) {
		return "open";
	}
	if (TRANSACTION_END_STATEMENTS.has(normalized)) {
		return "end";
	}
	return undefined;
};

/**
 * The envelope-tracking fold `assertTransactionEnvelopeConformance` scans
 * with, statement by statement, up to (not including) the caller's own:
 * `openIndex` is the position of the nearest transaction-opening statement
 * seen since the last close (`undefined` outside any open transaction),
 * and `sawStatementSinceOpen` is whether at least one ordinary statement
 * followed it.
 */
type EnvelopeScanState = {
	readonly openIndex: number | undefined;
	readonly sawStatementSinceOpen: boolean;
};

const foldEnvelopeScan = (
	state: EnvelopeScanState,
	statement: ConformanceStatement,
	index: number,
): EnvelopeScanState => {
	const kind = transactionControlKind(statement.sql);
	if (kind === "open") {
		return { openIndex: index, sawStatementSinceOpen: false };
	}
	if (kind === "end") {
		return { openIndex: undefined, sawStatementSinceOpen: false };
	}
	if (state.openIndex === undefined) {
		return state;
	}
	return { ...state, sawStatementSinceOpen: true };
};

/**
 * The transaction-envelope obligation (driver-contract: "Every declared
 * tier's obligation is machine-verified in this repository", the
 * session-state:false + interactive-transactions:true addendum) — the
 * transaction that carries the caller's own statement must have opened
 * before it, some statement (the settings) must follow that opening, and
 * no transaction may have ended in between. What follows the caller's own
 * statement is unconstrained, same as the plain false tier. Internal --
 * {@link assertSessionStateConformance} is the one exported surface.
 */
const assertTransactionEnvelopeConformance = (
	recordedOnConnection: ReadonlyArray<ConformanceStatement>,
	callerStatement: ConformanceStatement,
): void => {
	const callerIndex = recordedOnConnection.findIndex(
		(statement) => statement.sql === callerStatement.sql,
	);
	const precedingStatements =
		callerIndex < 0 ? [] : recordedOnConnection.slice(0, callerIndex);
	const scan = precedingStatements.reduce<EnvelopeScanState>(
		foldEnvelopeScan,
		{ openIndex: undefined, sawStatementSinceOpen: false },
	);
	if (scan.openIndex === undefined) {
		throwConformanceViolation(
			"session-state:false+interactive-transactions:true",
			"the caller's own statement was not sent inside an open transaction -- this tier must send the caller's statement inside the same transaction that carries its settings, after the transaction opens and before any transaction ends.",
		);
	}
	if (!scan.sawStatementSinceOpen) {
		throwConformanceViolation(
			"session-state:false+interactive-transactions:true",
			"no statement was sent between the transaction's own opening and the caller's own statement -- a transaction-local setting sent before the transaction opens is discarded without applying, so the settings must land inside the same transaction that carries the caller's statement.",
		);
	}
};

/**
 * The `session-state: true` tier's own obligation — the setup hook, not
 * `execute()`, is where the settings ride; something must have actually
 * been sent through it. Internal -- {@link assertSessionStateConformance}
 * is the one exported surface.
 */
const assertTrueTierConformance = (
	recordedForSetupSession: ReadonlyArray<ConformanceStatement>,
): void => {
	if (recordedForSetupSession.length === 0) {
		throwConformanceViolation(
			"session-state:true",
			"the session-setup hook sent nothing -- a session-state:true driver must deliver the settings through its setup hook.",
		);
	}
};

/**
 * The kit's one exported entry point. `capabilities["session-state"]`
 * together with `capabilities["interactive-transactions"]` decides which
 * tier's obligation applies and which one of the three shapes of
 * `observation` it reads — never the other way around, and never inferred
 * from `observation`'s own shape as a substitute for reading the
 * declaration. A declaration checked against an observation shaped for a
 * different tier (in any direction) is a conformance failure in its own
 * right: the caller recorded the wrong thing for what this driver
 * actually declares.
 */
export const assertSessionStateConformance = (
	capabilities: DriverCapabilities,
	observation: ConformanceObservation,
): void => {
	if (capabilities["session-state"]) {
		if (!("recordedForSetupSession" in observation)) {
			throwConformanceViolation(
				"session-state:true",
				"capabilities declares session-state true, but this driver was checked with a false-tier observation instead of recordedForSetupSession.",
			);
		}
		assertTrueTierConformance(observation.recordedForSetupSession);
		return;
	}
	if (capabilities["interactive-transactions"]) {
		if (!("recordedOnConnection" in observation)) {
			throwConformanceViolation(
				"session-state:false+interactive-transactions:true",
				"capabilities declares session-state false with interactive-transactions true, but this driver was checked with an observation that cannot show transaction control -- recordedOnConnection/callerStatement is required for this declaration.",
			);
		}
		assertTransactionEnvelopeConformance(
			observation.recordedOnConnection,
			observation.callerStatement,
		);
		return;
	}
	if (!("recordedForOneExecute" in observation)) {
		throwConformanceViolation(
			"session-state:false",
			"capabilities declares session-state false, but this driver was checked with a true-tier or envelope-tier observation instead of recordedForOneExecute/callerStatement.",
		);
	}
	assertFalseTierConformance(
		observation.recordedForOneExecute,
		observation.callerStatement,
	);
};

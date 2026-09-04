import type {
	JsonValue,
	KindChange,
	KindRegistry,
	RegisteredObjectKind,
	Snapshot,
} from "@hejbro/core";
import {
	diffSnapshots,
	emptySnapshot,
	generateMigrations,
	HejbroError,
	hejbroError,
	throwHejbroError,
} from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import {
	codeSuffix,
	driverErrorCode,
	driverErrorDetail,
	driverErrorReason,
} from "./execute";
import { asLedgerAccessFailure, clearLedgerRows } from "./ledger";
import { throwLedgerWriteFailure } from "./ledger-diagnostics";
import {
	assertLedgerNotOccupied,
	probeLedgerIdentity,
} from "./ledger-identity";

/**
 * [task 5.1] Every object `reset` would drop, in dependency order --
 * `diffSnapshots(currentSnapshot, emptySnapshot, registry)` is exactly
 * "the declarations describe these objects; describe none of them", the
 * same diff `generate` computes whenever a whole kind is removed, so
 * this reuses it rather than re-deriving drop order (core already
 * proved: table, then enum, then schema -- reverse of creation).
 *
 * This is also what makes "drops only declared objects" true by
 * construction rather than by a check this function performs: an object
 * the declarations do not cover was never in `currentSnapshot` to begin
 * with, so it can never appear in this diff -- there is no filtering
 * step here for the same reason there is none in `generate`'s own path.
 */
export const planReset = (
	currentSnapshot: Snapshot,
	registry: KindRegistry,
): ReadonlyArray<KindChange> =>
	diffSnapshots(currentSnapshot, emptySnapshot, registry);

const targetDescription = (change: KindChange): string =>
	`${change.kind}:${change.identity}`;

/**
 * [task 18.1, D106 M6] `compareCatalog`'s own precedent
 * (`check-declarations-empty`, `check/compare.ts`) for the same reason:
 * a declaration set with 0 declared objects is never a real reset target
 * -- it is indistinguishable from the misconfigured entry pattern
 * `check`/`baseline` already refuse, and running `reset` against it
 * would otherwise be a silent, unconfirmed way to empty the ledger of a
 * database whose objects are all still standing. Checked first, before
 * `currentDatabaseName`'s own `select current_database()` -- otherwise
 * "reset sends nothing" would already be false by the time this refuses.
 */
const assertDeclarationsNotEmpty = (currentSnapshot: Snapshot): void => {
	const entries = Object.entries(currentSnapshot.objects);
	if (entries.length === 0) {
		throwHejbroError(
			"reset-declarations-empty",
			"hejbro reset received a declaration set with 0 declared objects -- resetting against an empty declaration set can never be told apart from a misconfigured entry pattern, and would otherwise clear the ledger of a database whose objects are all still standing. Next: confirm the entry pattern in hejbro.config.ts matches real declaration files that export table()/schema()/... declarations, then rerun `hejbro reset`.",
		);
	}
};

/**
 * [design, task 5.2, revised] The confirmation `reset` demands is
 * `<database>:<count>` -- not the count alone. A count-only confirmation
 * was tried first and sent back: this product's own determinism means
 * the SAME declarations always diff to the SAME count, on every
 * database they were ever applied to. A count learned once against a
 * dev database is then valid, unchanged, against production -- the
 * exact wrong-target catastrophe a confirmation exists to catch would
 * sail straight through it. Binding the confirmation to
 * `current_database()` (queried live, not passed in by the caller, so
 * it cannot be stale or spoofed by a mismatched config) makes the value
 * differ by *where*, not just *what*, matching the genre's own answer
 * to this problem (a repo delete asks for the repo's name; `dropdb`
 * asks for the database's own). The count stays in the value too --
 * losing it would lose the "this changes as declarations change"
 * property the first draft had right. Two names that happen to collide
 * (two databases both called "app") are not fully guarded by this, but
 * the goal was never a perfect device -- it is friction on the most
 * common catastrophe (the right command, the wrong target), and a
 * same-named target is the residual case every tool in this genre
 * shares, not one this change introduces.
 *
 * Nothing to drop needs no confirmation: refusing a no-op protects
 * against nothing.
 */
export const requiredConfirmation = (
	databaseName: string,
	changes: ReadonlyArray<KindChange>,
): string => `${databaseName}:${changes.length}`;

export const assertResetConfirmed = (
	databaseName: string,
	changes: ReadonlyArray<KindChange>,
	confirmed: string | undefined,
): void => {
	if (changes.length === 0) {
		return;
	}
	const required = requiredConfirmation(databaseName, changes);
	if (confirmed === required) {
		return;
	}
	const targets = changes.map(targetDescription).join(", ");
	throwHejbroError(
		"reset-not-confirmed",
		`reset would drop ${changes.length} declared object(s) from database "${databaseName}": ${targets}. Next: rerun with --confirm-drop ${required} to confirm.`,
	);
};

/** `current_database()`, queried live so the confirmation it feeds binds to the database this connection is actually on -- never a name the caller merely believes it configured. */
export const currentDatabaseName = async (driver: Driver): Promise<string> => {
	const rows = await driver.execute({
		sql: "select current_database() as name",
		params: [],
		kind: "sql",
	});
	return String(rows[0]?.name ?? "");
};

/**
 * [G4 rework, #610] Reset's own DDL, built by reusing `generateMigrations`
 * with an empty declaration set rather than reimplementing the
 * predrop/main/deferred emit loop here. This is not a workaround: a reset
 * genuinely IS the migration that drops everything -- "declare nothing"
 * against the live snapshot diffs to exactly what `planReset` above
 * already computes independently (`diffSnapshots(currentSnapshot,
 * emptySnapshot, registry)`), so going through the real pipeline makes
 * reset's own identity legible in the code instead of hiding it behind a
 * second, hand-rolled emitter that could drift from the one `generate`
 * uses (the reason `emitStatementsSql` was a shared helper in the first
 * place, before this rework took it off the public surface). The banner
 * this carries (harmless SQL comments -- `-- hejbro migration`, one
 * `-- drop <kind> <identity>` line per change) is a side effect of that
 * reuse, not something reset asks for; it is pinned as an intentional,
 * observed change to reset's own DDL text in apply-reset.test.ts.
 *
 * A drop-only run can never trigger `engine/split.ts`'s own condition (it
 * adds no enum value, ever), so exactly one migration comes back today --
 * but that is a property of *today's* split trigger, not of this
 * function, so it is asserted rather than assumed: a future split
 * condition that a drop-only run COULD trigger must fail loudly here
 * rather than silently run half of reset, which is the exact failure
 * mode this whole rework exists to close off.
 */
const resetMigrationSql = (
	currentSnapshot: Snapshot,
	registry: KindRegistry,
): string => {
	const result = generateMigrations({
		declarations: [],
		previousSnapshot: currentSnapshot,
		registry,
	});
	if (result.migrations.length !== 1) {
		return throwHejbroError(
			"reset-migration-not-singular",
			`reset's own migration run produced ${result.migrations.length} file(s), not exactly one -- a drop-only run was expected to never need a transaction boundary. Next: this is a hejbro bug -- file an issue with your declarations and the database's current schema.`,
		);
	}
	return result.migrations[0]?.sql as string;
};

/** `null` when there is nothing to drop (a no-op reset needs no SQL); otherwise {@link resetMigrationSql}'s own DDL. */
const sqlToDrop = (
	changes: ReadonlyArray<KindChange>,
	currentSnapshot: Snapshot,
	registry: KindRegistry,
): string | null => {
	if (changes.length === 0) {
		return null;
	}
	return resetMigrationSql(currentSnapshot, registry);
};

/**
 * [797/R1] A recursive topological peel over `edgesFrom` (Kahn's
 * algorithm, recursion in place of the loop house style bans): remove
 * every identity in `remaining` whose every edge already points outside
 * `remaining`; a non-empty `remaining` from which nothing can be removed
 * is a cycle. Detects a cycle of any length -- two identities each
 * naming the other, same as any longer ring -- not only a direct mutual
 * pair.
 */
const peelHasCycle = (
	edgesFrom: ReadonlyMap<string, ReadonlySet<string>>,
	remaining: ReadonlySet<string>,
): boolean => {
	if (remaining.size === 0) {
		return false;
	}
	const removable = new Set(
		Array.from(remaining).filter((identity) =>
			Array.from(edgesFrom.get(identity) ?? new Set<string>()).every(
				(dependencyIdentity) => !remaining.has(dependencyIdentity),
			),
		),
	);
	if (removable.size === 0) {
		return true;
	}
	return peelHasCycle(
		edgesFrom,
		new Set(
			Array.from(remaining).filter((identity) => !removable.has(identity)),
		),
	);
};

/**
 * [D106 R1, N3, #753 reopened; 797/R1] Whether `changes` -- `reset`'s own
 * drop plan -- contains a genuine same-kind cycle of any length via
 * `kind.dependsOnIdentities` (task 1.2's own "never throws" case; a
 * mutual pair is the shortest one, not the only one {@link peelHasCycle}
 * detects). `reset`'s own plan is always drop-only, so `change.previous`
 * is always the real node to read (mirrors core's own `nodeForOrdering`,
 * drop side, which this module has no access to -- `registry.get`/
 * `KindChange` are the public surface this reads instead). Computed once,
 * before the transaction ever opens: not "did THIS failure come from a
 * cycle" (the driver names an object, not an edge, and this module has no
 * SQL parser), but "does this run's own declared set contain one at all"
 * -- the delta's own two scenarios (an outside dependent vs. a declared
 * cycle) are exactly this binary, and a plan with a cycle can only ever
 * fail its drop for that reason (task 1.2: every other member that is not
 * part of one is ordered so its drop succeeds).
 */
const kindHasCycle = (
	kind: RegisteredObjectKind,
	kindChanges: ReadonlyArray<KindChange>,
): boolean => {
	const dependsOnIdentities = kind.dependsOnIdentities;
	if (dependsOnIdentities === undefined || kindChanges.length <= 1) {
		return false;
	}
	const identitySet = new Set(kindChanges.map((change) => change.identity));
	const edgesFrom = new Map(
		kindChanges.map((change) => [
			change.identity,
			new Set(
				dependsOnIdentities(change.previous as JsonValue).filter(
					(identity) =>
						identitySet.has(identity) && identity !== change.identity,
				),
			),
		]),
	);
	return peelHasCycle(edgesFrom, identitySet);
};

/** {@link kindHasCycle}, across every kind in `changes` -- grouped first, since a cycle is only ever a same-kind edge (task 1.1/1.2: cross-kind ordering was never the gap). */
const dropsContainCycle = (
	changes: ReadonlyArray<KindChange>,
	registry: KindRegistry,
): boolean => {
	const byKind = changes.reduce<ReadonlyMap<string, ReadonlyArray<KindChange>>>(
		(acc, change) => {
			const existing = acc.get(change.kind) ?? [];
			return new Map(acc).set(change.kind, [...existing, change]);
		},
		new Map(),
	);
	return Array.from(byKind.entries()).some(([kindName, kindChanges]) =>
		kindHasCycle(registry.get(kindName), kindChanges),
	);
};

/** [D106 R1, N2, #753 reopened] The database's own `DETAIL` line, parenthesized right after `reason` -- `""` when there is none, so the message reads exactly as it did before this detail existed. */
const detailSuffix = (detail: string | null): string => {
	if (detail === null) {
		return "";
	}
	return ` (${detail})`;
};

const OUTSIDE_DECLARATIONS_ADVICE =
	"resolve what the error above describes (an object outside your declarations may still depend on one you're dropping)";

/**
 * [D106 R1, N3, C5, #753 reopened] "The detail above names the actual
 * dependent" only when there IS a detail -- `driverErrorDetail` already
 * reads `null` when the server sent none, and asserting this sentence
 * without one would be exactly the false certainty this whole review
 * round exists to close.
 */
const detailPointerClause = (detail: string | null): string => {
	if (detail === null) {
		return "";
	}
	return "the detail above names the actual dependent; ";
};

/**
 * [D106 R1, N3, C5, NB4, #753 reopened] Additive, never a replacement for
 * {@link OUTSIDE_DECLARATIONS_ADVICE} -- `dropsContainCycle` only knows
 * this run's own plan contains a cycle (task 1.2's own "never throws"
 * case), never that the cycle is what the server actually refused over:
 * the driver names an object, not an edge, so a plan with a cycle can
 * still fail its drop because of a genuine outside dependent instead (or
 * as well). Stating the cycle fact while dropping the outside-declarations
 * clause would assert a cause this module cannot actually establish --
 * exactly the false certainty the plain N3 fix first shipped with.
 * `detailPointerClause` leads (NB4's ordering): the server's own `DETAIL`
 * line, when there is one, already names the real dependent -- the two
 * possibilities below are what to check it against, never a guess to
 * replace it with.
 */
const declaredCycleAdvice = (detail: string | null): string =>
	`resolve what the error above describes (${detailPointerClause(detail)}a set of your declared tables that reference each other in a cycle, which no order satisfies, so they were left in identity order rather than refused outright, and an object outside your declarations may also still depend on one you're dropping)`;

/**
 * [D106 R1, NB1, #753 reopened] Dependency advice only ever applies to
 * `2BP01` (Postgres's own "cannot drop ... because other objects depend
 * on it") -- every other code (`55000` a ledger-blocking view, `42501` a
 * non-owner role, `42P01` a TOCTOU-raced ledger) has nothing to do with a
 * dependency, and attaching this advice to it would assert a cause the
 * error itself never named.
 */
const DEPENDENCY_CODE = "2BP01";

const resetDropFailedAdvice = (
	code: string | null,
	dropsContainCycle: boolean,
	detail: string | null,
): string => {
	if (code !== DEPENDENCY_CODE) {
		return "resolve what the error above describes";
	}
	if (dropsContainCycle) {
		return declaredCycleAdvice(detail);
	}
	return OUTSIDE_DECLARATIONS_ADVICE;
};

/**
 * [D106 R1, NB1, #753 reopened] Which part of `applyReset`'s transaction
 * actually failed -- `"drop"` (the DDL statement), `"ledger"` (clearing
 * the ledger, reached only after the drop itself already succeeded
 * within this same transaction), or `"unknown"` (the transaction
 * machinery itself -- BEGIN/COMMIT, the connection -- never reached
 * either statement's own catch). `reset-drop-failed`'s message names
 * this phase instead of always claiming "failed to drop": a view
 * squatting on the ledger's own name (`55000`) fails the ledger clear,
 * not the drop, and saying otherwise is the same defect class this round
 * closes for the dependency advice.
 */
type ResetFailurePhase = "drop" | "ledger" | "unknown";

/**
 * [D106 R1, NB1, C9, #753 reopened] The ledger-phase clause names the
 * order things ran in (drops, then the ledger clear), never claims the
 * drops survived -- the rolled-back sentence right after this clause
 * already states the true final fact ("nothing was dropped"), and a
 * clause reading "dropped your declared objects" just before that would
 * contradict it in the same message, the exact self-inconsistency this
 * review round exists to close.
 */
const phaseOpening = (phase: ResetFailurePhase): string => {
	if (phase === "ledger") {
		return "hejbro reset failed while clearing the ledger, after its drops had already run";
	}
	if (phase === "unknown") {
		return "hejbro reset's transaction failed";
	}
	return "hejbro reset failed to drop your declared objects";
};

/**
 * [D106 R1, NB1, #753 reopened] Tags `error` with which phase raised it,
 * then rethrows immediately -- transform-and-rethrow, never a swallow:
 * nothing here returns a value or lets the transaction continue past a
 * failure, only the phase label travels out with it. A `HejbroError` is
 * rethrown unchanged (task 3.8's own invariant) -- it is already a
 * deliberate diagnostic no phase label improves.
 */
const throwPhaseTagged = (phase: ResetFailurePhase, error: unknown): never => {
	if (error instanceof HejbroError) {
		throw error;
	}
	throw Object.assign(new Error("reset transaction phase failure"), {
		resetPhase: phase,
		cause: error,
	});
};

/** The phase a {@link throwPhaseTagged} carrier names, or `"unknown"` for anything that never passed through it (transaction machinery, not either statement). */
const resetPhaseOf = (error: unknown): ResetFailurePhase => {
	if (typeof error === "object" && error !== null && "resetPhase" in error) {
		const phase = (error as { readonly resetPhase?: unknown }).resetPhase;
		if (phase === "drop" || phase === "ledger") {
			return phase;
		}
	}
	return "unknown";
};

/** The real failure a {@link throwPhaseTagged} carrier wraps -- `error` itself when it was never tagged. */
const resetPhaseCauseOf = (error: unknown): unknown => {
	if (
		typeof error === "object" &&
		error !== null &&
		"resetPhase" in error &&
		"cause" in error
	) {
		return (error as { readonly cause: unknown }).cause;
	}
	return error;
};

/**
 * [task 1.4, #753] Translates a failed drop into a coded
 * `reset-drop-failed` `HejbroError` instead of letting it escape uncaught
 * -- reuses `apply/execute.ts`'s own `driverErrorCode`/`driverErrorReason`/
 * `driverErrorDetail`/`codeSuffix` (already exported for exactly this
 * reuse; `raise.ts` does the same), so this names the database's own
 * reason the identical way `apply`/`migrate`'s own failures do, plus the
 * server's own `DETAIL` line (D106 R1, N2) the bare `reason` never
 * carried. The transaction this drop ran inside has already rolled back
 * by the time this runs (D108/D109: the drops and the ledger's own
 * clearing share one transaction), so nothing more needs undoing here --
 * only the surfacing was ever the gap. `error` is attached as `.cause`
 * (mirrors `throwApplyFailure`), for a caller that wants the raw failure
 * structurally rather than by re-parsing this message.
 *
 * [task 3.8, #753] A `HejbroError` the transaction raises (e.g.
 * `resetMigrationSql`'s own `reset-migration-not-singular`, when the
 * hoist below can't already keep it out of this catch) is rethrown
 * unchanged -- it is already a deliberate diagnostic, with its own code
 * and its own advice, neither of which the drop-failure wording below
 * describes. Only a failure that is not one is re-coded.
 *
 * [D106 R1, NB1, #753 reopened] `phase` picks the opening clause
 * ({@link phaseOpening}); the rolled-back sentence and the coded error
 * itself (`reset-drop-failed`, never a second code) stay the same for
 * every phase -- the whole transaction (drop and ledger clear alike)
 * rolls back regardless of which statement inside it failed, and a
 * second code per phase would be a contract addition this review round
 * does not make, not a message fix.
 */
const throwResetDropFailed = (
	error: unknown,
	phase: ResetFailurePhase,
	dropsContainCycle: boolean,
): never => {
	if (error instanceof HejbroError) {
		throw error;
	}
	const code = driverErrorCode(error);
	const reason = driverErrorReason(error);
	const detail = driverErrorDetail(error);
	throw Object.assign(
		hejbroError(
			"reset-drop-failed",
			`${phaseOpening(phase)}${codeSuffix(code)}: ${reason}${detailSuffix(detail)}. The transaction was rolled back — nothing was dropped and the ledger is unchanged. Next: run \`hejbro status\` to confirm, ${resetDropFailedAdvice(code, dropsContainCycle, detail)}, then rerun \`hejbro reset\`.`,
		),
		{ cause: error },
	);
};

/** What one {@link applyReset} call actually did to the ledger -- `false` both when there was nothing to drop and when the ledger table never existed (D106 R1, B1): the caller (`commands/reset.ts`) reports "cleared the ledger" only when this is `true`, never as a blanket claim. */
export type ResetOutcome = { readonly ledgerCleared: boolean };

/**
 * Returns a database to the state before any migration was applied
 * (spec): refuses an empty declaration set outright (task 18.1, before
 * anything is sent), drops every declared object (5.1) inside one
 * transaction, refusing first without an exact confirmation bound to the
 * live database's own name (5.2), then empties the ledger (5.3,
 * `clearLedgerRows` -- every row, never the ledger table itself, which is
 * hejbro's own bookkeeping and not a declared object, so this
 * requirement's own "only what the declarations manage" protects it
 * too) **together with** the drops it records (task 18.1, D106 M6): a
 * reset that would drop nothing writes nothing, the ledger included, so
 * the "nothing to drop needs no confirmation" carve-out above is a
 * genuine no-op rather than a silent, unconfirmed ledger clear.
 *
 * [D106 R1, B1, #753 reopened; harden-ledger-identity, 783/R2] The
 * ledger's identity is probed once, through `driver` directly, before the
 * transaction even opens -- a database whose migrations were all applied
 * outside hejbro (`psql -f`, an external pipeline) never bootstraps the
 * ledger, and the transaction below now only ever attempts
 * `clearLedgerRows` when that probe already found the real ledger.
 * Nothing inside the transaction swallows an
 * error (a caught branch that returns or carries on): each statement's own
 * catch ({@link throwPhaseTagged}, D106 R1, NB1) only tags which phase
 * failed and rethrows immediately, so a ledger-delete failure that happens
 * anyway is a genuine one and propagates like any other drop failure, into
 * {@link throwResetDropFailed} below, rather than being swallowed into a
 * rollback nobody is told about (B1's own root cause -- a caught 42P01
 * inside this same transaction returned instead of rethrowing, leaving it
 * aborted with no error surfaced, and a plain `COMMIT` on an aborted
 * transaction is a rollback Postgres never reports as a failure).
 *
 * A drop the database refuses (task 1.4, #753) -- an object outside the
 * declarations still depending on the one being dropped, most commonly --
 * rolls the whole transaction back (nothing dropped, the ledger
 * untouched) and surfaces as {@link throwResetDropFailed}'s coded error,
 * never an unclassified, uncaught crash.
 */
export const applyReset = async (
	driver: Driver,
	currentSnapshot: Snapshot,
	registry: KindRegistry,
	confirmed: string | undefined,
): Promise<ResetOutcome> => {
	assertDeclarationsNotEmpty(currentSnapshot);
	const changes = planReset(currentSnapshot, registry);
	// [harden-ledger-identity, 783/R3] Before the confirmation check: asking
	// for a `<database>:<count>` token on a run that is refused anyway is
	// wasted and misleading, and this catalog read opens no transaction, so
	// nothing the confirmation protects is touched by running it first.
	const identity = await probeLedgerIdentity(driver);
	assertLedgerNotOccupied(identity, "hejbro reset");
	const databaseName = await currentDatabaseName(driver);
	assertResetConfirmed(databaseName, changes, confirmed);
	// [task 3.8, #753] Computed here, not inside the transaction below: a
	// pure computation, so a `reset-migration-not-singular` refusal (a
	// hejbro bug, not a drop failure) surfaces before any statement is
	// sent, rather than racing throwResetDropFailed's own rethrow-if-
	// HejbroError guard to keep its code.
	const sql = sqlToDrop(changes, currentSnapshot, registry);
	if (sql === null) {
		return { ledgerCleared: false };
	}
	const ledgerExists = identity.kind === "ledger";
	try {
		return await driver.transaction(async (session) => {
			try {
				await session.execute({ sql, params: [], kind: "sql" });
			} catch (error) {
				// [D106 R1, NB1] Transform-and-rethrow, never swallowed: tags
				// this failure as the drop phase before it leaves the
				// transaction, so the outer catch never has to guess.
				throwPhaseTagged("drop", error);
			}
			if (ledgerExists) {
				try {
					await clearLedgerRows(session);
				} catch (error) {
					// [D106 R1, NB1] Same rule, tagged "ledger" -- by this
					// point the drop above already succeeded, so a failure
					// here (e.g. a view squatting on the ledger's own name,
					// 55000) must never be worded as a failed drop.
					throwPhaseTagged("ledger", error);
				}
			}
			return { ledgerCleared: ledgerExists };
		});
	} catch (error) {
		const phaseCause = resetPhaseCauseOf(error);
		const phase = resetPhaseOf(error);
		// [task 1.7, harden-ledger-diagnostics, design.md D6] A refused
		// ledger clear is a ledger failure, not a refused drop -- but only
		// when `clearLedgerRows`'s own statement (task 1.1) actually tagged
		// it; the phase label alone is not proof (a caller reasoning "phase
		// is ledger, so it's a ledger code" would misclassify anything else
		// ever routed through the ledger phase without going through
		// `ledger.ts`'s own `exec`). `driver.transaction` has already rolled
		// back by the time this catch runs, so the classifier's own role
		// read can still succeed (D2, measured `25P02` otherwise).
		const ledgerTag = asLedgerAccessFailure(phaseCause);
		if (phase === "ledger" && ledgerTag !== null) {
			await throwLedgerWriteFailure(
				driver,
				phaseCause,
				"hejbro reset",
				undefined,
			);
		}
		return throwResetDropFailed(
			phaseCause,
			phase,
			dropsContainCycle(changes, registry),
		);
	}
};

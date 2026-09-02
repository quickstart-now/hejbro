import type { KindChange, KindRegistry, Snapshot } from "@hejbro/core";
import {
	diffSnapshots,
	emptySnapshot,
	generateMigrations,
	throwHejbroError,
} from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import { clearLedger } from "./ledger";

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

/**
 * Returns a database to the state before any migration was applied
 * (spec): refuses an empty declaration set outright (task 18.1, before
 * anything is sent), drops every declared object (5.1) inside one
 * transaction, refusing first without an exact confirmation bound to the
 * live database's own name (5.2), then empties the ledger (5.3,
 * `clearLedger` -- every row, never the ledger table itself, which is
 * hejbro's own bookkeeping and not a declared object, so this
 * requirement's own "only what the declarations manage" protects it
 * too) **together with** the drops it records (task 18.1, D106 M6): a
 * reset that would drop nothing writes nothing, the ledger included, so
 * the "nothing to drop needs no confirmation" carve-out above is a
 * genuine no-op rather than a silent, unconfirmed ledger clear.
 */
export const applyReset = async (
	driver: Driver,
	currentSnapshot: Snapshot,
	registry: KindRegistry,
	confirmed: string | undefined,
): Promise<void> => {
	assertDeclarationsNotEmpty(currentSnapshot);
	const changes = planReset(currentSnapshot, registry);
	const databaseName = await currentDatabaseName(driver);
	assertResetConfirmed(databaseName, changes, confirmed);
	await driver.transaction(async (session) => {
		if (changes.length > 0) {
			const sql = resetMigrationSql(currentSnapshot, registry);
			await session.execute({ sql, params: [], kind: "sql" });
			await clearLedger(session);
		}
	});
};

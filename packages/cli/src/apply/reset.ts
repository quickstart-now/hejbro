import type { KindChange, KindRegistry, Snapshot } from "@hejbro/core";
import {
	diffSnapshots,
	emitStatementsSql,
	emptySnapshot,
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
 * Returns a database to the state before any migration was applied
 * (spec): drops every declared object (5.1) inside one transaction,
 * refusing first without an exact confirmation bound to the live
 * database's own name (5.2), then empties the ledger (5.3,
 * `clearLedger` -- every row, never the ledger table itself, which is
 * hejbro's own bookkeeping and not a declared object, so this
 * requirement's own "only what the declarations manage" protects it
 * too). `session.execute` is skipped entirely when there is nothing to
 * drop, so a reset with nothing declared sends no DDL at all.
 */
export const applyReset = async (
	driver: Driver,
	currentSnapshot: Snapshot,
	registry: KindRegistry,
	confirmed: string | undefined,
): Promise<void> => {
	const changes = planReset(currentSnapshot, registry);
	const databaseName = await currentDatabaseName(driver);
	assertResetConfirmed(databaseName, changes, confirmed);
	await driver.transaction(async (session) => {
		if (changes.length > 0) {
			// COUPLING NOTE (flagged for the G4 rework): `emitStatementsSql`
			// is group 4's own export, and the lead's ruling there moves
			// split assembly into `generateMigration` itself, taking this
			// symbol off @hejbro/core's public surface (0 new symbols is
			// the point of that rework). This call site has to move to
			// whatever core exposes instead when that lands -- it cannot
			// stay as a public-surface call once the export is gone.
			const sql = emitStatementsSql(changes, changes, emptySnapshot, registry);
			if (sql !== "") {
				await session.execute({ sql, params: [], kind: "sql" });
			}
		}
		await clearLedger(session);
	});
};

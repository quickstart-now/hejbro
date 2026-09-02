import {
	buildSnapshot,
	createDefaultRegistry,
	emptySnapshot,
	existingTable,
	getTableMeta,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import type {
	CompileResult,
	Driver,
	DriverRow,
	DriverSession,
} from "@hejbro/query";
import { describe, expect, it } from "vitest";
import {
	bootstrapLedger,
	readLedger,
	recordAppliedMigration,
} from "../src/apply/ledger";
import {
	applyReset,
	assertResetConfirmed,
	currentDatabaseName,
	planReset,
	requiredConfirmation,
} from "../src/apply/reset";

const registry = createDefaultRegistry();
const app = schema("app");

const managedSnapshot = buildSnapshot(
	[app, getTableMeta(table(app, "managed", { id: uuid().primaryKey() }))],
	registry,
	emptySnapshot,
);

/**
 * A fake `Driver` whose `transaction()` hands the callback one in-memory
 * ledger-and-recording session -- the ledger half actually stores rows
 * (so `readLedger` after a reset proves something), `select
 * current_database()` answers with `databaseName` (the confirmation's own
 * source of truth, 5.2's revision), and everything else just records
 * what was sent, mirroring `apply-execute.test.ts`'s own fake driver
 * shape.
 */
const makeFakeDriver = (
	databaseName = "testdb",
): {
	readonly driver: Driver;
	readonly calls: CompileResult[];
	readonly ledgerRows: string[];
} => {
	const calls: CompileResult[] = [];
	const ledgerRows: string[] = [];
	const session: DriverSession = {
		execute: async (compiled): Promise<ReadonlyArray<DriverRow>> => {
			calls.push(compiled);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select current_database()")) {
				return [{ name: databaseName }];
			}
			if (sql.startsWith("create schema") || sql.startsWith("create table")) {
				return [];
			}
			if (sql.startsWith("insert into")) {
				ledgerRows.push(String(compiled.params[0]));
				return [];
			}
			if (sql.startsWith("delete from")) {
				ledgerRows.length = 0;
				return [];
			}
			if (sql.startsWith("select")) {
				return ledgerRows.map((filename) => ({ filename }));
			}
			// Any other statement (the DROP DDL reset itself sends) is just
			// recorded, not interpreted -- these tests assert on its text.
			return [];
		},
	};
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
		},
		execute: session.execute,
		transaction: async (callback) => callback(session),
		setupSession: async () => {},
	};
	return { driver, calls, ledgerRows };
};

describe("planReset / 5.1", () => {
	it("drops only declared objects", () => {
		// `app` (the schema itself) is declared too, so it drops as well --
		// reverse of creation order (table before its own schema), the
		// same order `diffSnapshots` already proves elsewhere
		// (core's own "orders drops in reverse" test).
		const changes = planReset(managedSnapshot, registry);

		expect(changes.every((change) => change.operation === "drop")).toBe(true);
		expect(
			changes.map((change) => `${change.kind}:${change.identity}`),
		).toEqual(["table:app.managed", "schema:app"]);
	});

	it("leaves an unmanaged table standing", async () => {
		// "Unmanaged" means exactly this: an object the declarations never
		// described, so it was never in the snapshot reset reads from --
		// there is nothing here reset could even name, structurally, the
		// same way `generate` never emits DDL for an object it was never
		// told about.
		const { driver, calls } = makeFakeDriver();

		await applyReset(driver, managedSnapshot, registry, "testdb:2");

		const ddlCalls = calls.filter(
			(call) =>
				!call.sql.toLowerCase().includes("ledger") &&
				(call.sql.toLowerCase().includes("drop") ||
					call.sql.toLowerCase().includes("create")),
		);
		// Targets the actual DROP statement's own quoted identifier, not
		// just any substring match -- [G4 rework, #610] reset's DDL now
		// carries a migration banner too (see the test below), and that
		// banner's own identity line (`-- - table app.managed`) would
		// satisfy a bare `.includes("managed")` on its own, proving nothing
		// about whether real DDL for it was ever emitted.
		expect(
			ddlCalls.some((call) => call.sql.includes('drop table "app"."managed"')),
		).toBe(true);
		expect(ddlCalls.some((call) => call.sql.includes("unmanaged"))).toBe(false);
	});

	// add-unmanaged-objects, 2.3: an `existingTable()` declaration is a
	// declaration (unlike the `UnmanagedTable` case above), but the
	// snapshot marks it `existing: true` and core's DDL-blocking guard
	// (`isExistingSide`, table-kind.ts) makes it invisible to
	// `diffSnapshots` on either side -- reset's own `planReset` and its
	// DDL-generating `generateMigrations` call both route through that
	// same guard, so this table should never appear in the drop plan,
	// never raise the confirmation count, and never appear in the DDL
	// reset actually sends.
	it("leaves a declared-but-existing table standing, and never counts it toward the drop confirmation", async () => {
		const authUsers = existingTable("auth", "users", {
			id: uuid().primaryKey(),
		});
		const snapshotWithExisting = buildSnapshot(
			[
				app,
				getTableMeta(table(app, "managed", { id: uuid().primaryKey() })),
				getTableMeta(authUsers),
			],
			registry,
			emptySnapshot,
		);

		const changes = planReset(snapshotWithExisting, registry);
		expect(
			changes.map((change) => `${change.kind}:${change.identity}`),
		).toEqual(["table:app.managed", "schema:app"]);

		const { driver, calls } = makeFakeDriver();
		const confirmation = requiredConfirmation("testdb", changes);

		await applyReset(driver, snapshotWithExisting, registry, confirmation);

		const ddlCalls = calls.filter(
			(call) =>
				!call.sql.toLowerCase().includes("ledger") &&
				(call.sql.toLowerCase().includes("drop") ||
					call.sql.toLowerCase().includes("create")),
		);
		expect(
			ddlCalls.some((call) => call.sql.includes('drop table "app"."managed"')),
		).toBe(true);
		expect(
			ddlCalls.some((call) => call.sql.toLowerCase().includes("auth")),
		).toBe(false);
	});

	// [G4 rework, #610] reset now builds its DDL by reusing
	// `generateMigrations` (declarations: [] against the live snapshot) --
	// the same pipeline `generate` itself runs -- rather than a
	// reset-only emitter. That reuse's own side effect: the SQL text
	// reset sends now opens with a migration banner (harmless SQL
	// comments), which it never did before. Pinned here as the
	// intentional, observed shape of that change, not merely asserted to
	// be harmless.
	it("carries a migration banner ahead of its DDL, a side effect of reusing generateMigrations", async () => {
		const { driver, calls } = makeFakeDriver();

		await applyReset(driver, managedSnapshot, registry, "testdb:2");

		const ddlCall = calls.find((call) =>
			call.sql.toLowerCase().includes("drop table"),
		);
		expect(ddlCall?.sql.startsWith("-- hejbro migration")).toBe(true);
		expect(ddlCall?.sql).toContain("-- - table app.managed");
		expect(ddlCall?.sql).toContain('drop table "app"."managed"');
	});
});

describe("assertResetConfirmed / 5.2", () => {
	it("refuses without confirmation, naming what it would drop", () => {
		const changes = planReset(managedSnapshot, registry);

		expect(() => assertResetConfirmed("testdb", changes, undefined)).toThrow(
			expect.objectContaining({ code: "reset-not-confirmed" }),
		);
		try {
			assertResetConfirmed("testdb", changes, undefined);
			throw new Error("expected assertResetConfirmed to throw");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain("table:app.managed");
			expect(message).toContain('"testdb"');
			expect(message).toContain("Next:");
			expect(message).toContain("--confirm-drop testdb:2");
		}
	});

	it("accepts the exact database-and-count confirmation", () => {
		const changes = planReset(managedSnapshot, registry);

		expect(() =>
			assertResetConfirmed("testdb", changes, "testdb:2"),
		).not.toThrow();
	});

	// The property 5.2's revision exists for: this product's own
	// determinism means the same declarations always diff to the same
	// *count*, on any database they were ever applied to -- so a
	// count-only confirmation learned against one database is silently
	// valid against a different one it was never meant for. Binding the
	// confirmation to the database's own name closes exactly this gap.
	it("a confirmation valid for one database is refused against a different one, even with the same count", () => {
		const changes = planReset(managedSnapshot, registry);
		// The confirmation `assertResetConfirmed` would have accepted for
		// "dev" -- the exact count is identical, since it comes from the
		// same declarations.
		const confirmationLearnedOnDev = requiredConfirmation("dev", changes);

		expect(() =>
			assertResetConfirmed("prod", changes, confirmationLearnedOnDev),
		).toThrow(expect.objectContaining({ code: "reset-not-confirmed" }));
	});

	it("needs no confirmation when there is nothing to drop", () => {
		expect(() => assertResetConfirmed("testdb", [], undefined)).not.toThrow();
	});
});

describe("currentDatabaseName", () => {
	it("reads current_database() from the live connection, never a caller-supplied guess", async () => {
		const { driver } = makeFakeDriver("live-db-name");

		await expect(currentDatabaseName(driver)).resolves.toBe("live-db-name");
	});
});

describe("applyReset / 5.3", () => {
	it("a reset empties the ledger for what it dropped", async () => {
		const { driver } = makeFakeDriver();
		// Seed the ledger as if migrations had already run.
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_managed.sql", "applied");
		});

		await applyReset(driver, managedSnapshot, registry, "testdb:2");

		const state = await driver.transaction((session) => readLedger(session));
		expect(state).toEqual({ exists: true, applied: [] });
	});

	it("refuses without confirmation and sends no DDL", async () => {
		const { driver, calls } = makeFakeDriver();

		await expect(
			applyReset(driver, managedSnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-not-confirmed" });
		// The one call that IS allowed through is the read-only
		// current_database() probe -- refusing still has to know which
		// database it is refusing to drop.
		expect(
			calls.filter(
				(call) => !call.sql.toLowerCase().startsWith("select current_database"),
			),
		).toHaveLength(0);
	});
});

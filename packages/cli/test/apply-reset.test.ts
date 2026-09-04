import type { ColumnSnapshot, Snapshot, TableSnapshot } from "@hejbro/core";
import {
	buildSnapshot,
	createDefaultRegistry,
	emptySnapshot,
	existingTable,
	getTableMeta,
	HejbroError,
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
 *
 * `dropFailure` (task 1.4, #753): when set, the drop DDL statement reset
 * itself sends (the one statement this fake doesn't otherwise interpret)
 * throws `dropFailure.thrown` instead of succeeding -- standing in for
 * the database refusing the drop (e.g. an object outside the
 * declarations still depending on the one being dropped). A distinct
 * `{ thrown }` wrapper, not the bare value, so `undefined` itself can be
 * asserted as a thrown value without being mistaken for "no failure
 * configured".
 *
 * `ledgerDeleteFailure` (D106 R1, B1, #753 reopened): when set, the
 * ledger's own `delete from` statement throws `ledgerDeleteFailure.thrown`
 * instead of succeeding, independent of `dropFailure` -- standing in for
 * the ledger delete failing even though `select to_regclass(...)` already
 * answered "this table exists" (the exact edge the fix must not swallow).
 * `ledgerBootstrapped` tracks whether `create schema`/`create table` ever
 * ran (mirroring `bootstrapLedger`'s own two statements), so the fake's
 * `select to_regclass(...)` branch can answer honestly instead of always
 * claiming the ledger exists.
 */
const makeFakeDriver = (
	databaseName = "testdb",
	dropFailure?: { readonly thrown: unknown },
	ledgerDeleteFailure?: { readonly thrown: unknown },
): {
	readonly driver: Driver;
	readonly calls: CompileResult[];
	readonly ledgerRows: string[];
} => {
	const calls: CompileResult[] = [];
	const ledgerRows: string[] = [];
	const ledgerState = { bootstrapped: false };
	const session: DriverSession = {
		execute: async (compiled): Promise<ReadonlyArray<DriverRow>> => {
			calls.push(compiled);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select current_database()")) {
				return [{ name: databaseName }];
			}
			if (sql.startsWith("select to_regclass(")) {
				if (ledgerState.bootstrapped) {
					return [{ reg: "hejbro.migration_ledger" }];
				}
				return [{ reg: null }];
			}
			if (sql.startsWith("create schema") || sql.startsWith("create table")) {
				ledgerState.bootstrapped = true;
				return [];
			}
			if (sql.startsWith("insert into")) {
				ledgerRows.push(String(compiled.params[0]));
				return [];
			}
			if (sql.startsWith("delete from")) {
				if (ledgerDeleteFailure !== undefined) {
					throw ledgerDeleteFailure.thrown;
				}
				ledgerRows.length = 0;
				return [];
			}
			if (sql.startsWith("select")) {
				return ledgerRows.map((filename) => ({ filename }));
			}
			// Any other statement (the DROP DDL reset itself sends) is just
			// recorded, not interpreted -- these tests assert on its text --
			// unless a drop failure was configured, in which case this is
			// exactly the statement that fails.
			if (dropFailure !== undefined) {
				throw dropFailure.thrown;
			}
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

describe("applyReset — a failed drop is reported as a coded error, not an uncaught crash (task 1.4, #753)", () => {
	const seedLedger = async (driver: Driver): Promise<void> => {
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_managed.sql", "applied");
		});
	};

	/** Every row asserts the same three facts (task 1.4's own input table: what the fake driver's `transaction` callback throws varies, these three never do). */
	const assertCodedFailure = async (
		driver: Driver,
		error: unknown,
	): Promise<void> => {
		expect(error).toBeInstanceOf(HejbroError);
		expect((error as HejbroError).code).toBe("reset-drop-failed");
		const state = await driver.transaction((session) => readLedger(session));
		if (!state.exists) {
			throw new Error("expected the ledger to still exist after a failed drop");
		}
		expect(state.applied.map((row) => row.filename)).toEqual([
			"0001_add_managed.sql",
		]);
	};

	it("an object carrying both .code and .message -- both surface, coded", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(new Error("relation still has dependents"), {
				code: "2BP01",
			}),
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		await assertCodedFailure(driver, error);
		expect((error as HejbroError).message).toContain("(2BP01)");
		expect((error as HejbroError).message).toContain(
			"relation still has dependents",
		);
	});

	it("an Error with a .message but no .code -- the reason still surfaces, no code suffix", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: new Error("connection reset by peer"),
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		await assertCodedFailure(driver, error);
		expect((error as HejbroError).message).toContain(
			"connection reset by peer",
		);
		expect((error as HejbroError).message).not.toMatch(/\([A-Z0-9]+\)/);
	});

	it("a bare non-Error thrown value (a string) -- applyReset still rejects with a HejbroError, never the raw value", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: "the database just closed the connection",
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		await assertCodedFailure(driver, error);
		expect((error as HejbroError).message).toContain(
			"the database just closed the connection",
		);
	});
});

describe("applyReset — a hejbro-coded failure inside the transaction keeps its own code (task 3.8, #753)", () => {
	const seedLedger = async (driver: Driver): Promise<void> => {
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_managed.sql", "applied");
		});
	};

	it("a HejbroError raised inside the transaction -- its own code survives, not reset-drop-failed", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: new HejbroError(
				"reset-migration-not-singular",
				"reset's own migration run produced 2 file(s), not exactly one",
			),
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(HejbroError);
		expect((error as HejbroError).code).toBe("reset-migration-not-singular");
	});

	it("a driver error with .code/.message -- still reset-drop-failed (task 1.4's own regression pin)", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(new Error("relation still has dependents"), {
				code: "2BP01",
			}),
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(HejbroError);
		expect((error as HejbroError).code).toBe("reset-drop-failed");
	});

	it("a bare non-Error thrown value -- still reset-drop-failed", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: "the database just closed the connection",
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(HejbroError);
		expect((error as HejbroError).code).toBe("reset-drop-failed");
	});
});

describe("applyReset — a ledger that was never bootstrapped still lets every drop through (D106 R1, B1, #753 reopened)", () => {
	it("drops every declared object and reports the ledger was NOT cleared, when the ledger table does not exist", async () => {
		// No `seedLedger` here: `bootstrapLedger` never ran, mirroring B1's
		// own reproduction (every migration applied outside hejbro, so
		// `hejbro.migration_ledger` never existed).
		const { driver, calls } = makeFakeDriver();

		const result = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result).toEqual({ ledgerCleared: false });
		const ddlCalls = calls.filter((call) =>
			call.sql.toLowerCase().includes("drop table"),
		);
		expect(
			ddlCalls.some((call) => call.sql.includes('drop table "app"."managed"')),
		).toBe(true);
		expect(
			calls.some((call) => call.sql.toLowerCase().startsWith("delete from")),
		).toBe(false);
	});

	it("a ledger-delete failure surfaces as reset-drop-failed, never swallowed into a silent COMMIT", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, {
			thrown: Object.assign(
				new Error('relation "hejbro.migration_ledger" does not exist'),
				{ code: "42P01" },
			),
		});
		// Bootstrapped, so `select to_regclass(...)` answers "exists" -- the
		// delete below is the one this fix must not let a caught-and-ignored
		// 42P01 turn into a false success (B1's own root cause).
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_managed.sql", "applied");
		});

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(HejbroError);
		expect((error as HejbroError).code).toBe("reset-drop-failed");
	});
});

describe("applyReset — reset-drop-failed carries the server's detail and picks its own Next: advice (D106 R1, N2+N3, #753 reopened)", () => {
	const seedLedger = async (driver: Driver): Promise<void> => {
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_managed.sql", "applied");
		});
	};

	it("(i) a driver error carrying a detail -- the message carries it verbatim after the server's reason", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(
				new Error(
					"cannot drop table lab.b_parent because other objects depend on it",
				),
				{
					code: "2BP01",
					detail: "view lab.outside_view depends on table lab.b_parent",
				},
			),
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		const message = (error as HejbroError).message;
		expect(message).toContain(
			"cannot drop table lab.b_parent because other objects depend on it",
		);
		expect(message).toContain(
			"view lab.outside_view depends on table lab.b_parent",
		);
		expect(message.indexOf("because other objects depend on it")).toBeLessThan(
			message.indexOf("view lab.outside_view"),
		);
	});

	it("(ii) no detail -- the message is unchanged from today", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(new Error("relation still has dependents"), {
				code: "2BP01",
			}),
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		const message = (error as HejbroError).message;
		expect(message).toContain("relation still has dependents");
		expect(message).not.toContain("()");
	});

	// A genuine mutual foreign-key cycle can't be built through table()
	// itself (its `extras` callback resolves `references: { table }`
	// eagerly, each side needing the other to already exist) -- spliced
	// directly at the snapshot level instead, mirroring
	// `diff-engine.test.ts`'s own "never throws on a genuine two-table
	// cycle" fixture. Shared by (iii) and (v): `dropsContainCycle` reads
	// this run's own plan, not the driver error, so both rows need the
	// identical structurally-cyclic snapshot.
	const buildCycleSnapshot = (): Snapshot => {
		const cycleColumns: ReadonlyArray<ColumnSnapshot> = [
			{ name: "id", typeNode: { typeName: "uuid" }, primaryKey: true },
		];
		const leftT: TableSnapshot = {
			schema: "cyc",
			name: "left_t",
			columns: [
				...cycleColumns,
				{ name: "right_id", typeNode: { typeName: "uuid" } },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "left_t_right_id_fk",
					columns: ["right_id"],
					referencesTable: "cyc.right_t",
					referencesColumns: ["id"],
				},
			],
		};
		const rightT: TableSnapshot = {
			schema: "cyc",
			name: "right_t",
			columns: [
				...cycleColumns,
				{ name: "left_id", typeNode: { typeName: "uuid" } },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "right_t_left_id_fk",
					columns: ["left_id"],
					referencesTable: "cyc.left_t",
					referencesColumns: ["id"],
				},
			],
		};
		return {
			...emptySnapshot,
			objects: {
				"schema:cyc": { name: "cyc" },
				"table:cyc.left_t": leftT,
				"table:cyc.right_t": rightT,
			},
		};
	};

	it("(iii) the run's own plan contains a cycle -- Next: states the cycle fact, additive to the outside-declarations possibility, never a replacement for it", async () => {
		const cycleSnapshot = buildCycleSnapshot();
		const changes = planReset(cycleSnapshot, registry);
		const confirmation = requiredConfirmation("testdb", changes);
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(
				new Error(
					"cannot drop table cyc.left_t because other objects depend on it",
				),
				{ code: "2BP01" },
			),
		});
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_cycle.sql", "applied");
		});

		const error: unknown = await applyReset(
			driver,
			cycleSnapshot,
			registry,
			confirmation,
		).catch((caught: unknown) => caught);

		// [C5] `dropsContainCycle` only knows the plan itself contains a
		// cycle, never that the cycle is what the server actually refused
		// over (the driver names an object, not an edge) -- a real outside
		// dependent is just as possible for this same plan (the next row),
		// so the message states the cycle fact and keeps the
		// outside-declarations clause too, asserting neither exclusively.
		const message = (error as HejbroError).message;
		expect(message).toContain("your own declared objects");
		expect(message).toContain("an object outside your declarations");
	});

	it("(iv) the outside-dependent case keeps today's Next: advice", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(
				new Error(
					"cannot drop table app.managed because other objects depend on it",
				),
				{ code: "2BP01" },
			),
		});
		await seedLedger(driver);

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		expect((error as HejbroError).message).toContain(
			"an object outside your declarations may still depend on one you're dropping",
		);
	});

	it("(v) the run's own plan contains a cycle AND the actual failure names an outside dependent -- Next: still carries both, asserting neither as the sole cause", async () => {
		const cycleSnapshot = buildCycleSnapshot();
		const changes = planReset(cycleSnapshot, registry);
		const confirmation = requiredConfirmation("testdb", changes);
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(
				new Error(
					"cannot drop table cyc.left_t because other objects depend on it",
				),
				{
					code: "2BP01",
					detail: "view outside_view depends on table cyc.left_t",
				},
			),
		});
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_cycle.sql", "applied");
		});

		const error: unknown = await applyReset(
			driver,
			cycleSnapshot,
			registry,
			confirmation,
		).catch((caught: unknown) => caught);

		const message = (error as HejbroError).message;
		expect(message).toContain("view outside_view depends on table cyc.left_t");
		expect(message).toContain("your own declared objects");
		expect(message).toContain("an object outside your declarations");
	});
});

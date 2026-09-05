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

// A genuine mutual foreign-key cycle can't be built through table()
// itself (its `extras` callback resolves `references: { table }`
// eagerly, each side needing the other to already exist) -- spliced
// directly at the snapshot level instead, mirroring
// `diff-engine.test.ts`'s own "never throws on a genuine two-table
// cycle" fixture. Shared by every cycle-shaped row below: `dropsContainCycle`
// reads this run's own plan, not the driver error, so every one needs the
// identical structurally-cyclic snapshot.
const CYCLE_ID_COLUMN: ColumnSnapshot = {
	name: "id",
	typeNode: { typeName: "uuid" },
	primaryKey: true,
};

/** One declared table in schema `cyc`, with a foreign key naming `targetName` (or no foreign key at all when `targetName` is `undefined` -- a chain's own last link). */
const cycleTable = (name: string, targetName?: string): TableSnapshot => {
	if (targetName === undefined) {
		return {
			schema: "cyc",
			name,
			columns: [CYCLE_ID_COLUMN],
			indexes: [],
			foreignKeys: [],
		};
	}
	const fkColumn = `${targetName}_id`;
	return {
		schema: "cyc",
		name,
		columns: [
			CYCLE_ID_COLUMN,
			{ name: fkColumn, typeNode: { typeName: "uuid" } },
		],
		indexes: [],
		foreignKeys: [
			{
				name: `${name}_${fkColumn}_fk`,
				columns: [fkColumn],
				referencesTable: `cyc.${targetName}`,
				referencesColumns: ["id"],
			},
		],
	};
};

const emptyCycSnapshot: Snapshot = {
	...emptySnapshot,
	objects: { "schema:cyc": { name: "cyc" } },
};

const withCycleTable = (
	snapshot: Snapshot,
	table: TableSnapshot,
): Snapshot => ({
	...snapshot,
	objects: { ...snapshot.objects, [`table:cyc.${table.name}`]: table },
});

/** A ring of `tableNames.length` declared tables, each referencing the next (wrapping around) -- a genuine cycle of that length. `["left_t", "right_t"]` reproduces today's pair. */
const buildCycleSnapshot = (tableNames: ReadonlyArray<string>): Snapshot =>
	tableNames.reduce((snapshot, name, index) => {
		const targetName = tableNames[(index + 1) % tableNames.length];
		return withCycleTable(snapshot, cycleTable(name, targetName));
	}, emptyCycSnapshot);

/** One table referencing itself -- excluded from `kindHasCycle`'s own peel (its drop takes its own constraint with it), so this is never a cycle. */
const buildSelfReferencingSnapshot = (tableName: string): Snapshot =>
	withCycleTable(emptyCycSnapshot, cycleTable(tableName, tableName));

/** Two or more independent cycles, merged into one declared set -- a cycle exists even though it is not the whole set. */
const buildDisjointCyclesSnapshot = (
	groups: ReadonlyArray<ReadonlyArray<string>>,
): Snapshot => ({
	...emptyCycSnapshot,
	objects: Object.assign(
		{},
		...groups.map((group) => buildCycleSnapshot(group).objects),
	),
});

/** A linear chain, each table referencing the next, the last referencing nothing -- acyclic (`kindHasCycle`'s own peel resolves it in reverse-dependency order). */
const buildChainSnapshot = (tableNames: ReadonlyArray<string>): Snapshot =>
	tableNames.reduce((snapshot, name, index) => {
		const targetName = tableNames[index + 1];
		return withCycleTable(snapshot, cycleTable(name, targetName));
	}, emptyCycSnapshot);

/** A cycle plus one acyclic table that depends on one cycle member (never the reverse) -- the cycle must still be found among a larger declared set. */
const buildCyclePlusDanglingSnapshot = (
	cycleNames: ReadonlyArray<string>,
	danglingName: string,
): Snapshot =>
	withCycleTable(
		buildCycleSnapshot(cycleNames),
		cycleTable(danglingName, cycleNames[0]),
	);

/** One `pg_class`/`pg_attribute` row shape, as `probeLedgerIdentity`'s own statement returns it. */
type ProbeRow = {
	readonly relkind: string;
	/** [2.2, 783/R5] `c.relpersistence` -- optional because only the real-ledger fixture below needs `"p"` (logged) to be judged `ledger`; every occupied-only row's own word/judgement is persistence-independent. */
	readonly persistence?: string;
	readonly name: string | null;
	readonly type: string | null;
};

/** The four bootstrap columns, exactly as `bootstrapLedger` creates them -- the fake's default "ledger" answer when a caller does not override the probe. */
const LEDGER_PROBE_ROWS: ReadonlyArray<ProbeRow> = [
	{ relkind: "r", persistence: "p", name: "id", type: "bigint" },
	{ relkind: "r", persistence: "p", name: "filename", type: "text" },
	{ relkind: "r", persistence: "p", name: "origin", type: "text" },
	{
		relkind: "r",
		persistence: "p",
		name: "applied_at",
		type: "timestamp with time zone",
	},
];

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
 * the ledger delete failing even though the identity probe already found
 * the real ledger (the exact edge the fix must not swallow).
 *
 * `probeRows` (harden-ledger-identity, 1.2): when set, answers
 * `probeLedgerIdentity`'s own statement with exactly these rows,
 * regardless of bootstrap state -- how the occupied-name scenarios are
 * built. When unset, the probe answers honestly from `ledgerState`
 * (`bootstrapped`, tracking `create schema`/`create table` the same way
 * the old `select to_regclass(...)` branch did): the real ledger's four
 * columns once bootstrapped, no row before that.
 */
const makeFakeDriver = (
	databaseName = "testdb",
	dropFailure?: { readonly thrown: unknown },
	ledgerDeleteFailure?: { readonly thrown: unknown },
	probeRows?: ReadonlyArray<ProbeRow>,
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
			if (sql.startsWith("select c.relkind")) {
				if (probeRows !== undefined) {
					return probeRows as unknown as ReadonlyArray<DriverRow>;
				}
				if (ledgerState.bootstrapped) {
					return LEDGER_PROBE_ROWS as unknown as ReadonlyArray<DriverRow>;
				}
				return [];
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
		// The two calls that ARE allowed through are the read-only identity
		// probe and current_database() -- refusing still has to know the
		// ledger is really the ledger and which database it is refusing to
		// drop.
		expect(
			calls.filter((call) => {
				const sql = call.sql.toLowerCase();
				return (
					!sql.startsWith("select current_database") &&
					!sql.startsWith("select c.relkind")
				);
			}),
		).toHaveLength(0);
	});
});

describe("applyReset — a relation that is not the ledger at the ledger's name is refused before any confirmation is asked (harden-ledger-identity, 1.2)", () => {
	it.each<[string, ReadonlyArray<ProbeRow>, string, ReadonlyArray<string>]>([
		["a view", [{ relkind: "v", name: "x", type: "integer" }], "view", ["x"]],
		[
			"a table holding rows (name, payload)",
			[
				{ relkind: "r", name: "name", type: "text" },
				{ relkind: "r", name: "payload", type: "jsonb" },
			],
			"table",
			["name", "payload"],
		],
		[
			"a table (id, filename)",
			[
				{ relkind: "r", name: "id", type: "bigint" },
				{ relkind: "r", name: "filename", type: "text" },
			],
			"table",
			["id", "filename"],
		],
	])(
		"refuses with apply-ledger-occupied, confirmed undefined -- %s",
		async (_label, probeRows, relationWord, columns) => {
			const { driver, calls } = makeFakeDriver(
				"testdb",
				undefined,
				undefined,
				probeRows,
			);

			const error: unknown = await applyReset(
				driver,
				managedSnapshot,
				registry,
				undefined,
			).catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("apply-ledger-occupied");
			const message = (error as HejbroError).message;
			expect(message).toContain(relationWord);
			columns.map((column) => expect(message).toContain(column));
			expect(message).toContain("Next:");
			expect(
				calls.some((call) =>
					call.sql.toLowerCase().startsWith("select current_database"),
				),
			).toBe(false);
			expect(
				calls.some((call) => call.sql.toLowerCase().startsWith("drop")),
			).toBe(false);
			expect(
				calls.some((call) => call.sql.toLowerCase().startsWith("delete from")),
			).toBe(false);
		},
	);

	it("regression: an absent ledger with confirmation drops and clears nothing, ledgerCleared false", async () => {
		const { driver, calls } = makeFakeDriver(
			"testdb",
			undefined,
			undefined,
			[],
		);

		const result = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result).toEqual({ ledgerCleared: false });
		expect(
			calls.some((call) => call.sql.toLowerCase().startsWith("delete from")),
		).toBe(false);
	});

	it("regression: an absent ledger without confirmation still refuses reset-not-confirmed, not apply-ledger-occupied", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, undefined, []);

		await expect(
			applyReset(driver, managedSnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-not-confirmed" });
	});

	it("regression: the exact ledger drops and clears, ledgerCleared true", async () => {
		const { driver, calls } = makeFakeDriver(
			"testdb",
			undefined,
			undefined,
			LEDGER_PROBE_ROWS,
		);

		const result = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result).toEqual({ ledgerCleared: true });
		expect(
			calls.some((call) => call.sql.toLowerCase().startsWith("delete from")),
		).toBe(true);
	});

	it("regression: the ledger with an extra column drops and clears the same as the exact ledger", async () => {
		const { driver, calls } = makeFakeDriver("testdb", undefined, undefined, [
			...LEDGER_PROBE_ROWS,
			{ relkind: "r", name: "note", type: "text" },
		]);

		const result = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result).toEqual({ ledgerCleared: true });
		expect(
			calls.some((call) => call.sql.toLowerCase().startsWith("delete from")),
		).toBe(true);
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

	it("a ledger-delete failure surfaces coded, never swallowed into a silent COMMIT (task 1.7: apply-ledger-unwritable, not reset-drop-failed -- see the phase-naming describe below)", async () => {
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
		expect((error as HejbroError).code).toBe("apply-ledger-unwritable");
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

	it("(iii) the run's own plan contains a cycle, no detail from the server -- Next: states the cycle fact, additive to the outside-declarations possibility, never claims a detail that isn't there", async () => {
		const cycleSnapshot = buildCycleSnapshot(["left_t", "right_t"]);
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
		expect(message).toContain("your declared tables");
		expect(message).toContain("an object outside your declarations");
		// [C10, D106 R1 review round 2] This thrown error carries no
		// `.detail` -- the detail-pointer clause must not claim one exists
		// when `driverErrorDetail` read null.
		expect(message).not.toContain("the detail above");
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
		const cycleSnapshot = buildCycleSnapshot(["left_t", "right_t"]);
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
		expect(message).toContain("your declared tables");
		expect(message).toContain("an object outside your declarations");
	});
});

describe("applyReset — the cycle advice fires for a cycle of any length (harden-ledger-identity, 1.6, 797/R1)", () => {
	const dependencyFailure = Object.assign(
		new Error(
			"cannot drop table cyc.some_table because other objects depend on it",
		),
		{ code: "2BP01" },
	);

	it.each<[string, Snapshot, boolean]>([
		[
			"a 2-cycle (regression pin)",
			buildCycleSnapshot(["left_t", "right_t"]),
			true,
		],
		["a 3-cycle", buildCycleSnapshot(["t_a", "t_b", "t_c"]), true],
		["a 4-cycle", buildCycleSnapshot(["t_a", "t_b", "t_c", "t_d"]), true],
		[
			"a self-referencing table alone",
			buildSelfReferencingSnapshot("t_self"),
			false,
		],
		[
			"two independent 2-cycles",
			buildDisjointCyclesSnapshot([
				["p_a", "p_b"],
				["q_a", "q_b"],
			]),
			true,
		],
		[
			"an acyclic chain a -> b -> c",
			buildChainSnapshot(["t_a", "t_b", "t_c"]),
			false,
		],
		[
			"a 3-cycle plus one acyclic table hanging off it",
			buildCyclePlusDanglingSnapshot(["t_a", "t_b", "t_c"], "t_d"),
			true,
		],
	])(
		"%s -- cycle advice present: %s",
		async (_label, snapshot, expectAdvice) => {
			const changes = planReset(snapshot, registry);
			const confirmation = requiredConfirmation("testdb", changes);
			const { driver } = makeFakeDriver("testdb", {
				thrown: dependencyFailure,
			});

			const error: unknown = await applyReset(
				driver,
				snapshot,
				registry,
				confirmation,
			).catch((caught: unknown) => caught);

			const message = (error as HejbroError).message;
			if (expectAdvice) {
				expect(message).toContain("your declared tables");
				expect(message).toContain("in a cycle");
			} else {
				expect(message).not.toContain("your declared tables");
				expect(message).toContain("an object outside your declarations");
			}
		},
	);
});

describe("applyReset — reset-drop-failed names the phase that actually failed (D106 R1, NB1+NB4, lead ruling R86, #753 reopened)", () => {
	const seedLedger = async (driver: Driver): Promise<void> => {
		await driver.transaction(async (session) => {
			await bootstrapLedger(session);
			await recordAppliedMigration(session, "0001_add_managed.sql", "applied");
		});
	};

	it("① 55000 from the ledger clear -- task 1.7: apply-ledger-unwritable naming the ledger, not reset-drop-failed (every ledger-clear failure is tagged by ledger.ts's own exec regardless of SQLSTATE, D6)", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, {
			thrown: Object.assign(
				new Error(
					'relation "hejbro.migration_ledger" does not exist, but a view of that name does',
				),
				{ code: "55000" },
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
		expect((error as HejbroError).code).toBe("apply-ledger-unwritable");
		const message = (error as HejbroError).message;
		expect(message).toContain("the clearing of the ledger's rows");
		expect(message).not.toContain("failed to drop your declared objects");
		expect(message).not.toContain("resolve what the error above describes (");
	});

	it("② 42501 from the drop -- drop-phase wording, no dependency advice", async () => {
		const { driver } = makeFakeDriver("testdb", {
			thrown: Object.assign(new Error("must be owner of table managed"), {
				code: "42501",
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
		const message = (error as HejbroError).message;
		expect(message).toContain(
			"hejbro reset failed to drop your declared objects",
		);
		expect(message).toContain("must be owner of table managed");
		expect(message).not.toContain("resolve what the error above describes (");
	});

	it("③ 42P01 from the ledger clear (TOCTOU) -- task 1.7: apply-ledger-unwritable, still rejects, still names no drop/dependency claim", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, {
			thrown: Object.assign(
				new Error('relation "hejbro.migration_ledger" does not exist'),
				{ code: "42P01" },
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
		expect((error as HejbroError).code).toBe("apply-ledger-unwritable");
		const message = (error as HejbroError).message;
		expect(message).toContain("the clearing of the ledger's rows");
		expect(message).not.toContain("failed to drop your declared objects");
		expect(message).not.toContain("resolve what the error above describes (");
	});

	it("task 1.7: 42501 from the ledger clear -- a refused clearing of the ledger is not a refused drop, drops accepted, neither cycle nor dependency advice appears", async () => {
		const { driver, calls } = makeFakeDriver("testdb", undefined, {
			thrown: Object.assign(
				new Error("permission denied for table migration_ledger"),
				{ code: "42501" },
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
		expect((error as HejbroError).code).toBe("apply-ledger-unwritable");
		const message = (error as HejbroError).message;
		expect(message).toContain('"hejbro"."migration_ledger"');
		expect(message).toContain("the clearing of the ledger's rows");
		expect(message).not.toContain(
			"an object outside your declarations may still depend on one you're dropping",
		);
		expect(message).not.toContain(
			"a set of your declared tables that reference each other in a cycle",
		);
		// The drop itself ran (and, inside the one transaction, rolled back
		// together with the refused ledger clear) -- this is a refused
		// clearing, not a refused drop.
		expect(
			calls.some((call) => call.sql.toLowerCase().includes("drop table")),
		).toBe(true);
	});

	it("④ 2BP01, no cycle in the plan -- today's drop-phase wording and outside-declarations advice (regression pin)", async () => {
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

		const message = (error as HejbroError).message;
		expect(message).toContain(
			"hejbro reset failed to drop your declared objects",
		);
		expect(message).toContain(
			"resolve what the error above describes (an object outside your declarations may still depend on one you're dropping)",
		);
	});

	it("⑤ 2BP01, a cycle in the plan -- detail-first ordering, both possibilities, neither asserted as the cause", async () => {
		const cycleSnapshot = buildCycleSnapshot(["left_t", "right_t"]);
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
		const detailPointerIndex = message.indexOf(
			"the detail above names the actual dependent",
		);
		const cycleClauseIndex = message.indexOf("your declared tables");
		const outsideClauseIndex = message.indexOf(
			"an object outside your declarations",
		);
		expect(detailPointerIndex).toBeGreaterThan(-1);
		expect(cycleClauseIndex).toBeGreaterThan(-1);
		expect(outsideClauseIndex).toBeGreaterThan(-1);
		// NB4's own ordering: the detail pointer comes first.
		expect(detailPointerIndex).toBeLessThan(cycleClauseIndex);
		expect(detailPointerIndex).toBeLessThan(outsideClauseIndex);
	});

	it("⑥ a HejbroError raised inside the transaction -- its own code survives (task 3.8's pin, unaffected by phase tagging)", async () => {
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

	it("⑦ an untagged failure from the transaction machinery itself -- unknown-phase wording, no drop/ledger claim, no dependency advice", async () => {
		const session: DriverSession = {
			execute: async (compiled) => {
				const sql = compiled.sql.trim().toLowerCase();
				if (sql.startsWith("select current_database()")) {
					return [{ name: "testdb" }];
				}
				if (sql.startsWith("select to_regclass(")) {
					return [{ reg: "hejbro.migration_ledger" }];
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
			// Rejects before the callback ever runs -- standing in for BEGIN
			// itself failing, or the connection dropping before any
			// statement is sent. Never tagged by `throwPhaseTagged` (that
			// only wraps the two statements inside the callback), so this
			// is exactly `resetPhaseOf`'s "unknown" fallback.
			transaction: async () => {
				throw Object.assign(new Error("connection terminated unexpectedly"), {
					code: "08006",
				});
			},
			setupSession: async () => {},
		};

		const error: unknown = await applyReset(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(HejbroError);
		expect((error as HejbroError).code).toBe("reset-drop-failed");
		const message = (error as HejbroError).message;
		expect(message).toContain("hejbro reset's transaction failed");
		expect(message).not.toContain("failed to drop your declared objects");
		expect(message).not.toContain("failed while clearing the ledger");
		expect(message).not.toContain("resolve what the error above describes (");
	});
});

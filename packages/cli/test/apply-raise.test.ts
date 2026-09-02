import {
	emptySnapshot,
	existingTable,
	generateMigration,
	getTableMeta,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import type { CompileResult, Driver, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { readLedger } from "../src/apply/ledger";
import type { SnapshotFile } from "../src/apply/raise";
import { applyRaise, assertDatabaseEmptyByLedger } from "../src/apply/raise";

type FailWhen = (compiled: CompileResult) => boolean;

/**
 * A fake `Driver` mirroring `apply-execute.test.ts`'s and
 * `apply-reset.test.ts`'s own fake driver shape: one in-memory ledger
 * (`ledgerRows`, seedable so a test can start from a database that
 * already has history), every statement recorded, `failWhen` lets a test
 * make exactly one statement fail (the snapshot file's own DDL, never
 * the lock or the ledger read/write, so the failure under test is
 * unambiguous).
 */
const makeFakeDriver = (options?: {
	readonly seededLedgerRows?: ReadonlyArray<string>;
	readonly failWhen?: FailWhen;
	readonly failError?: unknown;
}): {
	readonly driver: Driver;
	readonly calls: CompileResult[];
} => {
	const calls: CompileResult[] = [];
	const ledgerRows: Array<{
		readonly filename: string;
		readonly origin: string;
	}> = (options?.seededLedgerRows ?? []).map((filename) => ({
		filename,
		origin: "applied",
	}));
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			if (options?.failWhen?.(compiled) === true) {
				throw options?.failError ?? new Error("fake failure");
			}
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("create schema") || sql.startsWith("create table")) {
				return [];
			}
			if (sql.startsWith("insert into")) {
				ledgerRows.push({
					filename: String(compiled.params[0]),
					origin: String(compiled.params[1]),
				});
				return [];
			}
			if (sql.startsWith('select "filename"')) {
				return ledgerRows;
			}
			// The snapshot file's own DDL (and the advisory lock statement)
			// -- nothing here interprets it further, matching
			// `apply-execute.test.ts`'s own fake driver.
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
	return { driver, calls };
};

const snapshotFile: SnapshotFile = {
	fileName: "vendor/schema.sql",
	sql: 'create schema "app";\ncreate table "app"."t" (id integer);',
	origin: "raised",
};

// `applyRaise` has no production caller yet -- the real command name is
// still group 7's own `[design]` (7.1) -- so this stands in for whatever
// a real caller passes, the same convention `apply-execute.test.ts`'s own
// `NEXT_COMMAND` fixture follows.
const COMMAND = "hejbro db-up";

describe("applyRaise / 6.1", () => {
	it("applies a snapshot file to an empty database", async () => {
		const { driver, calls } = makeFakeDriver();

		await applyRaise(driver, snapshotFile, COMMAND);

		const ddlCall = calls.find((call) => call.sql === snapshotFile.sql);
		expect(ddlCall).toBeDefined();
		expect(ddlCall?.params).toEqual([]);
	});
});

describe("assertDatabaseEmptyByLedger / 6.2", () => {
	it("passes when the ledger has never been touched", () => {
		expect(() =>
			assertDatabaseEmptyByLedger({ exists: false }, COMMAND),
		).not.toThrow();
	});

	it("passes when the ledger exists but holds no rows", () => {
		expect(() =>
			assertDatabaseEmptyByLedger({ exists: true, applied: [] }, COMMAND),
		).not.toThrow();
	});

	it("refuses, naming the count, when the ledger already records history", () => {
		expect(() =>
			assertDatabaseEmptyByLedger(
				{
					exists: true,
					applied: [{ filename: "0001_init.sql", origin: "applied" }],
				},
				COMMAND,
			),
		).toThrow(expect.objectContaining({ code: "raise-not-empty" }));
	});
});

describe("applyRaise / 6.2", () => {
	it("refuses a database that already has declared objects (ledger says so), before sending the snapshot's own DDL", async () => {
		const { driver, calls } = makeFakeDriver({
			seededLedgerRows: ["0001_init.sql"],
		});

		await expect(
			applyRaise(driver, snapshotFile, COMMAND),
		).rejects.toMatchObject({ code: "raise-not-empty" });

		expect(calls.some((call) => call.sql === snapshotFile.sql)).toBe(false);
	});
});

describe("applyRaise / 16.5 (D106 m4)", () => {
	it("never bootstraps the ledger when it already has history -- a refused database gains no souvenir table", async () => {
		const { driver, calls } = makeFakeDriver({
			seededLedgerRows: ["0001_init.sql"],
		});

		await expect(
			applyRaise(driver, snapshotFile, COMMAND),
		).rejects.toMatchObject({ code: "raise-not-empty" });

		// The emptiness check (readLedger) ran and refused before
		// bootstrapLedger's own two statements ever had a reason to run --
		// not merely idempotent no-ops this time, but calls that never
		// happened at all.
		expect(
			calls.some((call) => call.sql.toLowerCase().startsWith("create schema")),
		).toBe(false);
		expect(
			calls.some((call) => call.sql.toLowerCase().startsWith("create table")),
		).toBe(false);
	});

	// Layer 2 (execute.ts's own `alreadyExists` translation, owned by
	// raise and passed in under the SAME `raise-not-empty` code layer 1
	// uses -- owner/lead review, #612: the two layers report the identical
	// fact, just discovered two different ways). The ledger-based precheck
	// above cannot see a database whose ledger is empty but which already
	// has an object THIS SNAPSHOT WOULD ALSO CREATE -- a genuine collision,
	// `schema "app"` here being exactly what `snapshotFile.sql` itself
	// creates (not an unrelated object; see the passing-case test below
	// for that side of the boundary). Such a database does hold a declared
	// object (the spec's own word), so refusing here is the requirement,
	// not a workaround for a hole the first layer left.
	it("translates the database's own already-exists failure when the ledger is empty but a colliding object exists", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === snapshotFile.sql,
			failError: Object.assign(new Error('schema "app" already exists'), {
				code: "42P06",
			}),
		});

		await expect(
			applyRaise(driver, snapshotFile, COMMAND),
		).rejects.toMatchObject({ code: "raise-not-empty" });
	});

	it("applies nothing when refused this way -- the whole run is one transaction", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === snapshotFile.sql,
			failError: Object.assign(new Error('schema "app" already exists'), {
				code: "42P06",
			}),
		});

		await expect(applyRaise(driver, snapshotFile, COMMAND)).rejects.toThrow();

		const state = await readLedger(driver);
		expect(state).toEqual({ exists: true, applied: [] });
	});

	// The other side of 6.2's boundary (owner/lead correction: this is the
	// contract, not a hole in it): an unmanaged object -- one this
	// snapshot's own DDL never touches -- never makes raise refuse, because
	// raise sends only its own opaque text (proposal: "It does not parse
	// SQL") and never inspects the catalog for anything beyond it
	// (proposal: "It does not validate the database's shape"). There is no
	// separate check to point at here -- passing is the same code path as
	// 6.1's own happy-path test, which is the point: nothing in this
	// module has a notion of "someone else's object" to chase, by
	// construction, not because a catalog scan looked and found none.
	it("never refuses over an object this snapshot's own DDL does not touch (an unmanaged object is not a declared one)", async () => {
		const { driver } = makeFakeDriver();

		await expect(
			applyRaise(driver, snapshotFile, COMMAND),
		).resolves.toBeUndefined();
	});
});

describe("applyRaise / 6.3", () => {
	it("records how the database was raised", async () => {
		const { driver } = makeFakeDriver();

		await applyRaise(driver, snapshotFile, COMMAND);

		const state = await readLedger(driver);
		expect(state).toEqual({
			exists: true,
			applied: [{ filename: snapshotFile.fileName, origin: "raised" }],
		});
	});

	it("records the snapshot file's own name verbatim -- not reshaped into a chain-looking filename", async () => {
		const { driver } = makeFakeDriver();
		const vendoredFile: SnapshotFile = {
			fileName: "vendor/2024-prod-schema.sql",
			sql: snapshotFile.sql,
			origin: "raised",
		};

		await applyRaise(driver, vendoredFile, COMMAND);

		// Exactly the caller's own name, byte for byte -- raise derives no
		// chain-shaped name for it (`migrationFileName`'s prefix strategies
		// never run here, unlike `generate`/`baseline`). That a raised
		// database's own ledger row never looks like a real chain file's
		// name is what tells a raised database's history apart from a
		// migrate-arrived one, reading the ledger alone -- proved here by
		// showing raise performs no transformation on the name at all,
		// rather than asserting the two just happen to look different.
		const state = await readLedger(driver);
		expect(state).toEqual({
			exists: true,
			applied: [{ filename: vendoredFile.fileName, origin: "raised" }],
		});
	});
});

// D106 R1, N6: the `cli-commands` requirement now names `raise` ("hejbro
// raise SHALL be unaffected by such a declaration"), so a claim with no
// observer at all would be exactly the N2-shaped gap evaluation.md
// already flagged elsewhere. `applyRaise` structurally cannot see a
// declaration (only opaque SQL text and the ledger, `SnapshotFile`'s own
// shape) -- this pin exercises that structural fact end-to-end instead
// of only citing it: the SQL raised here is a REAL `generateMigration`
// output for a schema that includes an `existingTable()`, not a
// hand-written string, so a future change that somehow made an existing
// declaration leak into generated SQL would surface here too.
describe("applyRaise / 6.1 (D106 R1, N6)", () => {
	it("raises a real migration from a schema with an existing declaration cleanly, recording the ledger and naming nothing about the existing table", async () => {
		const app = schema("uo_raise");
		const authUsers = existingTable("uo_raise", "users", { id: uuid() });
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authUsers.id),
		});
		const generated = generateMigration({
			declarations: [app, getTableMeta(authUsers), posts],
			previousSnapshot: emptySnapshot,
		});
		expect(generated.errors).toEqual([]);
		const generatedFile: SnapshotFile = {
			fileName: "0001_raise_with_existing.sql",
			sql: generated.sql,
			origin: "raised",
		};

		const { driver } = makeFakeDriver();

		await applyRaise(driver, generatedFile, COMMAND);

		const state = await readLedger(driver);
		expect(state).toEqual({
			exists: true,
			applied: [{ filename: generatedFile.fileName, origin: "raised" }],
		});
		expect(generatedFile.sql.toLowerCase()).not.toContain(
			'create table "uo_raise"."users"',
		);
	});
});

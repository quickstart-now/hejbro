import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import {
	bootstrapLedger,
	clearLedgerRows,
	readLedger,
	recordAppliedMigration,
} from "../src/apply/ledger";

/** Postgres's own code for "the relation named in this statement does not exist" -- what a `select`/`insert` against a ledger table that was never bootstrapped fails with. */
const UNDEFINED_TABLE = "42P01";

/** A fake single-connection session that only records what was sent to it and always answers with no rows -- enough to pin the SQL text bootstrap/record produce, matching `check-catalog.test.ts`'s own fake-session shape (no real database in CI). */
const makeRecordingSession = (): {
	readonly session: DriverSession;
	readonly calls: CompileResult[];
} => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			return [];
		},
	};
	return { session, calls };
};

/** A fake session that never bootstrapped -- any read/write against the ledger table fails exactly the way a real Postgres connection would against a schema that was never created. */
const makeUnbootstrappedSession = (): DriverSession => ({
	execute: async () => {
		throw Object.assign(
			new Error('relation "hejbro.migration_ledger" does not exist'),
			{ code: UNDEFINED_TABLE },
		);
	},
});

/**
 * A tiny in-memory stand-in for the ledger table itself -- enough to prove
 * a bootstrap-then-write-then-read round trip actually behaves like a
 * table with a server-assigned identity order, without a real database.
 * `create`/`insert`/`select` are matched by the shape of SQL `bootstrapLedger`
 * and `recordAppliedMigration`/`readLedger` are expected to send; anything
 * else is a bug in the code under test, not a fixture gap, so it throws.
 */
const makeInMemoryLedgerSession = (): { readonly session: DriverSession } => {
	let bootstrapped = false;
	const rows: Array<{ readonly filename: string; readonly origin: string }> =
		[];
	const session: DriverSession = {
		execute: async (compiled): Promise<ReadonlyArray<DriverRow>> => {
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("create schema") || sql.startsWith("create table")) {
				bootstrapped = true;
				return [];
			}
			if (sql.startsWith("insert into")) {
				if (!bootstrapped) {
					throw Object.assign(
						new Error('relation "hejbro.migration_ledger" does not exist'),
						{ code: UNDEFINED_TABLE },
					);
				}
				rows.push({
					filename: String(compiled.params[0]),
					origin: String(compiled.params[1]),
				});
				return [];
			}
			if (sql.startsWith("select")) {
				if (!bootstrapped) {
					throw Object.assign(
						new Error('relation "hejbro.migration_ledger" does not exist'),
						{ code: UNDEFINED_TABLE },
					);
				}
				return rows;
			}
			if (sql.startsWith("delete from")) {
				if (!bootstrapped) {
					throw Object.assign(
						new Error('relation "hejbro.migration_ledger" does not exist'),
						{ code: UNDEFINED_TABLE },
					);
				}
				rows.length = 0;
				return [];
			}
			throw new Error(
				`unexpected statement sent to the fake ledger: ${compiled.sql}`,
			);
		},
	};
	return { session };
};

describe("bootstrapLedger / 1.1", () => {
	it("bootstrap renders the ledger table with a server-assigned order", async () => {
		const { session, calls } = makeRecordingSession();

		await bootstrapLedger(session);

		const tableStatement = calls.find((call) =>
			call.sql.toLowerCase().includes("create table"),
		);
		expect(tableStatement).toBeDefined();
		expect(tableStatement?.sql).toMatch(/generated always as identity/i);
		expect(tableStatement?.sql).toMatch(/timestamptz/i);
		// The ordering column is server-assigned -- nothing in bootstrap's
		// own statement supplies a value for it.
		expect(tableStatement?.params).toEqual([]);
	});
});

describe("bootstrapLedger / 1.2", () => {
	it("the bootstrap statements are written to be idempotent", async () => {
		const { session, calls } = makeRecordingSession();

		await bootstrapLedger(session);
		await bootstrapLedger(session);

		const tableStatements = calls.filter((call) =>
			call.sql.toLowerCase().includes("create table"),
		);
		expect(tableStatements).toHaveLength(2);
		// This pins the statement text, not the server: that running these
		// statements twice actually leaves one table and no error is
		// Postgres's own `if not exists` semantics, proved against a real
		// server by group 8's live witness, not by this unit test.
		expect(
			tableStatements.every((call) => /if not exists/i.test(call.sql)),
		).toBe(true);
	});
});

describe("bootstrapLedger / 11.3 (#620)", () => {
	it('declares "filename" not null unique -- a second insert of the same filename is impossible however the application logic gets there, independent of task 11.1\'s own in-transaction recheck (a defence nobody remembers is a defence nobody keeps)', async () => {
		const { session, calls } = makeRecordingSession();

		await bootstrapLedger(session);

		const tableStatement = calls.find((call) =>
			call.sql.toLowerCase().includes("create table"),
		);
		expect(tableStatement?.sql).toMatch(
			/"filename"\s+text\s+not null\s+unique/i,
		);
	});
});

describe("readLedger / 1.3", () => {
	it("an absent ledger table reads as no applied migrations", async () => {
		const session = makeUnbootstrappedSession();

		const state = await readLedger(session);

		expect(state).toEqual({ exists: false });
	});

	it("an empty ledger table is not reported as an absent one", async () => {
		const session: DriverSession = { execute: async () => [] };

		const state = await readLedger(session);

		expect(state).toEqual({ exists: true, applied: [] });
	});
});

describe("recordAppliedMigration / 1.4", () => {
	it("records an applied migration by filename", async () => {
		const { session } = makeInMemoryLedgerSession();
		await bootstrapLedger(session);

		await recordAppliedMigration(session, "0001_init.sql", "applied");
		await recordAppliedMigration(session, "0002_add_column.sql", "applied");
		const state = await readLedger(session);

		expect(state).toEqual({
			exists: true,
			applied: [
				{ filename: "0001_init.sql", origin: "applied" },
				{ filename: "0002_add_column.sql", origin: "applied" },
			],
		});
	});

	it("registers a baseline without executing its statements", async () => {
		const { session, calls } = makeRecordingSession();

		await recordAppliedMigration(session, "0001_adopt.sql", "registered");

		// The ledger has no facility to send a migration's own DDL -- the
		// baseline path (spec: "A baseline is registered rather than run")
		// is exactly this one insert and nothing else, at this layer.
		expect(calls).toHaveLength(1);
		expect(calls[0]?.sql.toLowerCase()).toMatch(/^insert into/);
		expect(calls[0]?.params).toEqual(["0001_adopt.sql", "registered"]);
	});
});

describe("recordAppliedMigration / 16.1 (D106 M7)", () => {
	it("records how a row entered the ledger", async () => {
		const { session } = makeInMemoryLedgerSession();
		await bootstrapLedger(session);

		await recordAppliedMigration(session, "0001_init.sql", "applied");
		await recordAppliedMigration(session, "0002_baseline.sql", "registered");
		await recordAppliedMigration(session, "snapshot.sql", "raised");
		const state = await readLedger(session);

		expect(state).toEqual({
			exists: true,
			applied: [
				{ filename: "0001_init.sql", origin: "applied" },
				{ filename: "0002_baseline.sql", origin: "registered" },
				{ filename: "snapshot.sql", origin: "raised" },
			],
		});
	});

	it("declares the origin column not null with a check constraint naming the three origins, and no default", async () => {
		const { session, calls } = makeRecordingSession();

		await bootstrapLedger(session);

		const tableStatement = calls.find((call) =>
			call.sql.toLowerCase().includes("create table"),
		);
		const originLine = tableStatement?.sql
			.split("\n")
			.find((line) => line.toLowerCase().includes('"origin"'));
		expect(originLine).toMatch(
			/"origin"\s+text\s+not null\s+check\s*\(\s*"origin"\s+in\s*\('applied', 'registered', 'raised'\)\)/i,
		);
		// Not defaulted -- an unstated origin SHALL be an error, never a
		// silent classification (task 16.1's own "no default" constraint).
		expect(originLine?.toLowerCase()).not.toContain("default");
	});
});

describe("clearLedgerRows / 5.3, D106 R1 B1", () => {
	it("clears every row in the ledger", async () => {
		const { session } = makeInMemoryLedgerSession();
		await bootstrapLedger(session);
		await recordAppliedMigration(session, "0001_init.sql", "applied");
		await recordAppliedMigration(session, "0002_add_column.sql", "applied");

		await clearLedgerRows(session);
		const state = await readLedger(session);

		// Rows are gone, but the table itself still is one -- reset (group
		// 5) destroys only what the declarations describe, and this table
		// is hejbro's own bookkeeping, not a declared object.
		expect(state).toEqual({ exists: true, applied: [] });
	});

	// [D106 R1, B1, #753 reopened] No leniency for an absent table -- the
	// one caller (`reset.ts`) checks `ledgerTableExists` first and only
	// calls this when that read says the table is there; a failure here is
	// a genuine one, never a silent no-op.
	it("throws when the ledger was never bootstrapped", async () => {
		const session = makeUnbootstrappedSession();

		await expect(clearLedgerRows(session)).rejects.toMatchObject({
			code: "42P01",
		});
	});
});

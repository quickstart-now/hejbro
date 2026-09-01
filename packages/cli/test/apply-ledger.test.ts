import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import {
	bootstrapLedger,
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
	const rows: string[] = [];
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
				const filename = compiled.params[0];
				rows.push(String(filename));
				return [];
			}
			if (sql.startsWith("select")) {
				if (!bootstrapped) {
					throw Object.assign(
						new Error('relation "hejbro.migration_ledger" does not exist'),
						{ code: UNDEFINED_TABLE },
					);
				}
				return rows.map((filename) => ({ filename }));
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

		await recordAppliedMigration(session, "0001_init.sql");
		await recordAppliedMigration(session, "0002_add_column.sql");
		const state = await readLedger(session);

		expect(state).toEqual({
			exists: true,
			applied: ["0001_init.sql", "0002_add_column.sql"],
		});
	});

	it("registers a baseline without executing its statements", async () => {
		const { session, calls } = makeRecordingSession();

		await recordAppliedMigration(session, "0001_adopt.sql");

		// The ledger has no facility to send a migration's own DDL -- the
		// baseline path (spec: "A baseline is registered rather than run")
		// is exactly this one insert and nothing else, at this layer.
		expect(calls).toHaveLength(1);
		expect(calls[0]?.sql.toLowerCase()).toMatch(/^insert into/);
		expect(calls[0]?.params).toEqual(["0001_adopt.sql"]);
	});
});

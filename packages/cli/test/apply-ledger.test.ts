import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type {
	LedgerAccessDirection,
	LedgerAccessSite,
} from "../src/apply/ledger";
import {
	asLedgerAccessFailure,
	bootstrapLedger,
	clearLedgerRows,
	isMigrationRecorded,
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

/** One statement's answer: `rows` on success, or `throws` for the server failure `session.execute` raises -- matches `apply-execute.test.ts`'s own `failWhen`/`rowsWhen` convention (SQL-text matching stays in the fixture, never in the production code under test, D4). */
type StatementAnswer =
	| { readonly rows: ReadonlyArray<DriverRow> }
	| { readonly throws: unknown };

/** [task 1.1, harden-ledger-diagnostics] A fake `DriverSession` that answers each `execute` call from `answers`, one per call in order -- exhausting the list is a bug in the test, not a silent empty-rows fallback, so the test itself fails loudly rather than a later assertion failing for an unrelated reason. */
const makeScriptedSession = (
	answers: ReadonlyArray<StatementAnswer>,
): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			const answer = answers[calls.length];
			calls.push(compiled);
			if (answer === undefined) {
				throw new Error(
					`makeScriptedSession: no answer scripted for call ${calls.length} (${compiled.sql})`,
				);
			}
			if ("throws" in answer) {
				throw answer.throws;
			}
			return answer.rows;
		},
	};
	return { session, calls };
};

/** Postgres's own code for "permission denied" against the ledger table itself (`select`/`insert`/`delete` withheld) -- byte-identical across all three (measured, batch A2/A3), so only the caller (never the server answer) says which statement it was. */
const permissionDeniedTable = () =>
	Object.assign(new Error("permission denied for table migration_ledger"), {
		code: "42501",
	});

/** Postgres's own code for the ledger's schema `usage` withheld -- same SQLSTATE as {@link permissionDeniedTable}, different message (measured, batch A2-3). */
const permissionDeniedSchema = () =>
	Object.assign(new Error("permission denied for schema hejbro"), {
		code: "42501",
	});

const undefinedTable = () =>
	Object.assign(
		new Error('relation "hejbro.migration_ledger" does not exist'),
		{ code: UNDEFINED_TABLE },
	);

const bareError = () => new Error("connection reset by peer");

/** Measured, batch A3-6a: `bootstrapLedger`'s own `create schema` refused when the connecting role lacks `create` on the database. */
const permissionDeniedDatabase = () =>
	Object.assign(new Error("permission denied for database ldtest"), {
		code: "42501",
	});

/** Measured, batch A3-1/A4-3 -- the #823 shape: a ledger whose `id` carries neither identity nor default. `.column`/`.detail` mirror node-postgres's own fields on a real `23502`. */
const notNullViolation = () =>
	Object.assign(
		new Error(
			'null value in column "id" of relation "migration_ledger" violates not-null constraint',
		),
		{
			code: "23502",
			detail: "Failing row contains (null, 0001_init.sql, applied, now()).",
			column: "id",
		},
	);

const uniqueViolation = () =>
	Object.assign(
		new Error(
			'duplicate key value violates unique constraint "migration_ledger_filename_key"',
		),
		{ code: "23505" },
	);

const checkViolation = () =>
	Object.assign(
		new Error(
			'new row for relation "migration_ledger" violates check constraint "migration_ledger_filename_check"',
		),
		{ code: "23514" },
	);

const triggerRefusal = () =>
	Object.assign(new Error("ledger insert refused by policy trigger"), {
		code: "P0001",
	});

describe("a failed ledger statement says which statement failed / 1.1 (harden-ledger-diagnostics)", () => {
	describe("readLedger", () => {
		it.each<[string, unknown, LedgerAccessDirection, LedgerAccessSite]>([
			["42501, select withheld", permissionDeniedTable(), "read", "read"],
			[
				"42501, schema usage withheld",
				permissionDeniedSchema(),
				"read",
				"read",
			],
			["a bare error with no code", bareError(), "read", "read"],
		])("%s -> tagged %s/%s", async (_label, error, direction, site) => {
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(readLedger(session)).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === direction &&
					tag.site === site &&
					tag.cause === error
				);
			});
		});

		it("42P01 keeps its {exists: false} leniency, not a failure", async () => {
			const { session } = makeScriptedSession([{ throws: undefinedTable() }]);

			await expect(readLedger(session)).resolves.toEqual({ exists: false });
		});

		it("success control: an ordinary read is not tagged at all", async () => {
			const { session } = makeScriptedSession([
				{ rows: [{ filename: "0001_init.sql", origin: "applied" }] },
			]);

			await expect(readLedger(session)).resolves.toEqual({
				exists: true,
				applied: [{ filename: "0001_init.sql", origin: "applied" }],
			});
		});
	});

	describe("isMigrationRecorded", () => {
		it("42501 is a tagged read failure at the recheck site", async () => {
			const error = permissionDeniedTable();
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(
				isMigrationRecorded(session, "0001_init.sql"),
			).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === "read" &&
					tag.site === "recheck" &&
					tag.cause === error
				);
			});
		});

		// [task 2.2, harden-ledger-diagnostics review repair, 836/R4 B2] No
		// leniency inside the transaction: a ledger vanishing mid-run is a race,
		// not the "never applied to" state readLedger reports pre-transaction
		// (D9 unchanged -- see readLedger's own describe above).
		it("42P01 is a tagged read failure at the recheck site too -- no leniency inside the transaction", async () => {
			const error = undefinedTable();
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(
				isMigrationRecorded(session, "0001_init.sql"),
			).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === "read" &&
					tag.site === "recheck" &&
					tag.cause === error
				);
			});
		});

		it("success control: an ordinary recheck is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }]);

			await expect(isMigrationRecorded(session, "0001_init.sql")).resolves.toBe(
				false,
			);
		});
	});

	describe("bootstrapLedger", () => {
		it("42501 on create schema is a tagged write failure at the bootstrap site", async () => {
			const error = permissionDeniedDatabase();
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(bootstrapLedger(session)).rejects.toSatisfy(
				(thrown: unknown) => {
					const tag = asLedgerAccessFailure(thrown);
					return (
						tag !== null &&
						tag.direction === "write" &&
						tag.site === "bootstrap" &&
						tag.cause === error
					);
				},
			);
		});

		it("42501 on create table is a tagged write failure at the bootstrap site", async () => {
			const error = permissionDeniedSchema();
			const { session } = makeScriptedSession([
				{ rows: [] },
				{ throws: error },
			]);

			await expect(bootstrapLedger(session)).rejects.toSatisfy(
				(thrown: unknown) => {
					const tag = asLedgerAccessFailure(thrown);
					return (
						tag !== null &&
						tag.direction === "write" &&
						tag.site === "bootstrap" &&
						tag.cause === error
					);
				},
			);
		});

		it("success control: an ordinary bootstrap is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }, { rows: [] }]);

			await expect(bootstrapLedger(session)).resolves.toBeUndefined();
		});
	});

	describe("recordAppliedMigration", () => {
		it.each<[string, unknown]>([
			["23502, id has no identity or default", notNullViolation()],
			["42501, insert withheld", permissionDeniedTable()],
			["23505, filename already recorded", uniqueViolation()],
			["23514, a check constraint on the ledger", checkViolation()],
			["P0001, a trigger refuses the row", triggerRefusal()],
		])("%s -> tagged write failure at the row site", async (_label, error) => {
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(
				recordAppliedMigration(session, "0001_init.sql", "applied"),
			).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === "write" &&
					tag.site === "row" &&
					tag.cause === error
				);
			});
		});

		it("success control: an ordinary record is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }]);

			await expect(
				recordAppliedMigration(session, "0001_init.sql", "applied"),
			).resolves.toBeUndefined();
		});
	});

	describe("clearLedgerRows", () => {
		it.each<[string, unknown]>([
			["42501, delete withheld", permissionDeniedTable()],
			[
				"42P01, no leniency for clear -- the one caller already probed identity",
				undefinedTable(),
			],
		])(
			"%s -> tagged write failure at the clear site",
			async (_label, error) => {
				const { session } = makeScriptedSession([{ throws: error }]);

				await expect(clearLedgerRows(session)).rejects.toSatisfy(
					(thrown: unknown) => {
						const tag = asLedgerAccessFailure(thrown);
						return (
							tag !== null &&
							tag.direction === "write" &&
							tag.site === "clear" &&
							tag.cause === error
						);
					},
				);
			},
		);

		it("success control: an ordinary clear is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }]);

			await expect(clearLedgerRows(session)).resolves.toBeUndefined();
		});
	});
});

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

	// [D106 R1, B1, #753 reopened; harden-ledger-identity, 783/R2] No
	// leniency for an absent table -- the one caller (`reset.ts`) probes
	// the ledger's identity first and only calls this when that probe
	// found the real ledger; a failure here is a genuine one, never a
	// silent no-op. [task 1.1] The failure now arrives tagged (write/clear,
	// design.md D4) rather than raw -- the server's own 42P01 lives on
	// `.cause`.
	it("throws when the ledger was never bootstrapped", async () => {
		const session = makeUnbootstrappedSession();

		await expect(clearLedgerRows(session)).rejects.toSatisfy(
			(thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === "write" &&
					tag.site === "clear" &&
					(tag.cause as { readonly code?: unknown } | null)?.code === "42P01"
				);
			},
		);
	});
});

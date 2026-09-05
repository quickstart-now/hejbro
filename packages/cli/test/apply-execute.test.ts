import type {
	CompileResult,
	Driver,
	DriverRow,
	DriverSession,
} from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type { Migration } from "../src/apply/execute";
import {
	applyMigration,
	stripQuotedAndCommentedText,
} from "../src/apply/execute";
import { asLedgerAccessFailure } from "../src/apply/ledger";

type FailWhen = (compiled: CompileResult) => boolean;
type RowsWhen = (
	compiled: CompileResult,
) => ReadonlyArray<DriverRow> | undefined;

/**
 * A fake `Driver` whose `transaction()` runs the callback against one
 * fake session, recording every statement sent (across every
 * `transaction()` call, and every session created) -- enough to pin
 * *what* is sent, *in what order*, and *through how many transactions*,
 * without a real database. `failWhen` lets a test make exactly one
 * statement fail, so the migration statement's own failure can be
 * distinguished from the lock's or the ledger row's. `rowsWhen` (task
 * 11.1) lets a test answer a specific `select` (the ledger recheck)
 * with rows of its own choosing -- everything else still answers `[]`,
 * the same default every earlier test already relies on.
 */
const makeFakeDriver = (options?: {
	readonly failWhen?: FailWhen;
	readonly failError?: unknown;
	readonly rowsWhen?: RowsWhen;
}): {
	readonly driver: Driver;
	readonly calls: CompileResult[];
	readonly sessionCount: { count: number };
} => {
	const calls: CompileResult[] = [];
	const sessionCount = { count: 0 };
	const makeSession = (): DriverSession => ({
		execute: async (compiled) => {
			calls.push(compiled);
			if (options?.failWhen?.(compiled) === true) {
				throw options?.failError ?? new Error("fake failure");
			}
			return options?.rowsWhen?.(compiled) ?? [];
		},
	});
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: async (compiled) => {
			calls.push(compiled);
			return [];
		},
		transaction: async (callback) => {
			sessionCount.count += 1;
			const session = makeSession();
			return callback(session);
		},
		batch: async () => [],
		setupSession: async () => {},
	};
	return { driver, calls, sessionCount };
};

const okMigration: Migration = {
	fileName: "0001_init.sql",
	sql: 'create table "app"."t" (id integer);',
	origin: "applied",
};

// `applyMigration` has no production caller yet -- group 7 wires
// `migrate`, group 6 wires `raise` -- so `nextCommand` has no "the" real
// value here either; a fixture stands in for whichever command a real
// caller passes (required, never defaulted -- see execute.ts's own doc
// comment on why).
const NEXT_COMMAND = "hejbro migrate";

describe("applyMigration / 3.1", () => {
	it("sends the migration as one parameterless statement", async () => {
		const { driver, calls } = makeFakeDriver();

		await applyMigration(driver, okMigration, NEXT_COMMAND);

		const migrationCall = calls.find((call) => call.sql === okMigration.sql);
		expect(migrationCall).toBeDefined();
		expect(migrationCall?.params).toEqual([]);
	});

	it("writes the ledger row inside the same transaction", async () => {
		const { driver, calls, sessionCount } = makeFakeDriver();

		await applyMigration(driver, okMigration, NEXT_COMMAND);

		// Exactly one transaction() call -- the lock, the migration, and the
		// ledger row all went through the one session it hands the callback.
		expect(sessionCount.count).toBe(1);
		const ledgerCall = calls.find((call) =>
			call.sql.toLowerCase().includes("insert into"),
		);
		expect(ledgerCall).toBeDefined();
		expect(ledgerCall?.params).toEqual([
			okMigration.fileName,
			okMigration.origin,
		]);
	});
});

describe("applyMigration / 3.2", () => {
	const failingMigration: Migration = {
		fileName: "0002_bad.sql",
		sql: "this statement fails",
		origin: "applied",
	};

	it("does not swallow a failed migration's error -- the driver's own transaction() then rolls back, proved live in group 8", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === failingMigration.sql,
			failError: Object.assign(new Error("syntax error"), {
				code: "42601",
			}),
		});

		await expect(
			applyMigration(driver, failingMigration, NEXT_COMMAND),
		).rejects.toMatchObject({ code: "apply-failed" });
	});

	it("a failed migration writes no ledger row", async () => {
		const { driver, calls } = makeFakeDriver({
			failWhen: (call) => call.sql === failingMigration.sql,
			failError: Object.assign(new Error("syntax error"), {
				code: "42601",
			}),
		});

		await expect(
			applyMigration(driver, failingMigration, NEXT_COMMAND),
		).rejects.toThrow();

		const ledgerCall = calls.find((call) =>
			call.sql.toLowerCase().includes("insert into"),
		);
		expect(ledgerCall).toBeUndefined();
	});
});

describe("applyMigration / 3.3", () => {
	it("names the file and repeats the server's code", async () => {
		const migration: Migration = {
			fileName: "0003_bad.sql",
			sql: "ddl",
			origin: "applied",
		};
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === migration.sql,
			failError: Object.assign(new Error('relation "t2_a" already exists'), {
				code: "42P07",
			}),
		});

		try {
			await applyMigration(driver, migration, NEXT_COMMAND);
			throw new Error("expected applyMigration to reject");
		} catch (error) {
			const message = (error as Error).message;
			expect((error as { code?: string }).code).toBe("apply-failed");
			expect(message).toContain("0003_bad.sql");
			expect(message).toContain("42P07");
			expect(message).toContain('relation "t2_a" already exists');
			expect(message).toMatch(/Next:/);
			expect(message).toContain(NEXT_COMMAND);
		}
	});

	it("translates 55P04 into the regenerate remedy", async () => {
		const migration: Migration = {
			fileName: "0004_enum.sql",
			sql: "ddl",
			origin: "applied",
		};
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === migration.sql,
			failError: Object.assign(
				new Error('unsafe use of new value "great" of enum type mood'),
				{ code: "55P04" },
			),
		});

		try {
			await applyMigration(driver, migration, NEXT_COMMAND);
			throw new Error("expected applyMigration to reject");
		} catch (error) {
			const message = (error as Error).message;
			expect((error as { code?: string }).code).toBe(
				"apply-unsafe-new-enum-value",
			);
			expect(message).toMatch(/regenerate/i);
			expect(message).toMatch(/Next:/);
		}
	});
});

describe("which half of the transaction failed decides which artifact is named / 1.4 (harden-ledger-diagnostics)", () => {
	it.each<[string, unknown]>([
		[
			"42601, migration's own syntax error",
			Object.assign(new Error("syntax error"), { code: "42601" }),
		],
		[
			"42P07, migration's own already-exists",
			Object.assign(new Error('relation "t2_a" already exists'), {
				code: "42P07",
			}),
		],
	])(
		"%s -> apply-failed naming the migration file (regression)",
		async (_label, error) => {
			const migration: Migration = {
				fileName: "0007_bad.sql",
				sql: "ddl",
				origin: "applied",
			};
			const { driver } = makeFakeDriver({
				failWhen: (call) => call.sql === migration.sql,
				failError: error,
			});

			await expect(
				applyMigration(driver, migration, NEXT_COMMAND),
			).rejects.toMatchObject({ code: "apply-failed" });
		},
	);

	it("55P04, migration's own unsafe enum use -> apply-unsafe-new-enum-value naming the migration file (regression)", async () => {
		const migration: Migration = {
			fileName: "0007_enum.sql",
			sql: "ddl",
			origin: "applied",
		};
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === migration.sql,
			failError: Object.assign(
				new Error('unsafe use of new value "great" of enum type mood'),
				{ code: "55P04" },
			),
		});

		await expect(
			applyMigration(driver, migration, NEXT_COMMAND),
		).rejects.toMatchObject({ code: "apply-unsafe-new-enum-value" });
	});

	it.each<[string, unknown]>([
		[
			"23502, id has no identity or default",
			Object.assign(
				new Error(
					'null value in column "id" of relation "migration_ledger" violates not-null constraint',
				),
				{ code: "23502", column: "id" },
			),
		],
		[
			"42501, insert withheld",
			Object.assign(new Error("permission denied for table migration_ledger"), {
				code: "42501",
			}),
		],
		[
			"23505, filename already recorded",
			Object.assign(
				new Error(
					'duplicate key value violates unique constraint "migration_ledger_filename_key"',
				),
				{ code: "23505" },
			),
		],
	])(
		"%s -> the tagged write failure escapes with its site and cause intact, never apply-failed",
		async (_label, error) => {
			const migration: Migration = {
				fileName: "0008_ok.sql",
				sql: 'create table "app"."t8" (id integer);',
				origin: "applied",
			};
			const { driver } = makeFakeDriver({
				failWhen: (call) => call.sql.toLowerCase().includes("insert into"),
				failError: error,
			});

			await expect(
				applyMigration(driver, migration, NEXT_COMMAND),
			).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === "write" &&
					tag.site === "row" &&
					tag.cause === error
				);
			});
		},
	);

	it("42501 on the in-transaction recheck -> the tagged read failure escapes the same way", async () => {
		const migration: Migration = {
			fileName: "0009_ok.sql",
			sql: 'create table "app"."t9" (id integer);',
			origin: "applied",
		};
		const error = Object.assign(
			new Error("permission denied for table migration_ledger"),
			{ code: "42501" },
		);
		const { driver } = makeFakeDriver({
			failWhen: (call) =>
				call.sql.toLowerCase().includes("select") &&
				call.params.includes(migration.fileName),
			failError: error,
		});

		await expect(
			applyMigration(driver, migration, NEXT_COMMAND),
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

	// [task 2.2, harden-ledger-diagnostics review repair, 836/R4 B2, 836/R6]
	// A ledger dropped concurrently mid-transaction: isMigrationRecorded's
	// own 42P01 no longer reads as "not recorded" -- a tagged read failure
	// escapes the same way 42501 does above, never the migration's own
	// (untagged) statement failing next inside an already-aborted
	// transaction.
	it("42P01 (the ledger vanished) on the in-transaction recheck -> the tagged read failure escapes, no migration SQL sent after it", async () => {
		const migration: Migration = {
			fileName: "0010_ok.sql",
			sql: 'create table "app"."t10" (id integer);',
			origin: "applied",
		};
		const error = Object.assign(
			new Error('relation "hejbro.migration_ledger" does not exist'),
			{ code: "42P01" },
		);
		const { driver, calls } = makeFakeDriver({
			failWhen: (call) =>
				call.sql.toLowerCase().includes("select") &&
				call.params.includes(migration.fileName),
			failError: error,
		});

		await expect(
			applyMigration(driver, migration, NEXT_COMMAND),
		).rejects.toSatisfy((thrown: unknown) => {
			const tag = asLedgerAccessFailure(thrown);
			return (
				tag !== null &&
				tag.direction === "read" &&
				tag.site === "recheck" &&
				tag.cause === error
			);
		});
		expect(calls.some((call) => call.sql === migration.sql)).toBe(false);
	});
});

describe("applyMigration / 3.4", () => {
	it("takes a transaction-scoped lock, inside the same transaction as the migration and before it", async () => {
		const { driver, calls, sessionCount } = makeFakeDriver();

		await applyMigration(driver, okMigration, NEXT_COMMAND);

		expect(sessionCount.count).toBe(1);
		const lockIndex = calls.findIndex((call) =>
			call.sql.includes("pg_advisory_xact_lock"),
		);
		const migrationIndex = calls.findIndex(
			(call) => call.sql === okMigration.sql,
		);
		expect(lockIndex).toBeGreaterThanOrEqual(0);
		expect(migrationIndex).toBeGreaterThan(lockIndex);
	});
});

describe("applyMigration / 11.1 (#620)", () => {
	it('reports "applied" on the ordinary path -- the ledger recheck finds nothing', async () => {
		const { driver } = makeFakeDriver();

		await expect(
			applyMigration(driver, okMigration, NEXT_COMMAND),
		).resolves.toBe("applied");
	});

	it("rechecks the ledger inside the lock, before sending the migration's own SQL", async () => {
		const { driver, calls } = makeFakeDriver();

		await applyMigration(driver, okMigration, NEXT_COMMAND);

		const lockIndex = calls.findIndex((call) =>
			call.sql.includes("pg_advisory_xact_lock"),
		);
		const recheckIndex = calls.findIndex(
			(call) =>
				call.sql.toLowerCase().includes("select") &&
				call.params.includes(okMigration.fileName),
		);
		const migrationIndex = calls.findIndex(
			(call) => call.sql === okMigration.sql,
		);
		expect(recheckIndex).toBeGreaterThan(lockIndex);
		expect(migrationIndex).toBeGreaterThan(recheckIndex);
	});

	it('restores the witness\'s own original red: when the ledger already records this filename by the time the lock is held, this call sends no DDL, writes no second row, and reports "already-applied" instead of failing', async () => {
		const raced: Migration = {
			fileName: "0011_raced.sql",
			sql: 'alter type "app"."mood" add value \'great\';',
			origin: "applied",
		};
		const recheckFindsRaced = (
			call: CompileResult,
		): ReadonlyArray<DriverRow> | undefined => {
			if (
				call.sql.toLowerCase().includes("select") &&
				call.params.includes(raced.fileName)
			) {
				return [{ "?column?": 1 }];
			}
			return undefined;
		};
		const { driver, calls } = makeFakeDriver({
			rowsWhen: recheckFindsRaced,
		});

		await expect(applyMigration(driver, raced, NEXT_COMMAND)).resolves.toBe(
			"already-applied",
		);

		const migrationCall = calls.find((call) => call.sql === raced.sql);
		expect(migrationCall).toBeUndefined();
		const ledgerInsertCall = calls.find((call) =>
			call.sql.toLowerCase().includes("insert into"),
		);
		expect(ledgerInsertCall).toBeUndefined();
	});
});

describe("applyMigration / 3.5", () => {
	it("refuses a migration containing its own transaction control, naming the statement", async () => {
		const migration: Migration = {
			fileName: "0005_bad.sql",
			sql: 'create table "app"."t" (id integer);\ncommit;\ncreate table "app"."u" (id integer);',
			origin: "applied",
		};
		const { driver, calls } = makeFakeDriver();

		await expect(
			applyMigration(driver, migration, NEXT_COMMAND),
		).rejects.toMatchObject({
			code: "apply-transaction-control",
		});
		// Refused before anything was sent -- no transaction was even opened.
		expect(calls).toHaveLength(0);
	});

	it("accepts a migration whose function body contains the word commit", async () => {
		const migration: Migration = {
			fileName: "0006_fn.sql",
			sql: `create function "app"."f"() returns void as $$
begin
  raise notice 'commit this to memory';
end;
$$ language plpgsql;`,
			origin: "applied",
		};
		const { driver } = makeFakeDriver();

		await expect(applyMigration(driver, migration, NEXT_COMMAND)).resolves.toBe(
			"applied",
		);
	});

	it("ignores begin/commit/rollback that appear only in a `--` comment", async () => {
		const migration: Migration = {
			fileName: "0007_comment.sql",
			sql: 'create table "app"."t" (id integer); -- do not forget to commit this migration\n',
			origin: "applied",
		};
		const { driver } = makeFakeDriver();

		await expect(applyMigration(driver, migration, NEXT_COMMAND)).resolves.toBe(
			"applied",
		);
	});

	it("is not confused by an escaped quote inside a string literal", async () => {
		const migration: Migration = {
			fileName: "0008_escaped.sql",
			sql: "insert into \"app\".\"t\" (name) values ('it''s fine, no commit here');",
			origin: "applied",
		};
		const { driver } = makeFakeDriver();

		await expect(applyMigration(driver, migration, NEXT_COMMAND)).resolves.toBe(
			"applied",
		);
	});

	it("refuses begin and rollback the same way as commit", async () => {
		const { driver: driverBegin } = makeFakeDriver();
		await expect(
			applyMigration(
				driverBegin,
				{
					fileName: "0009_begin.sql",
					sql: "begin;\ncreate table t (id int);",
					origin: "applied",
				},
				NEXT_COMMAND,
			),
		).rejects.toMatchObject({ code: "apply-transaction-control" });

		const { driver: driverRollback } = makeFakeDriver();
		await expect(
			applyMigration(
				driverRollback,
				{
					fileName: "0010_rollback.sql",
					sql: "create table t (id int);\nrollback;",
					origin: "applied",
				},
				NEXT_COMMAND,
			),
		).rejects.toMatchObject({ code: "apply-transaction-control" });
	});
});

describe("stripQuotedAndCommentedText", () => {
	it("removes a single-quoted string literal's contents", () => {
		expect(stripQuotedAndCommentedText("select 'commit' as x;")).toBe(
			"select  as x;",
		);
	});

	it("removes a dollar-quoted body's contents, tagged or bare", () => {
		expect(stripQuotedAndCommentedText("do $$ commit $$;")).toBe("do ;");
		expect(stripQuotedAndCommentedText("do $tag$ commit $tag$;")).toBe("do ;");
	});

	it("removes a line comment through the end of its line, keeping what follows", () => {
		expect(stripQuotedAndCommentedText("select 1; -- commit\nselect 2;")).toBe(
			"select 1; \nselect 2;",
		);
	});
});

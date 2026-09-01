import type { CompileResult, Driver, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type { Migration } from "../src/apply/execute";
import {
	applyMigration,
	stripQuotedAndCommentedText,
} from "../src/apply/execute";

type FailWhen = (compiled: CompileResult) => boolean;

/**
 * A fake `Driver` whose `transaction()` runs the callback against one
 * fake session, recording every statement sent (across every
 * `transaction()` call, and every session created) -- enough to pin
 * *what* is sent, *in what order*, and *through how many transactions*,
 * without a real database. `failWhen` lets a test make exactly one
 * statement fail, so the migration statement's own failure can be
 * distinguished from the lock's or the ledger row's.
 */
const makeFakeDriver = (options?: {
	readonly failWhen?: FailWhen;
	readonly failError?: unknown;
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
			return [];
		},
	});
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
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
		setupSession: async () => {},
	};
	return { driver, calls, sessionCount };
};

const okMigration: Migration = {
	fileName: "0001_init.sql",
	sql: 'create table "app"."t" (id integer);',
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
		expect(ledgerCall?.params).toEqual([okMigration.fileName]);
	});
});

describe("applyMigration / 3.2", () => {
	const failingMigration: Migration = {
		fileName: "0002_bad.sql",
		sql: "this statement fails",
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
		const migration: Migration = { fileName: "0003_bad.sql", sql: "ddl" };
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
		const migration: Migration = { fileName: "0004_enum.sql", sql: "ddl" };
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

describe("applyMigration / 3.5", () => {
	it("refuses a migration containing its own transaction control, naming the statement", async () => {
		const migration: Migration = {
			fileName: "0005_bad.sql",
			sql: 'create table "app"."t" (id integer);\ncommit;\ncreate table "app"."u" (id integer);',
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
		};
		const { driver } = makeFakeDriver();

		await expect(
			applyMigration(driver, migration, NEXT_COMMAND),
		).resolves.toBeUndefined();
	});

	it("ignores begin/commit/rollback that appear only in a `--` comment", async () => {
		const migration: Migration = {
			fileName: "0007_comment.sql",
			sql: 'create table "app"."t" (id integer); -- do not forget to commit this migration\n',
		};
		const { driver } = makeFakeDriver();

		await expect(
			applyMigration(driver, migration, NEXT_COMMAND),
		).resolves.toBeUndefined();
	});

	it("is not confused by an escaped quote inside a string literal", async () => {
		const migration: Migration = {
			fileName: "0008_escaped.sql",
			sql: "insert into \"app\".\"t\" (name) values ('it''s fine, no commit here');",
		};
		const { driver } = makeFakeDriver();

		await expect(
			applyMigration(driver, migration, NEXT_COMMAND),
		).resolves.toBeUndefined();
	});

	it("refuses begin and rollback the same way as commit", async () => {
		const { driver: driverBegin } = makeFakeDriver();
		await expect(
			applyMigration(
				driverBegin,
				{
					fileName: "0009_begin.sql",
					sql: "begin;\ncreate table t (id int);",
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

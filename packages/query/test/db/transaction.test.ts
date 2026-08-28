import { schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/db";
import type { Driver, DriverSession } from "../../src/driver/contract";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

/** A driver that actually models begin/commit/rollback around one session, so a test can assert on which of those ran -- and, critically, that every `tx.execute()` inside the callback lands on that one session's own spy, never the top-level `driver.execute`. */
const transactionalDriver = (
	interactiveTransactions: boolean,
): {
	readonly driver: Driver;
	readonly sessionExecute: ReturnType<typeof vi.fn>;
	readonly commit: ReturnType<typeof vi.fn>;
	readonly rollback: ReturnType<typeof vi.fn>;
} => {
	const sessionExecute = vi.fn(async () => []);
	const commit = vi.fn();
	const rollback = vi.fn();
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": interactiveTransactions,
			"session-state": true,
		},
		execute: vi.fn(async () => []),
		transaction: vi.fn(async (callback) => {
			const session: DriverSession = { execute: sessionExecute };
			try {
				const result = await callback(session);
				commit();
				return result;
			} catch (error) {
				rollback();
				throw error;
			}
		}),
		setupSession: vi.fn(async () => {}),
	};
	return { driver, sessionExecute, commit, rollback };
};

describe("db().transaction (task 4.6)", () => {
	it("commits and resolves the callback's own return value on success (positive control)", async () => {
		const { driver, sessionExecute, commit, rollback } =
			transactionalDriver(true);
		const handle = db({ posts }, driver);

		const result = await handle.transaction(async (tx) => {
			await tx.execute(select(posts));
			return 42;
		});

		expect(result).toBe(42);
		expect(commit).toHaveBeenCalledTimes(1);
		expect(rollback).not.toHaveBeenCalled();
		expect(sessionExecute).toHaveBeenCalledTimes(1);
	});

	it("rolls back and rethrows the exact error when the callback throws", async () => {
		const { driver, commit, rollback } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		const thrown = new Error("callback failed");

		await expect(
			handle.transaction(async () => {
				throw thrown;
			}),
		).rejects.toBe(thrown);

		expect(rollback).toHaveBeenCalledTimes(1);
		expect(commit).not.toHaveBeenCalled();
	});

	it("every statement inside the callback runs on the same connection -- one session, not one per statement", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);

		await handle.transaction(async (tx) => {
			await tx.execute(select(posts));
			await tx.execute(select(posts));
			await tx.execute(select(posts));
		});

		expect(sessionExecute).toHaveBeenCalledTimes(3);
		expect(driver.transaction).toHaveBeenCalledTimes(1);
		// nothing ever reached the top-level (out-of-transaction) execute.
		expect(driver.execute).not.toHaveBeenCalled();
	});

	it("checks the capability before any send -- driver.transaction never runs without interactive-transactions", async () => {
		const { driver } = transactionalDriver(false);
		const handle = db({ posts }, driver);

		await expect(
			handle.transaction(async (tx) => {
				await tx.execute(select(posts));
			}),
		).rejects.toThrow(/interactive-transactions/);

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
	});

	it("tx.transaction() brackets its callback with a savepoint and releases it", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);

		await handle.transaction(async (tx) => {
			await tx.execute(select(posts));
			await tx.transaction(async (inner) => {
				await inner.execute(select(posts));
			});
			await tx.execute(select(posts));
		});

		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		expect(sql[0]).toContain("select");
		expect(sql[1]).toBe('savepoint "hejbro_sp_1"');
		expect(sql[2]).toContain("select");
		expect(sql[3]).toBe('release savepoint "hejbro_sp_1"');
		expect(sql[4]).toContain("select");
		// one driver transaction, one connection -- the savepoint is not a
		// second BEGIN.
		expect(driver.transaction).toHaveBeenCalledTimes(1);
	});

	it("a throwing nested callback rolls back to its savepoint and rethrows unchanged", async () => {
		const { driver, sessionExecute, commit, rollback } =
			transactionalDriver(true);
		const handle = db({ posts }, driver);
		const boom = new Error("inner failed");

		const outcome = await handle.transaction(async (tx) => {
			const caught = await tx
				.transaction(async () => {
					throw boom;
				})
				.catch((error: unknown) => error);
			await tx.execute(select(posts));
			return caught;
		});

		// the callback's own error, not wrapped or reinterpreted.
		expect(outcome).toBe(boom);
		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		expect(sql[0]).toBe('savepoint "hejbro_sp_1"');
		expect(sql[1]).toBe('rollback to savepoint "hejbro_sp_1"');
		expect(sql[2]).toContain("select");
		// the OUTER transaction still commits -- a rolled-back savepoint
		// does not abort the transaction that contains it.
		expect(commit).toHaveBeenCalledTimes(1);
		expect(rollback).not.toHaveBeenCalled();
	});

	it("sibling and deeper savepoints get distinct names within one transaction", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);

		await handle.transaction(async (tx) => {
			await tx.transaction(async (inner) => {
				await inner.transaction(async () => {});
			});
			await tx.transaction(async () => {});
		});

		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		expect(sql).toEqual([
			'savepoint "hejbro_sp_1"',
			'savepoint "hejbro_sp_2"',
			'release savepoint "hejbro_sp_2"',
			'release savepoint "hejbro_sp_1"',
			'savepoint "hejbro_sp_3"',
			'release savepoint "hejbro_sp_3"',
		]);
	});

	it("a nested transaction() call fails fast with nested-transaction-unsupported, before any further send", async () => {
		const { driver } = transactionalDriver(true);
		const handle = db({ posts }, driver);

		await expect(
			handle.transaction(async () => {
				await handle.transaction(async () => {
					// unreachable -- the outer transaction() call must reject
					// before this inner callback ever runs.
				});
			}),
		).rejects.toThrow(
			/nested-transaction-unsupported|already-open transaction/,
		);

		try {
			await handle.transaction(async () => {
				await handle.transaction(async () => {});
			});
		} catch (error) {
			expect(error).toHaveProperty("code", "nested-transaction-unsupported");
		}

		// exactly the two outer attempts opened a real driver transaction --
		// the inner, nested call never reached driver.transaction a second
		// time within either attempt.
		expect(driver.transaction).toHaveBeenCalledTimes(2);
	});
});

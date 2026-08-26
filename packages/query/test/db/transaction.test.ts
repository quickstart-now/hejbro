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
		const handle = db({ tables: { posts } }, driver);

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
		const handle = db({ tables: { posts } }, driver);
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
		const handle = db({ tables: { posts } }, driver);

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
		const handle = db({ tables: { posts } }, driver);

		await expect(
			handle.transaction(async (tx) => {
				await tx.execute(select(posts));
			}),
		).rejects.toThrow(/interactive-transactions/);

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
	});

	it("a nested transaction() call fails fast with nested-transaction-unsupported, before any further send", async () => {
		const { driver } = transactionalDriver(true);
		const handle = db({ tables: { posts } }, driver);

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

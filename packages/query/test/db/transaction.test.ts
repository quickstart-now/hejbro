import { schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/db";
import type { Driver, DriverSession } from "../../src/driver/contract";
import type { Tx } from "../../src/db/transaction";

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
		// the rolled-back savepoint is also released, so it does not linger
		// on the savepoint stack for the rest of the enclosing transaction.
		expect(sql[2]).toBe('release savepoint "hejbro_sp_1"');
		expect(sql[3]).toContain("select");
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

	it("concurrent sibling nested transactions are rejected, and the first sibling's work survives", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		const secondRan = vi.fn();

		await handle.transaction(async (tx) => {
			const [firstOutcome, secondOutcome] = await Promise.all([
				tx.transaction(async (inner) => {
					await inner.execute(select(posts));
					return "first-survived";
				}),
				tx
					.transaction(async (inner) => {
						secondRan();
						await inner.execute(select(posts));
					})
					.catch((error: unknown) => error),
			]);

			// "the callback never ran" first (reviewer's recommendation) --
			// not merely "some error happened somewhere", which today's
			// unguarded interleaving can also produce by accident depending
			// on timing. This is the assertion that must fail first.
			expect(secondRan).not.toHaveBeenCalled();
			// the first sibling completed and returned its own value -- its
			// work was never touched by the second sibling's rejection.
			expect(firstOutcome).toBe("first-survived");
			expect(secondOutcome).toHaveProperty(
				"code",
				"concurrent-nested-transaction",
			);
		});

		// no savepoint statement for the rejected sibling ever reached the
		// connection.
		expect(secondRan).not.toHaveBeenCalled();
		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		expect(sql).toEqual([
			'savepoint "hejbro_sp_1"',
			expect.stringContaining("select"),
			'release savepoint "hejbro_sp_1"',
		]);
	});

	it("a nested callback that throws synchronously rolls back to its savepoint and rethrows unchanged", async () => {
		const { driver, sessionExecute, commit, rollback } =
			transactionalDriver(true);
		const handle = db({ posts }, driver);
		const boom = new Error("sync boom");

		const outcome = await handle.transaction(async (tx) => {
			const caught = await tx
				.transaction((): never => {
					throw boom;
				})
				.catch((error: unknown) => error);
			await tx.execute(select(posts));
			return caught;
		});

		expect(outcome).toBe(boom);
		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		expect(sql[0]).toBe('savepoint "hejbro_sp_1"');
		expect(sql[1]).toBe('rollback to savepoint "hejbro_sp_1"');
		expect(sql[2]).toBe('release savepoint "hejbro_sp_1"');
		expect(sql[3]).toContain("select");
		expect(commit).toHaveBeenCalledTimes(1);
		expect(rollback).not.toHaveBeenCalled();
	});

	it("a rolled-back savepoint is released, leaving no savepoint behind", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		const boom = new Error("boom");

		await handle.transaction(async (tx) => {
			await tx
				.transaction(async () => {
					throw boom;
				})
				.catch(() => {});
			// a later sibling gets a fresh, distinct savepoint name --
			// proving the earlier one left no savepoint behind to collide
			// with or accidentally reuse.
			await tx.transaction(async () => {});
		});

		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		expect(sql).toEqual([
			'savepoint "hejbro_sp_1"',
			'rollback to savepoint "hejbro_sp_1"',
			'release savepoint "hejbro_sp_1"',
			'savepoint "hejbro_sp_2"',
			'release savepoint "hejbro_sp_2"',
		]);
	});

	// This test and the next are a pair, not a duplicate: an all-attempts-
	// fail fixture (this one) can't tell a first release failure from a
	// last one by message text alone, so only the next test (recovery
	// succeeds) catches `cause` drifting to the recovery release's own
	// result instead of staying pinned to the original failure. Keep both.
	it("a swallowed statement error inside a nested callback issues a ROLLBACK TO and surfaces savepoint-release-failed", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		// simulates what a real Postgres connection does after a swallowed
		// statement error: the subtransaction is left aborted, so the
		// RELEASE that follows a normal return fails.
		sessionExecute.mockImplementation(async (compiled: { sql: string }) => {
			if (compiled.sql === 'release savepoint "hejbro_sp_1"') {
				throw new Error("current transaction is aborted");
			}
			return [];
		});

		const outcome = await handle
			.transaction(async (tx) =>
				tx.transaction(async (inner) => {
					await inner.execute(select(posts)).catch(() => {
						// swallowed -- the bug this recovers from.
					});
				}),
			)
			.catch((error: unknown) => error);

		expect(outcome).toHaveProperty("code", "savepoint-release-failed");
		expect(outcome).toHaveProperty("cause");
		// pinned by what the cause's own message names, not merely "a cause
		// exists" -- confirms `cause` is really the RELEASE failure (the
		// spec's own "carrying the release failure as cause"), not some
		// other statement's error swept in by accident.
		expect(
			(outcome as { cause?: { message?: string } }).cause?.message,
		).toContain('release savepoint "hejbro_sp_1"');
		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		expect(sql).toEqual([
			'savepoint "hejbro_sp_1"',
			expect.stringContaining("select"),
			'release savepoint "hejbro_sp_1"',
			'rollback to savepoint "hejbro_sp_1"',
			// best-effort: the recovery rollback clears the aborted state, so
			// the savepoint is released too (task 1.4's invariant) -- this
			// fixture keeps failing every "release" call, so it fails again
			// here too, without changing what error surfaced above.
			'release savepoint "hejbro_sp_1"',
		]);
	});

	it("a swallowed statement error's recovery releases the savepoint once the connection is usable again", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		let releaseAttempts = 0;
		sessionExecute.mockImplementation(async (compiled: { sql: string }) => {
			if (compiled.sql === 'release savepoint "hejbro_sp_1"') {
				releaseAttempts += 1;
				if (releaseAttempts === 1) {
					throw new Error("current transaction is aborted");
				}
			}
			return [];
		});

		const outcome = await handle
			.transaction(async (tx) =>
				tx.transaction(async (inner) => {
					await inner.execute(select(posts)).catch(() => {
						// swallowed -- the bug this recovers from.
					});
				}),
			)
			.catch((error: unknown) => error);

		expect(outcome).toHaveProperty("code", "savepoint-release-failed");
		// the error identity is pinned to the FIRST release failure (the one
		// that triggered recovery), not whatever the best-effort second
		// attempt did -- here the second attempt SUCCEEDS, so if `cause`
		// had drifted to "whatever the recovery release last saw" it would
		// have no failure to report at all.
		expect(
			(outcome as { cause?: { message?: string } }).cause?.message,
		).toContain('release savepoint "hejbro_sp_1"');
		const sql = sessionExecute.mock.calls.map(
			(call) => (call[0] as { sql: string }).sql,
		);
		// the second release attempt (after the recovery rollback) succeeds,
		// so no savepoint is left open -- the error is still surfaced (the
		// swallowed statement error is still a bug), but the connection's
		// own bookkeeping is clean.
		expect(sql).toEqual([
			'savepoint "hejbro_sp_1"',
			expect.stringContaining("select"),
			'release savepoint "hejbro_sp_1"',
			'rollback to savepoint "hejbro_sp_1"',
			'release savepoint "hejbro_sp_1"',
		]);
		expect(releaseAttempts).toBe(2);
	});

	it("a failing rollback surfaces savepoint-rollback-failed with a message stating both outcomes", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		const boom = new Error("callback boom");
		sessionExecute.mockImplementation(async (compiled: { sql: string }) => {
			if (compiled.sql === 'rollback to savepoint "hejbro_sp_1"') {
				throw new Error("connection reset");
			}
			return [];
		});

		const outcome = await handle
			.transaction((tx) =>
				tx.transaction(async () => {
					throw boom;
				}),
			)
			.catch((error: unknown) => error);

		expect(outcome).toHaveProperty("code", "savepoint-rollback-failed");
		expect(outcome).toHaveProperty("cause");
		expect(outcome).toHaveProperty("callbackError", boom);
		const message = (outcome as Error).message;
		expect(message).toContain(
			'rolling back to savepoint "hejbro_sp_1" failed after the nested transaction callback threw.',
		);
		expect(message).toContain("Do not catch this error");
		expect(message).not.toContain("the enclosing transaction will roll back");
	});

	it("a failing recovery rollback falls through to savepoint-rollback-failed, stating only true facts (#445 review B2/B3)", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		sessionExecute.mockImplementation(async (compiled: { sql: string }) => {
			if (compiled.sql === 'release savepoint "hejbro_sp_1"') {
				throw new Error("current transaction is aborted");
			}
			if (compiled.sql === 'rollback to savepoint "hejbro_sp_1"') {
				throw new Error("connection reset");
			}
			return [];
		});

		const outcome = await handle
			.transaction(async (tx) =>
				tx.transaction(async (inner) => {
					// a swallowed statement error, same shape as the
					// savepoint-release-failed tests above -- except this
					// time the recovery rollback ITSELF also fails.
					await inner.execute(select(posts)).catch(() => {});
				}),
			)
			.catch((error: unknown) => error);

		expect(outcome).toHaveProperty("code", "savepoint-rollback-failed");
		expect(outcome).toHaveProperty("cause");
		// carried under its own name, not the callback-throw path's
		// "callbackError" -- the callback here returned normally, it never
		// threw, so filing this under "callbackError" would itself repeat
		// the exact defect R1 (1.5) fixed on the sibling path (review B2).
		expect(outcome).toHaveProperty("releaseError");
		expect(outcome).not.toHaveProperty("callbackError");

		// `cause` is THIS rollback's own failure, `releaseError` is the
		// earlier release failure it was trying to recover from -- pinned
		// by which statement each one's own message names, not merely "a
		// cause exists" (reviewer's recommendation).
		type Wrapped = { message?: string; cause?: { message?: string } };
		const rollbackFailure = (outcome as { cause?: Wrapped }).cause;
		expect(rollbackFailure?.message).toContain(
			'rollback to savepoint "hejbro_sp_1"',
		);
		expect(rollbackFailure?.cause?.message).toBe("connection reset");
		const releaseFailure = (outcome as { releaseError?: Wrapped }).releaseError;
		expect(releaseFailure?.message).toContain(
			'release savepoint "hejbro_sp_1"',
		);
		expect(releaseFailure?.cause?.message).toBe(
			"current transaction is aborted",
		);

		const message = (outcome as Error).message;
		// truthful for THIS path: the callback returned normally, so the
		// message must not claim it threw (review B2's own defect class).
		expect(message).not.toContain("the nested transaction callback threw");
		expect(message).toContain("returned normally");
		expect(message).toContain("Do not catch this error");
		expect(message).toContain('"releaseError"');
	});

	it("a release failure after a successful rollback still rethrows the callback's own error (#445 review B4)", async () => {
		const { driver, sessionExecute } = transactionalDriver(true);
		const handle = db({ posts }, driver);
		const boom = new Error("callback boom");
		sessionExecute.mockImplementation(async (compiled: { sql: string }) => {
			if (compiled.sql === 'release savepoint "hejbro_sp_1"') {
				throw new Error("release failed too, after a successful rollback");
			}
			return [];
		});

		const outcome = await handle
			.transaction((tx) =>
				tx.transaction(async () => {
					throw boom;
				}),
			)
			.catch((error: unknown) => error);

		// the callback's own error survives, identity-unchanged -- this
		// release is best-effort cleanup only (task 1.4); a failure in it
		// must never replace or swallow what the callback actually threw.
		expect(outcome).toBe(boom);
	});

	/**
	 * #449: a statement issued through the `tx` that started an in-flight
	 * nested transaction lands inside the nested savepoint bracket and
	 * shares its fate, rolled back with it if the nested callback throws --
	 * silently, since nothing refuses it today. Every shape below shares
	 * the same connection as `tx.transaction(a)`; only the first three rows
	 * are new refusals, the rest are controls that must keep passing.
	 */
	describe("a statement beside an in-flight nested transaction is refused (#449)", () => {
		it("tx.execute is refused, and the nested transaction's own work survives", async () => {
			const { driver, sessionExecute } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				const [aOutcome, executeOutcome] = await Promise.all([
					tx.transaction(async (inner) => {
						await inner.execute(select(posts));
						return "a-survived";
					}),
					tx.execute(select(posts)).catch((error: unknown) => error),
				]);

				expect(aOutcome).toBe("a-survived");
				expect(executeOutcome).toHaveProperty(
					"code",
					"statement-during-nested-transaction",
				);
			});

			const sql = sessionExecute.mock.calls.map(
				(call) => (call[0] as { sql: string }).sql,
			);
			expect(sql).toEqual([
				'savepoint "hejbro_sp_1"',
				expect.stringContaining("select"),
				'release savepoint "hejbro_sp_1"',
			]);
		});

		it("a select chain built before the nested transaction starts is refused at the await, not at construction", async () => {
			const { driver } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				const chain = tx.select(posts);
				// Building refuses nothing -- it sends nothing (task 1.3/Q3d).
				expect(typeof chain.then).toBe("function");
				expect(chain.compile()).toBeDefined();

				const [aOutcome, chainOutcome] = await Promise.all([
					tx.transaction(async (inner) => {
						await inner.execute(select(posts));
						return "a-survived";
					}),
					Promise.resolve(chain).catch((error: unknown) => error),
				]);

				expect(aOutcome).toBe("a-survived");
				expect(chainOutcome).toHaveProperty(
					"code",
					"statement-during-nested-transaction",
				);
			});
		});

		it("an insert chain and a with chain are refused the same way", async () => {
			const { driver } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				const insertChain = tx
					.insert(posts)
					.values({ id: "11111111-1111-1111-1111-111111111111", status: "draft" });
				const withChain = tx.with((w) => {
					const ranked = w.as("ranked", select(posts));
					return select({ id: ranked.id, status: ranked.status }, ranked);
				});

				const [aOutcome, insertOutcome, withOutcome] = await Promise.all([
					tx.transaction(async (inner) => {
						await inner.execute(select(posts));
						return "a-survived";
					}),
					Promise.resolve(insertChain).catch((error: unknown) => error),
					Promise.resolve(withChain).catch((error: unknown) => error),
				]);

				expect(aOutcome).toBe("a-survived");
				expect(insertOutcome).toHaveProperty(
					"code",
					"statement-during-nested-transaction",
				);
				expect(withOutcome).toHaveProperty(
					"code",
					"statement-during-nested-transaction",
				);
			});
		});

		it("two concurrent nested transactions on the same tx still reject with concurrent-nested-transaction (control, #445 unchanged)", async () => {
			const { driver } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				const [firstOutcome, secondOutcome] = await Promise.all([
					tx.transaction(async (inner) => {
						await inner.execute(select(posts));
						return "first-survived";
					}),
					tx.transaction(async () => {}).catch((error: unknown) => error),
				]);

				expect(firstOutcome).toBe("first-survived");
				expect(secondOutcome).toHaveProperty(
					"code",
					"concurrent-nested-transaction",
				);
			});
		});

		it("sequential use after a nested transaction settles still runs normally (control)", async () => {
			const { driver } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				await tx.transaction(async (inner) => {
					await inner.execute(select(posts));
				});
				await expect(tx.execute(select(posts))).resolves.toEqual([]);
			});
		});

		it("the nested callback's own tx sends its own statements normally (control)", async () => {
			const { driver } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				await expect(
					tx.transaction(async (inner) => inner.execute(select(posts))),
				).resolves.toEqual([]);
			});
		});

		it("a nested transaction that throws, caught, still lets the outer tx send afterward (control, existing behavior)", async () => {
			const { driver } = transactionalDriver(true);
			const handle = db({ posts }, driver);
			const boom = new Error("inner failed");

			await handle.transaction(async (tx) => {
				await tx
					.transaction(async () => {
						throw boom;
					})
					.catch(() => {});
				await expect(tx.execute(select(posts))).resolves.toEqual([]);
			});
		});
	});

	/**
	 * task 1.4: the whole tree, not one level -- any `tx` above an in-flight
	 * nested transaction is refused alike, and a nested handle kept past its
	 * own callback's settling is refused under its own code, since its
	 * savepoint no longer exists.
	 */
	describe("the whole tree is guarded, and a settled handle is refused under its own code (#449)", () => {
		it("calling a chain's .then directly returns a rejection instead of throwing synchronously", async () => {
			const { driver } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				const chain = tx.select(posts);
				const nestedPromise = tx.transaction(async (inner) => {
					await inner.execute(select(posts));
					return "a-survived";
				});

				const captured = { error: undefined as unknown, called: false };
				expect(() =>
					chain.then(
						() => {},
						(error: unknown) => {
							captured.called = true;
							captured.error = error;
						},
					),
				).not.toThrow();

				const aOutcome = await nestedPromise;
				expect(aOutcome).toBe("a-survived");
				expect(captured.called).toBe(true);
				expect(captured.error).toHaveProperty(
					"code",
					"statement-during-nested-transaction",
				);
			});
		});

		it("any tx above an in-flight nested transaction is refused alike (grandparent)", async () => {
			const { driver, sessionExecute } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (outer) => {
				await outer.transaction(async (mid) => {
					const [aOutcome, outerOutcome] = await Promise.all([
						mid.transaction(async (inner) => {
							await inner.execute(select(posts));
							return "a-survived";
						}),
						outer.execute(select(posts)).catch((error: unknown) => error),
					]);

					expect(aOutcome).toBe("a-survived");
					expect(outerOutcome).toHaveProperty(
						"code",
						"statement-during-nested-transaction",
					);
				});
			});

			const sql = sessionExecute.mock.calls.map(
				(call) => (call[0] as { sql: string }).sql,
			);
			// no select from `outer` ever reached the connection -- only `a`'s.
			expect(sql).toEqual([
				'savepoint "hejbro_sp_1"',
				'savepoint "hejbro_sp_2"',
				expect.stringContaining("select"),
				'release savepoint "hejbro_sp_2"',
				'release savepoint "hejbro_sp_1"',
			]);
		});

		it("a settled (released) nested handle is refused with statement-after-nested-transaction", async () => {
			const { driver, sessionExecute } = transactionalDriver(true);
			const handle = db({ posts }, driver);

			await handle.transaction(async (tx) => {
				const leaked = await tx.transaction(async (inner) => inner);
				const outcome = await leaked
					.execute(select(posts))
					.catch((error: unknown) => error);
				expect(outcome).toHaveProperty(
					"code",
					"statement-after-nested-transaction",
				);
			});

			const sql = sessionExecute.mock.calls.map(
				(call) => (call[0] as { sql: string }).sql,
			);
			// the leaked handle's execute never reached the connection.
			expect(sql).toEqual([
				'savepoint "hejbro_sp_1"',
				'release savepoint "hejbro_sp_1"',
			]);
		});

		it("a settled (rolled back) nested handle is refused with statement-after-nested-transaction", async () => {
			const { driver, sessionExecute } = transactionalDriver(true);
			const handle = db({ posts }, driver);
			const boom = new Error("inner failed");
			const holder = { inner: undefined as Tx | undefined };

			await handle.transaction(async (tx) => {
				await tx
					.transaction(async (inner) => {
						holder.inner = inner;
						throw boom;
					})
					.catch(() => {});

				const outcome = await holder.inner
					?.execute(select(posts))
					.catch((error: unknown) => error);
				expect(outcome).toHaveProperty(
					"code",
					"statement-after-nested-transaction",
				);
			});

			const sql = sessionExecute.mock.calls.map(
				(call) => (call[0] as { sql: string }).sql,
			);
			expect(sql).toEqual([
				'savepoint "hejbro_sp_1"',
				'rollback to savepoint "hejbro_sp_1"',
				'release savepoint "hejbro_sp_1"',
			]);
		});

		it("sequential use after a nested transaction settles keeps working, for both released and rolled-back (control)", async () => {
			const { driver, sessionExecute } = transactionalDriver(true);
			const handle = db({ posts }, driver);
			const boom = new Error("inner failed");

			await handle.transaction(async (tx) => {
				await tx.transaction(async (inner) => {
					await inner.execute(select(posts));
				});
				await expect(tx.execute(select(posts))).resolves.toEqual([]);
				await expect(tx.transaction(async () => {})).resolves.toBeUndefined();

				await tx
					.transaction(async () => {
						throw boom;
					})
					.catch(() => {});
				await expect(tx.execute(select(posts))).resolves.toEqual([]);
				await expect(tx.transaction(async () => {})).resolves.toBeUndefined();
			});

			const sql = sessionExecute.mock.calls.map(
				(call) => (call[0] as { sql: string }).sql,
			);
			const savepoints = sql.filter((statement) =>
				statement.startsWith("savepoint"),
			);
			expect(savepoints).toEqual([
				'savepoint "hejbro_sp_1"',
				'savepoint "hejbro_sp_2"',
				'savepoint "hejbro_sp_3"',
				'savepoint "hejbro_sp_4"',
			]);
		});
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

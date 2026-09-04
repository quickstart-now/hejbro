import type {
	CompileResult,
	Driver,
	DriverRow,
	DriverSession,
} from "@hejbro/query";
import { assertSessionStateConformance } from "@hejbro/query/testing/driver-conformance";
import { describe, expect, it, vi } from "vitest";
import { PIN_STATEMENTS, poolerDriver, sendPins } from "../src/pooler";

/** A minimal contract `Driver` fixture -- no concrete driver implementation, mirroring `driver.test.ts`'s own `fakeDriver`. */
const fakeDriver = (): Driver => ({
	capabilities: { "interactive-transactions": true, "session-state": true },
	execute: vi.fn(async () => []),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => []) }),
	),
	setupSession: vi.fn(async () => {}),
});

/**
 * A driver that models one BEGIN/COMMIT per `driver.transaction()` call
 * and records every statement sent on that connection, in order --
 * mirrors `driver.test.ts`'s own `recordingTransactionalDriver`, so a
 * `poolerDriver`-wrapped `transaction()`/`execute()` call here can be
 * checked against exactly what it sent, and how many times the wrapped
 * driver's own `transaction` was entered. `rowsBySql`, when given,
 * answers a statement's own `sql` text with its rows (task 1.4's
 * caller-rows/pins'-empty-rows distinction) -- every other statement,
 * pins included, answers `[]`, exactly like a real pin statement's own
 * (empty) result.
 */
const recordingTransactionalDriver = (
	rowsBySql?: ReadonlyMap<string, ReadonlyArray<DriverRow>>,
): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<ReadonlyArray<CompileResult>>;
} => {
	const sentPerTransaction: Array<ReadonlyArray<CompileResult>> = [];
	const driver: Driver = {
		capabilities: { "interactive-transactions": true, "session-state": true },
		execute: vi.fn(async () => []),
		transaction: vi.fn(async (callback) => {
			const sent: Array<CompileResult> = [];
			sentPerTransaction.push(sent);
			const session: DriverSession = {
				execute: vi.fn(async (compiled: CompileResult) => {
					sent.push(compiled);
					return rowsBySql?.get(compiled.sql) ?? [];
				}),
			};
			return callback(session);
		}),
		setupSession: vi.fn(async () => {}),
	};
	return { driver, sentPerTransaction };
};

describe("poolerDriver(driver) (task 1.1)", () => {
	it("declares interactive-transactions true and session-state false, never inherited from the wrapped driver's own declaration", () => {
		const driver = fakeDriver();

		const wrapped = poolerDriver(driver);

		expect(wrapped.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": false,
		});
	});
});

describe("PIN_STATEMENTS / sendPins (task 1.2)", () => {
	it("sends the exact pin statements, in order, and nothing else, on one session", async () => {
		const recorded: Array<CompileResult> = [];
		const session: DriverSession = {
			execute: vi.fn(async (compiled: CompileResult) => {
				recorded.push(compiled);
				return [];
			}),
		};

		await sendPins(session);

		expect(recorded).toEqual([...PIN_STATEMENTS]);
	});

	it("pins IntervalStyle and bytea_output, transaction-locally -- SET LOCAL, never session-scoped SET", () => {
		expect(PIN_STATEMENTS).toEqual([
			{ sql: "set local intervalstyle to 'postgres'", params: [], kind: "sql" },
			{ sql: "set local bytea_output to 'hex'", params: [], kind: "sql" },
		]);
	});
});

describe("poolerDriver(driver).transaction(callback) (task 1.3)", () => {
	it("sends the pins as the transaction's first statements, ahead of the callback's own, on one wrapped-driver transaction", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const wrapped = poolerDriver(driver);

		const result = await wrapped.transaction(async (session) => {
			await session.execute({ sql: "select 1", params: [], kind: "sql" });
			return "done";
		});

		expect(result).toBe("done");
		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction).toEqual([
			[...PIN_STATEMENTS, { sql: "select 1", params: [], kind: "sql" }],
		]);
	});

	it("opens no second transaction around the caller's own -- exactly one wrapped-driver transaction per call", async () => {
		const { driver } = recordingTransactionalDriver();
		const wrapped = poolerDriver(driver);

		await wrapped.transaction(async () => "done");

		expect(driver.transaction).toHaveBeenCalledTimes(1);
	});
});

describe("poolerDriver(driver).execute(compiled) (task 1.4)", () => {
	it("opens its own transaction, sends the pins first, then the caller's statement, and returns the caller's own rows -- never the pins' own empty results", async () => {
		const callerStatement: CompileResult = {
			sql: "select 1",
			params: [],
			kind: "sql",
		};
		const callerRows: ReadonlyArray<DriverRow> = [{ answer: 1 }];
		const { driver, sentPerTransaction } = recordingTransactionalDriver(
			new Map([[callerStatement.sql, callerRows]]),
		);
		const wrapped = poolerDriver(driver);

		const rows = await wrapped.execute(callerStatement);

		expect(rows).toEqual(callerRows);
		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction).toEqual([[...PIN_STATEMENTS, callerStatement]]);
	});

	/**
	 * The drift trigger 1.2 names: this fixture's rows are shaped the way
	 * `@hejbro/pg`'s own `intervalPassthroughTypes` delivers a **pinned**
	 * connection's `interval`/`bytea` columns (raw Postgres text, never a
	 * pre-parsed object or the unpinned hex/escape encoding) -- a real
	 * Postgres session only produces these shapes when `PIN_STATEMENTS`
	 * actually reached it (design.md's own measurement is what establishes
	 * that fact for a real connection; this unit test cannot open one). If
	 * a future edit to `PIN_STATEMENTS` stops matching what the value
	 * conversion layer needs, this is the fixture whose expected shape
	 * would need to change with it -- named here, not just asserted.
	 */
	it("interval and bytea rows reach the caller in the shapes the pins exist to produce", async () => {
		const callerStatement: CompileResult = {
			sql: "select iv, ba from widgets",
			params: [],
			kind: "sql",
		};
		const callerRows: ReadonlyArray<DriverRow> = [
			{ iv: "1 day 02:00:00", ba: "\\x0102" },
		];
		const { driver } = recordingTransactionalDriver(
			new Map([[callerStatement.sql, callerRows]]),
		);
		const wrapped = poolerDriver(driver);

		const rows = await wrapped.execute(callerStatement);

		expect(rows).toEqual(callerRows);
	});
});

describe("poolerDriver(driver).setupSession (task 1.5)", () => {
	it("is a deliberate no-op -- the pins ride with every transaction/execute instead (1.3/1.4), never once at checkout time", async () => {
		// `underlying.setupSession` mirrors `@hejbro/pg`'s real one (sends
		// the session-scoped `SET` it would run at checkout) only to give
		// this test a non-trivial member to prove is not what `wrapped`
		// sends when called directly. Nobody calls this member in
		// production, on either driver: `@hejbro/pg`'s own checkoutGuard
		// resolves its session-setup member on its own object, captured
		// before this decorator ever runs (#531), and the query layer's
		// contract never calls a driver's `setupSession` itself either --
		// only a driver's own connection-acquisition code does. This
		// no-op is this *value's* own honest content, not a claim that it
		// suppresses the wrapped driver's real checkout pin.
		const underlying: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: vi.fn(async () => []),
			transaction: vi.fn(async (callback) =>
				callback({ execute: vi.fn(async () => []) }),
			),
			setupSession: vi.fn(async (session: DriverSession) => {
				await session.execute({
					sql: "set intervalstyle to 'postgres'; set bytea_output to 'hex'",
					params: [],
					kind: "sql",
				});
			}),
		};
		const wrapped = poolerDriver(underlying);
		const recorded: Array<CompileResult> = [];
		const session: DriverSession = {
			execute: vi.fn(async (compiled: CompileResult) => {
				recorded.push(compiled);
				return [];
			}),
		};

		await wrapped.setupSession(session);

		expect(recorded).toEqual([]);
	});
});

/**
 * Task 1.6 -- the two properties the conformance kit (1.7) cannot see,
 * because its own observation is deliberately taken at the
 * driver-session surface (design.md's boundary): the statements that
 * pass through `session.execute`, never the bare `BEGIN` string the
 * wrapped driver sends around them. These tests record at the level
 * where the envelope **is** visible instead.
 */
describe("task 1.6: the envelope-positional properties the conformance kit cannot see", () => {
	const beginStatement: CompileResult = {
		sql: "BEGIN",
		params: [],
		kind: "sql",
	};
	const callerStatement: CompileResult = {
		sql: "select 1",
		params: [],
		kind: "sql",
	};

	it("the correct implementation: the pins are recorded after the transaction opens and before the caller's own statement", async () => {
		const envelope: Array<CompileResult> = [];
		const underlying: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: vi.fn(async () => []),
			transaction: vi.fn(async (callback) => {
				envelope.push(beginStatement);
				const session: DriverSession = {
					execute: vi.fn(async (compiled: CompileResult) => {
						envelope.push(compiled);
						return [];
					}),
				};
				return callback(session);
			}),
			setupSession: vi.fn(async () => {}),
		};
		const wrapped = poolerDriver(underlying);

		await wrapped.execute(callerStatement);

		expect(envelope).toEqual([
			beginStatement,
			...PIN_STATEMENTS,
			callerStatement,
		]);
	});

	it("the gap #528/1.2 closes: a fixture that sends the pins before the transaction opens is now rejected on two independent layers -- shape refusal for the (superseded) session-surface-only observation, and the positional check for the wire-level one", () => {
		// Not poolerDriver's own output (already proven correct above) --
		// this is the counterexample tasks.md's own red condition names,
		// built by hand: the pins run before `BEGIN` rather than inside the
		// transaction, on the same physical connection.
		const brokenEnvelope: ReadonlyArray<CompileResult> = [
			...PIN_STATEMENTS,
			beginStatement,
			callerStatement,
		];

		// (a) The wire-level envelope (1.7's own observation, post-1.3):
		// sees `BEGIN`, and the positional obligation (1.2) rejects this
		// ordering -- nothing was sent between the transaction's own
		// opening and the caller's own statement, because the pins landed
		// before `BEGIN`, not after it.
		expect(() =>
			assertSessionStateConformance(
				{ "interactive-transactions": true, "session-state": false },
				{ recordedOnConnection: brokenEnvelope, callerStatement },
			),
		).toThrowError(
			/no statement was sent between the transaction's own opening/,
		);

		// (b) The (superseded) session-surface-only observation never saw
		// `BEGIN` at all -- filtering it out models what that narrower
		// shape used to capture, back when it was accepted for this
		// declaration (and passed it, silently, which is the blind spot
		// #528 was filed over). The kit's own shape guard (1.2) now
		// refuses it outright, before it can even reach the positional
		// check.
		const sessionSurfaceOnly = brokenEnvelope.filter(
			(statement) => statement.sql !== beginStatement.sql,
		);
		expect(() =>
			assertSessionStateConformance(
				{ "interactive-transactions": true, "session-state": false },
				{ recordedForOneExecute: sessionSurfaceOnly, callerStatement },
			),
		).toThrowError(/recordedOnConnection\/callerStatement is required/);

		// If either assertion above ever matched the *other* half's
		// reason instead of its own (or stopped throwing), this test
		// would no longer be distinguishing the two layers it exists to
		// pin.
	});
});

describe("poolerDriver(driver) conforms to the driver contract (task 1.7, #481-style)", () => {
	it("conforms to the session-state:false tier -- the observation fed to the kit is the wire-level envelope (recordedOnConnection), the same one task 1.6's own fixture records, since the driver-session surface alone cannot show transaction control (#528)", async () => {
		const beginStatement: CompileResult = {
			sql: "BEGIN",
			params: [],
			kind: "sql",
		};
		const commitStatement: CompileResult = {
			sql: "COMMIT",
			params: [],
			kind: "sql",
		};
		const envelope: Array<CompileResult> = [];
		const underlying: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: vi.fn(async () => []),
			transaction: vi.fn(async (callback) => {
				envelope.push(beginStatement);
				const session: DriverSession = {
					execute: vi.fn(async (compiled: CompileResult) => {
						envelope.push(compiled);
						return [];
					}),
				};
				const result = await callback(session);
				envelope.push(commitStatement);
				return result;
			}),
			setupSession: vi.fn(async () => {}),
		};
		const wrapped = poolerDriver(underlying);
		const callerStatement: CompileResult = {
			sql: "select 1",
			params: [],
			kind: "sql",
		};

		await wrapped.execute(callerStatement);

		// `envelope` is the wire-level order the underlying driver actually
		// emits on its connection -- BEGIN, then whatever crossed
		// `session.execute` (the pins and the caller's own statement), then
		// COMMIT. This is what the kit's transaction-envelope obligation
		// (1.2) requires for this declaration; the driver-session-surface-
		// only shape (`recordedForOneExecute`) is refused outright for it
		// (proven by task 1.6's own red/green contrast test).
		expect(() =>
			assertSessionStateConformance(wrapped.capabilities, {
				recordedOnConnection: envelope,
				callerStatement,
			}),
		).not.toThrow();
	});
});

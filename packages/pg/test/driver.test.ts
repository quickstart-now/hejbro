import { grant, roleName, schema, select, table, uuid } from "@hejbro/core";
import type { ContextRendering } from "@hejbro/query";
import { db, defaultContextRendering } from "@hejbro/query";
import { assertSessionStateConformance } from "@hejbro/query/testing/driver-conformance";
import { Pool, types as pgTypes } from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgDriver } from "../src/driver";

/**
 * What `pgDriver` actually sends to a node-postgres client -- a bare SQL
 * string (`BEGIN`/`COMMIT`/`ROLLBACK`, the IntervalStyle pin) or a
 * structured query config (`text`/`values`/`types`, a statement routed
 * through `makeSession`). Typed narrowly to exactly the shapes the
 * driver constructs, so the stubs below never need a full `pg`
 * `QueryConfig`.
 */
type CapturedQueryConfig = {
	readonly text: string;
	readonly values: ReadonlyArray<unknown>;
	readonly types: {
		readonly getTypeParser: (
			oid: number,
			format?: string,
		) => (value: string) => unknown;
	};
};
type QueryCall = string | CapturedQueryConfig;

/** The oid parameter type `pg-types`'s own exported `getTypeParser` declares -- a fixed literal union of well-known *scalar* builtin oids, which doesn't include any array oid at all (1007/1187/etc). A cast, not a widening of our own driver's contract: `CustomTypesConfig.getTypeParser` (what `driver.ts` actually implements) takes a plain `number`, so this only unblocks calling `pg-types`'s own function directly as a reference-equality witness for an array oid. */
type PgTypesTypeId = Parameters<typeof pgTypes.getTypeParser>[0];

/** Casts an array oid (never a member of `pg-types`'s own scalar-only `TypeId` union) so it can still be passed to `pgTypes.getTypeParser` directly -- see {@link PgTypesTypeId}. */
const asPgTypesTypeId = (oid: number): PgTypesTypeId =>
	oid as unknown as PgTypesTypeId;

/** The SQL text a captured `client.query` call carries, whichever of the two {@link QueryCall} shapes it was sent as. */
const sqlTextOf = (call: QueryCall): string => {
	if (typeof call === "string") {
		return call;
	}
	return call.text;
};

/** Builds a `stubPoolWithClient` `failWhen` hook that fails exactly the one named statement with `failure`, succeeding otherwise -- the shape every single-statement failure-path test below needs. */
const failOnlyOn =
	(statementText: string, failure: Error) =>
	(call: QueryCall): Error | undefined => {
		if (sqlTextOf(call) === statementText) {
			return failure;
		}
		return undefined;
	};

/**
 * Yields past the microtask queue and one macrotask turn -- long enough
 * for a `pool.end()` scheduled anywhere during a round-trip (e.g.
 * `Promise.resolve().then(() => pool.end())`, not just a synchronous call)
 * to have already run before a "never auto-closes" assertion checks for
 * it. A bare `await driver.execute(...)` alone does not guarantee this: a
 * close scheduled as a trailing microtask can still be pending when the
 * `await` resolves.
 */
const flushAsyncWork = (): Promise<void> =>
	new Promise((resolve) => {
		setImmediate(resolve);
	});

/**
 * Builds one fresh release guard, mirroring pg-pool's own `_releaseOnce`
 * (verified against the installed `pg-pool@3.14.0` source,
 * `index.js:369-380`): a *new* closure is created per checkout (there,
 * `client.release = this._releaseOnce(...)` is reassigned inside
 * `_acquireClient` on every `connect()`), and calling *that checkout's*
 * `release()` a second time throws -- the same message pg-pool's own
 * guard uses. A plain `vi.fn()` stays silent no matter how many times
 * it's called, which is exactly the axis a double-release mutation needs
 * to be structurally caught on (the same reasoning as leaving `query` off
 * the stub `pool` entirely to block a wrong-connection statement
 * structurally, not just by inspection). Every checkout's calls are
 * logged into the one shared `releaseCalls` array (args included), so a
 * test can assert total count/arguments across however many checkouts
 * happened without needing a fresh guard reference each time.
 */
const releaseCallLogger = (): {
	readonly releaseCalls: Array<ReadonlyArray<unknown>>;
	readonly newGuard: () => ReturnType<typeof vi.fn>;
} => {
	const releaseCalls: Array<ReadonlyArray<unknown>> = [];
	const newGuard = (): ReturnType<typeof vi.fn> => {
		const released: { current: boolean } = { current: false };
		return vi.fn((...args: ReadonlyArray<unknown>) => {
			if (released.current) {
				throw new Error(
					"Release called on client which has already been released to the pool.",
				);
			}
			released.current = true;
			releaseCalls.push(args);
		});
	};
	return { releaseCalls, newGuard };
};

/**
 * A pool whose `connect` always hands back the *same* stub client
 * (simulating the pool reusing one physical connection across checkouts)
 * and records every call that client's own `query` received, in order.
 * Deliberately has no `query` method of its own -- if the driver ever
 * issued a statement through `pool.query` instead of the checked-out
 * client, that call would throw (not silently succeed against the wrong
 * connection), catching a session-binding regression decisively rather
 * than by inspection.
 *
 * `failWhen`, when given, throws its return value instead of succeeding
 * for exactly the calls it names -- the one hook every failure-path test
 * below needs (a failed pin, a failed BEGIN, a failed caller statement),
 * without each one hand-rolling its own client.
 */
const stubPoolWithClient = (
	failWhen?: (call: QueryCall) => Error | undefined,
): {
	readonly pool: Pool;
	readonly calls: Array<QueryCall>;
	readonly releaseCalls: Array<ReadonlyArray<unknown>>;
} => {
	const calls: Array<QueryCall> = [];
	const { releaseCalls, newGuard } = releaseCallLogger();
	const client: {
		query: ReturnType<typeof vi.fn>;
		release: ReturnType<typeof vi.fn>;
	} = {
		query: vi.fn(async (call: QueryCall) => {
			calls.push(call);
			const failure = failWhen?.(call);
			if (failure !== undefined) {
				throw failure;
			}
			return { rows: [] };
		}),
		release: newGuard(),
	};
	const pool = {
		connect: vi.fn(async () => {
			client.release = newGuard();
			return client;
		}),
	} as unknown as Pool;
	return { pool, calls, releaseCalls };
};

describe("pgDriver(pool) (owner decision ①, task 5.1)", () => {
	it("declares interactive-transactions and session-state true", () => {
		const pool = new Pool({
			connectionString: "postgres://localhost/does-not-need-to-connect",
		});
		const driver = pgDriver(pool);
		expect(driver.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": true,
		});
	});

	it("exposes the caller's own pool as client, the same reference -- one surface, no divergence (owner decision ②)", () => {
		const pool = new Pool({
			connectionString: "postgres://localhost/does-not-need-to-connect",
		});
		const driver = pgDriver(pool);
		expect(driver.client).toBe(pool);
	});
});

describe("pgDriver(connectionString) (owner decision ②, task 5.2)", () => {
	it("a connection-string driver exposes its own pool as client", () => {
		const driver = pgDriver("postgres://localhost/does-not-need-to-connect");
		expect(driver.client).toBeInstanceOf(Pool);
		expect(driver.client.options.connectionString).toBe(
			"postgres://localhost/does-not-need-to-connect",
		);
	});

	it("never auto-closes the pool it constructed, immediately after construction (cheap sanity check, not the full contract)", () => {
		const driver = pgDriver("postgres://localhost/does-not-need-to-connect");
		expect(driver.client.ended).toBe(false);
	});

	it("never auto-closes the pool across an execute round-trip (owner decision ②: pool lifetime = process lifetime, not query lifetime)", async () => {
		const driver = pgDriver("postgres://localhost/does-not-need-to-connect");
		// spies out the network entirely -- execute() checks out a client
		// (task 5.5's pin needs the real client, not pool.query()'s
		// implicit checkout), so both `connect` and the client's own
		// `query` are stubbed here.
		vi.spyOn(driver.client, "connect").mockResolvedValue({
			query: vi.fn(async () => ({ rows: [] })),
			release: vi.fn(),
		} as never);
		const endSpy = vi.spyOn(driver.client, "end");

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });
		await flushAsyncWork();

		expect(endSpy).not.toHaveBeenCalled();
	});

	it("never auto-closes the pool across a transaction round-trip, on either the commit or the rollback path", async () => {
		const driver = pgDriver("postgres://localhost/does-not-need-to-connect");
		vi.spyOn(driver.client, "connect").mockResolvedValue({
			query: vi.fn(async () => ({ rows: [] })),
			release: vi.fn(),
		} as never);
		const endSpy = vi.spyOn(driver.client, "end");

		await driver.transaction(async () => "done");
		await expect(
			driver.transaction(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await flushAsyncWork();

		expect(endSpy).not.toHaveBeenCalled();
	});
});

describe("pgDriver execute + interval types override (owner decision ③, task 5.3)", () => {
	it("interval reaches the row as Postgres text while other types keep pg defaults", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		// looked up by its own text, not position: task 5.5 adds a pin
		// statement ahead of every caller statement on a fresh connection,
		// and this test's own job is the types override, not ordering.
		const config = calls
			.filter((call): call is CapturedQueryConfig => typeof call !== "string")
			.find((call) => call.text === "select 1");
		if (config === undefined) {
			throw new Error("the caller's own statement was never sent");
		}
		expect(config.values).toEqual([]);

		// oid 1186 (interval): interval text must pass through untouched,
		// never as pg's own PostgresInterval object -- 5.0 scout proved
		// that object can't round-trip back to text (String() ->
		// "[object Object]", .toPostgres() reorders/reformats fields). The
		// value is a hand-written fixture in the shape of the server's
		// output grammar, not captured server output -- the real capture
		// lives in integration.test.ts's raw-grammar assertions (#341).
		const intervalFixture = "1 year 2 mons 3 days 04:05:06.789012";
		expect(config.types.getTypeParser(1186, "text")(intervalFixture)).toBe(
			intervalFixture,
		);

		// oid 1184 (timestamptz): still delegated to pg's own default --
		// a Date, not raw text. Without this axis, an override that
		// returns identity for every oid (breaking delegation entirely)
		// would still pass on the interval assertion alone.
		const timestamptzParsed = config.types.getTypeParser(
			1184,
			"text",
		)("2020-01-01 00:00:00+00");
		expect(timestamptzParsed).toBeInstanceOf(Date);

		// oid 20 (int8): pg's own default already returns text as-is
		// (identity) -- not a delegation witness on its own (an override
		// that answered every oid with identity would pass this one too),
		// kept only to document the "no client-side parsing" shape the
		// numeric-mode conversion layer (group 4) expects to receive.
		const int8Parsed = config.types.getTypeParser(
			20,
			"text",
		)("9007199254740993");
		expect(int8Parsed).toBe("9007199254740993");

		// format is forwarded, not dropped/defaulted: pg's own binary
		// parser for oid 23 (int4) is a *different* function from its text
		// parser (delegating with only `oid` would silently attach the
		// text parser to a binary-format column).
		const textParser = config.types.getTypeParser(23, "text");
		const binaryParser = config.types.getTypeParser(23, "binary");
		expect(binaryParser).not.toBe(textParser);

		// direct witness against pg's own module, not just internal
		// self-consistency: our override's binary-format answer for oid
		// 1184 must be the exact same function pg-types itself hands back
		// for ("1184", "binary") -- a `getTypeParser(oid)` (format
		// dropped) mutant would instead always answer with the *text*
		// parser here, since pg-types defaults a missing format to
		// "text" internally.
		expect(config.types.getTypeParser(1184, "binary")).toBe(
			pgTypes.getTypeParser(1184, "binary"),
		);
	});

	it("interval array and numeric array reach the row as raw array text while other array oids keep pg defaults (task 1.3, extended by B2.1/#320)", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		const config = calls
			.filter((call): call is CapturedQueryConfig => typeof call !== "string")
			.find((call) => call.text === "select 1");
		if (config === undefined) {
			throw new Error("the caller's own statement was never sent");
		}

		// oid 1187 (_interval, interval[]): raw Postgres array-literal text,
		// never pg's own default array parser (which would hand back an
		// array of PostgresInterval objects -- the same round-trip problem
		// the scalar oid 1186 override exists for, one level up).
		const intervalArrayRaw = '{"1 day","2 days 03:00:00"}';
		expect(config.types.getTypeParser(1187, "text")(intervalArrayRaw)).toBe(
			intervalArrayRaw,
		);

		// oid 1231 (_numeric, numeric[]) (B2.1, planner-approved extension):
		// raw array-literal text too -- pg's own default array parser would
		// otherwise hand back an array of already-`parseFloat`'d JS numbers
		// (found via the postgres:17 integration proof, 1.5), silently
		// destroying the exact decimal text a 'string'/'bigint'-mode
		// numeric[] column needs. `bigint[]` (oid 1016) is deliberately left
		// alone -- it already arrives as text elements from pg's own
		// default parser, no override needed there.
		const numericArrayRaw = "{123.450000,0.100000}";
		expect(config.types.getTypeParser(1231, "text")(numericArrayRaw)).toBe(
			numericArrayRaw,
		);

		// oid 1007 (_int4, integer[]): still delegated to pg's own default
		// array parser -- a JS array of already-parsed numbers, not text.
		// Without this axis, an override that answered every array oid with
		// identity (breaking delegation for every other array type) would
		// still pass the 1187/1231 assertions alone.
		expect(config.types.getTypeParser(1007, "text")("{1,2,3}")).toEqual([
			1, 2, 3,
		]);

		// oid 1016 (_int8, bigint[]): also still delegated -- pg's own
		// default array parser already returns text elements here, so
		// no override is needed (unlike 1231's own case just above).
		expect(config.types.getTypeParser(1016, "text")("{1,2,3}")).toEqual([
			"1",
			"2",
			"3",
		]);

		// format is forwarded for array oids too, not dropped/defaulted --
		// the same two-argument delegation witness task 5.3 established for
		// scalar oids.
		const textParser = config.types.getTypeParser(1007, "text");
		const binaryParser = config.types.getTypeParser(1007, "binary");
		expect(binaryParser).not.toBe(textParser);
		expect(config.types.getTypeParser(1007, "binary")).toBe(
			pgTypes.getTypeParser(asPgTypesTypeId(1007), "binary"),
		);
	});
});

describe("pgDriver transaction (task 5.4)", () => {
	it("runs a transaction's statements through one held client and commits on success", async () => {
		const { pool, calls, releaseCalls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		const result = await driver.transaction(async (session) => {
			await session.execute({ sql: "select 1", params: [], kind: "sql" });
			return "done";
		});

		expect(result).toBe("done");
		expect(pool.connect).toHaveBeenCalledTimes(1);
		// the pin (task 5.5) fires once ahead of BEGIN on this fresh
		// connection; BEGIN and COMMIT bracket the callback's own
		// statement, and every one of the four went through the same held
		// client (the stub pool has no `query` of its own to have
		// answered any of them).
		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"BEGIN",
			"select 1",
			"COMMIT",
		]);
		expect(releaseCalls).toHaveLength(1);
		expect(releaseCalls[0]).toEqual([]);
	});

	it("rolls back and rethrows the callback's own error, unchanged, when the callback throws", async () => {
		const { pool, calls, releaseCalls } = stubPoolWithClient();
		const driver = pgDriver(pool);
		const originalError = new Error("callback boom");

		await expect(
			driver.transaction(async () => {
				throw originalError;
			}),
		).rejects.toBe(originalError);

		// exactly one checkout for the one transaction() call -- BEGIN and
		// ROLLBACK alone wouldn't distinguish this from a (broken) second
		// checkout that also happened to emit the same two strings.
		expect(pool.connect).toHaveBeenCalledTimes(1);
		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"BEGIN",
			"ROLLBACK",
		]);
		// contrast pair with the ROLLBACK-itself-fails case below: an
		// ordinary successful rollback returns the client to the pool
		// normally (no truthy argument), never discards it.
		expect(releaseCalls).toHaveLength(1);
		expect(releaseCalls[0]).toEqual([]);
	});

	it("rethrows a thrown non-Error value unchanged (rethrow is not Error-specific, never normalized/wrapped)", async () => {
		const { pool } = stubPoolWithClient();
		const driver = pgDriver(pool);
		const thrown = { code: "not-an-error-instance" };

		// deliberately non-Error -- proves rethrow doesn't normalize/wrap it.
		await expect(
			driver.transaction(async () => {
				throw thrown;
			}),
		).rejects.toBe(thrown);
	});

	it("preserves the original callback error unchanged, and discards the connection, when ROLLBACK itself fails (owner ruling (b))", async () => {
		const rollbackError = new Error("connection reset");
		const { pool, releaseCalls } = stubPoolWithClient(
			failOnlyOn("ROLLBACK", rollbackError),
		);
		const driver = pgDriver(pool);
		const originalError = new Error("callback boom");
		// captured before the throw: `rejects.toBe(originalError)` alone
		// only proves reference identity -- it would still pass if
		// something did `Object.assign(originalError, { rollbackError })`
		// before rethrowing the same reference. Comparing own keys before
		// and after closes that gap (owner ruling: zero new contract
		// surface means no new field either, not just no new object).
		const keysBeforeRollback = Reflect.ownKeys(originalError);

		// the caller sees exactly the callback's own error -- never the
		// ROLLBACK failure, never a wrapper, never a new field carrying it
		// (owner ruling: zero new contract surface).
		await expect(
			driver.transaction(async () => {
				throw originalError;
			}),
		).rejects.toBe(originalError);
		expect(Reflect.ownKeys(originalError)).toEqual(keysBeforeRollback);

		// exactly one release() call (pg-pool's own _releaseOnce throws on
		// a second call -- this is what a double-release mutation trips),
		// and it discards the connection (release(true), the boolean
		// shorthand pg-pool's _release treats identically to an Error)
		// rather than returning a possibly-broken session to the pool.
		expect(releaseCalls).toHaveLength(1);
		expect(releaseCalls[0]).toEqual([true]);
	});

	it("releases without discarding when the pin itself fails before BEGIN (exit path not previously enumerated)", async () => {
		const pinFailure = new Error("set intervalstyle failed");
		const { pool, calls, releaseCalls } = stubPoolWithClient(
			failOnlyOn(
				"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
				pinFailure,
			),
		);
		const driver = pgDriver(pool);

		await expect(driver.transaction(async () => "unreachable")).rejects.toBe(
			pinFailure,
		);

		// ROLLBACK on a connection where BEGIN never ran is a harmless
		// Postgres no-op (a WARNING, not an error, per the real cluster) --
		// releaseAfterFailedTransaction sees "ROLLBACK succeeded" and
		// returns the client normally, not discarded. A pin failure isn't
		// evidence the connection itself is broken (it could just as
		// easily be a permission error), so this is the intended
		// behavior, not a gap in the discard logic.
		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"ROLLBACK",
		]);
		expect(releaseCalls).toHaveLength(1);
		expect(releaseCalls[0]).toEqual([]);
	});

	it("releases without discarding when BEGIN itself fails (exit path not previously enumerated)", async () => {
		const beginFailure = new Error("BEGIN failed");
		const { pool, calls, releaseCalls } = stubPoolWithClient(
			failOnlyOn("BEGIN", beginFailure),
		);
		const driver = pgDriver(pool);

		await expect(driver.transaction(async () => "unreachable")).rejects.toBe(
			beginFailure,
		);

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"BEGIN",
			"ROLLBACK",
		]);
		expect(releaseCalls).toHaveLength(1);
		expect(releaseCalls[0]).toEqual([]);
	});
});

describe("pgDriver execute release (task 5.4/5.5 follow-up, GAP-2: execute()'s release() had no test at all)", () => {
	it("releases the client after a successful execute()", async () => {
		const { pool, releaseCalls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(releaseCalls).toHaveLength(1);
	});

	it("releases the client even when execute() itself fails", async () => {
		const executeFailure = new Error("boom");
		const { pool, releaseCalls } = stubPoolWithClient(
			failOnlyOn("select 1", executeFailure),
		);
		const driver = pgDriver(pool);

		await expect(
			driver.execute({ sql: "select 1", params: [], kind: "sql" }),
		).rejects.toBe(executeFailure);

		expect(releaseCalls).toHaveLength(1);
	});
});

describe("pgDriver setupSession IntervalStyle pin (owner decision ④, task 5.5)", () => {
	it("pins a fresh connection with the IntervalStyle setting before the first caller statement, on the execute path", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		// order, not just presence: the pin must be *before* the caller's
		// own statement, since decision ④ exists specifically because a
		// connect-listener-only pin would race the first statement.
		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 1",
		]);
	});

	it("pins a fresh connection before BEGIN, on the transaction path", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		await driver.transaction(async (session) => {
			await session.execute({ sql: "select 1", params: [], kind: "sql" });
			return "done";
		});

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"BEGIN",
			"select 1",
			"COMMIT",
		]);
	});

	it("does not re-pin a reused connection (WeakSet hit) -- second execute on the same physical client sends no second pin", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });
		await driver.execute({ sql: "select 2", params: [], kind: "sql" });

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 1",
			"select 2",
		]);
	});

	it("shares pin state across the execute and transaction paths on the same physical connection", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });
		await driver.transaction(async (session) => {
			await session.execute({ sql: "select 2", params: [], kind: "sql" });
			return "done";
		});

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 1",
			"BEGIN",
			"select 2",
			"COMMIT",
		]);
	});

	it("retries the pin on the same physical connection after a failed pin attempt (owner review defect: a failed pin must never be recorded as pinned)", async () => {
		const calls: Array<QueryCall> = [];
		const pinFailure = new Error("set intervalstyle failed");
		const client = {
			query: vi.fn(async (call: QueryCall) => {
				calls.push(call);
				const pinAttempts = calls.filter(
					(c) =>
						sqlTextOf(c) ===
						"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
				).length;
				if (
					sqlTextOf(call) ===
						"set intervalstyle to 'postgres'; set bytea_output to 'hex'" &&
					pinAttempts === 1
				) {
					throw pinFailure;
				}
				return { rows: [] };
			}),
			release: vi.fn(),
		};
		const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
		const driver = pgDriver(pool);

		// the first execute()'s pin attempt fails, and the whole call
		// fails with it -- this is not the bug; the bug is what happens
		// to the *next* call on the same physical connection.
		await expect(
			driver.execute({ sql: "select 1", params: [], kind: "sql" }),
		).rejects.toBe(pinFailure);

		// a second call on the same (stub) physical connection must retry
		// the pin, not skip it -- if the failed attempt were recorded as
		// pinned, this statement would run unpinned with no error at all,
		// silently breaking owner decision ④.
		await driver.execute({ sql: "select 2", params: [], kind: "sql" });

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 2",
		]);
	});

	it("does not share pin state between two driver instances, even over the same underlying client (GAP-3: checkoutGuard's own tsdoc promises per-driver scope, but nothing exercised it)", async () => {
		// one physical client, checked out by two *different* pgDriver()
		// instances -- contrived (two drivers don't normally share an
		// underlying connection), but it's the only way to make a
		// module-level-WeakSet mutation observably differ from the
		// per-driver-instance guard the tsdoc promises: with two distinct
		// stub clients, either implementation pins each one once, and the
		// axis would stay unobserved.
		const calls: Array<QueryCall> = [];
		const client = {
			query: vi.fn(async (call: QueryCall) => {
				calls.push(call);
				return { rows: [] };
			}),
			release: vi.fn(),
		};
		const poolA = { connect: vi.fn(async () => client) } as unknown as Pool;
		const poolB = { connect: vi.fn(async () => client) } as unknown as Pool;
		const driverA = pgDriver(poolA);
		const driverB = pgDriver(poolB);

		await driverA.execute({ sql: "select 1", params: [], kind: "sql" });
		await driverB.execute({ sql: "select 2", params: [], kind: "sql" });

		// a module-level (shared) WeakSet would see driverB's checkout of
		// the same client object as already pinned by driverA and skip
		// the second pin -- per-driver scope pins independently.
		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 1",
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 2",
		]);
	});

	it("driver.setupSession itself sends the IntervalStyle pin to the session it's given (spec: 'session-setup hook SHALL send set intervalstyle to postgres on the session it is given')", async () => {
		// invoked directly, not through execute()/transaction() -- the
		// contract (driver-contract's own tsdoc) makes setupSession a
		// mandatory, independently callable member, and the spec sentence
		// is about what *it* does, not just an outcome the checkout paths
		// happen to produce. A no-op setupSession would still leave every
		// execute()/transaction() pin test above green, since those only
		// ever observe it indirectly through a checkout.
		const { pool } = stubPoolWithClient();
		const driver = pgDriver(pool);
		const received: Array<unknown> = [];
		const stubSession = {
			execute: vi.fn(async (compiled: unknown) => {
				received.push(compiled);
				return [];
			}),
		};

		await driver.setupSession(stubSession);

		expect(received).toEqual([
			{
				sql: "set intervalstyle to 'postgres'; set bytea_output to 'hex'",
				params: [],
				kind: "sql",
			},
		]);
	});

	it("a wrapped setupSession member runs at checkout -- late-binding, not the captured closure (task 1.4, #323)", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);

		// a preset decorator's own shape: read the current member, replace
		// it with a wrapper that still calls through to the original.
		const originalSetupSession = driver.setupSession;
		const wrapperCalls: Array<unknown> = [];
		driver.setupSession = async (session) => {
			wrapperCalls.push(session);
			await originalSetupSession(session);
		};

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		// the checkout guard read `driver.setupSession` itself at checkout
		// time -- if it had instead called a closure captured once at
		// `buildDriver()` time, this wrapper would never run at all, and
		// the pin statement would still reach the connection unwrapped.
		expect(wrapperCalls).toHaveLength(1);
		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 1",
		]);
	});
});

describe("pgDriver conforms to the driver contract (#481, task 1.7)", () => {
	it("conforms to the driver contract", async () => {
		// session-state:true (owner decision (1), group 5 header): the
		// obligation this driver declares is that its setup hook delivers
		// the settings -- invoked directly, mirroring this file's own
		// "driver.setupSession itself sends the IntervalStyle pin" test
		// above, which is exactly what the kit needs recorded.
		const { pool } = stubPoolWithClient();
		const driver = pgDriver(pool);
		const recorded: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
		const recordingSession = {
			execute: vi.fn(
				async (compiled: { sql: string; params: ReadonlyArray<unknown> }) => {
					recorded.push({ sql: compiled.sql, params: compiled.params });
					return [];
				},
			),
		};

		await driver.setupSession(recordingSession);

		expect(() =>
			assertSessionStateConformance(driver.capabilities, {
				recordedForSetupSession: recorded,
			}),
		).not.toThrow();
	});
});

describe("pgDriver + db.as(context) baseline pin (task 4.1, #557 -- fixed before the context-application generalization lands, so a later change that moves this is caught here)", () => {
	const app = schema("app");
	const items = table(app, "items", {
		id: uuid().primaryKey(),
	});
	const itemsGrant = grant(app).usage.to("app_role");

	it("sends the pin, the context statements, then the caller's statement, all inside one transaction -- the setting travels as a bind parameter, never inlined into the SQL text", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);
		const handle = db({ items, itemsGrant }, driver);

		await handle
			.as({ role: roleName("app_role"), settings: { "app.claim": "value" } })
			.execute(select(items));

		const texts = calls.map(sqlTextOf);
		expect(texts).toHaveLength(6);
		expect(texts[0]).toBe(
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
		);
		expect(texts[1]).toBe("BEGIN");
		// the context's own statements come first, in order, ahead of the
		// caller's own statement -- role first, then one set_config per
		// setting (spec: driver-contract, "Contributing nothing keeps the
		// existing statements").
		expect(texts[2]).toBe('set local role "app_role"');
		expect(texts[3]).toBe("select set_config($1, $2, true)");
		expect(texts[4]).toContain("items");
		expect(texts[5]).toBe("COMMIT");

		const settingCall = calls.find(
			(call): call is CapturedQueryConfig =>
				typeof call !== "string" &&
				call.text === "select set_config($1, $2, true)",
		);
		if (settingCall === undefined) {
			throw new Error("the setting statement was never sent");
		}
		expect(settingCall.values).toEqual(["app.claim", "value"]);
	});
});

describe("defaultContextRendering is reachable from @hejbro/query's public entry (#554/#555 review F1)", () => {
	it("a driver package can import it via the public specifier and compose its own statement after the default sequence -- never a deep/internal import", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = pgDriver(pool);
		const app = schema("app");
		const items = table(app, "items", { id: uuid().primaryKey() });
		const itemsGrant = grant(app).usage.to("app_role");

		// mirrors what a driver's own `renderContext` would do: compose the
		// query layer's default rendering with a driver-specific statement
		// appended after it -- proves the export is a real, usable value at
		// this package's own boundary, not just present on the module.
		const composedRendering: ContextRendering = (context) => [
			...defaultContextRendering(context),
			{ sql: "select 'pg-specific pin'", params: [], kind: "sql" },
		];
		const wrapped = {
			...driver,
			renderContext: composedRendering,
		};
		const handle = db({ items, itemsGrant }, wrapped);

		await handle.as({ role: roleName("app_role") }).execute(select(items));

		const texts = calls.map(sqlTextOf);
		expect(texts[2]).toBe('set local role "app_role"');
		expect(texts[3]).toBe("select 'pg-specific pin'");
		expect(texts[4]).toContain("items");
	});
});

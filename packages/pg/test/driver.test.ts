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

/** The SQL text a captured `client.query` call carries, whichever of the two {@link QueryCall} shapes it was sent as. */
const sqlTextOf = (call: QueryCall): string => {
	if (typeof call === "string") {
		return call;
	}
	return call.text;
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
 * A pool whose `connect` always hands back the *same* stub client
 * (simulating the pool reusing one physical connection across checkouts)
 * and records every call that client's own `query` received, in order.
 * Deliberately has no `query` method of its own -- if the driver ever
 * issued a statement through `pool.query` instead of the checked-out
 * client, that call would throw (not silently succeed against the wrong
 * connection), catching a session-binding regression decisively rather
 * than by inspection.
 */
const stubPoolWithClient = (): {
	readonly pool: Pool;
	readonly release: ReturnType<typeof vi.fn>;
	readonly calls: Array<QueryCall>;
} => {
	const calls: Array<QueryCall> = [];
	const release = vi.fn();
	const client = {
		query: vi.fn(async (call: QueryCall) => {
			calls.push(call);
			return { rows: [] };
		}),
		release,
	};
	const pool = {
		connect: vi.fn(async () => client),
	} as unknown as Pool;
	return { pool, release, calls };
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

		// oid 1186 (interval): raw Postgres text, never pg's own
		// PostgresInterval object -- 5.0 scout proved that object can't
		// round-trip back to text (String() -> "[object Object]",
		// .toPostgres() reorders/reformats fields).
		const intervalRaw = "1 year 2 mons 3 days 04:05:06.789012";
		expect(config.types.getTypeParser(1186, "text")(intervalRaw)).toBe(
			intervalRaw,
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
});

describe("pgDriver transaction (task 5.4)", () => {
	it("runs a transaction's statements through one held client and commits on success", async () => {
		const { pool, release, calls } = stubPoolWithClient();
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
			"set intervalstyle to 'postgres'",
			"BEGIN",
			"select 1",
			"COMMIT",
		]);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("rolls back and rethrows the callback's own error, unchanged, when the callback throws", async () => {
		const { pool, release, calls } = stubPoolWithClient();
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
			"set intervalstyle to 'postgres'",
			"BEGIN",
			"ROLLBACK",
		]);
		expect(release).toHaveBeenCalledTimes(1);
		// contrast pair with the ROLLBACK-itself-fails case below: an
		// ordinary successful rollback returns the client to the pool
		// normally (no truthy argument), never discards it.
		expect(release).toHaveBeenCalledWith();
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
		const release = vi.fn();
		const rollbackError = new Error("connection reset");
		const client = {
			query: vi.fn(async (call: QueryCall) => {
				if (sqlTextOf(call) === "ROLLBACK") {
					throw rollbackError;
				}
				return { rows: [] };
			}),
			release,
		};
		const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
		const driver = pgDriver(pool);
		const originalError = new Error("callback boom");

		// the caller sees exactly the callback's own error -- never the
		// ROLLBACK failure, never a wrapper, never a new field carrying it
		// (owner ruling: zero new contract surface).
		await expect(
			driver.transaction(async () => {
				throw originalError;
			}),
		).rejects.toBe(originalError);

		// exactly one release() call (pg-pool's own _releaseOnce throws on
		// a second call -- this is what a double-release mutation trips),
		// and it discards the connection (release(true), the boolean
		// shorthand pg-pool's _release treats identically to an Error)
		// rather than returning a possibly-broken session to the pool.
		expect(release).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalledWith(true);
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
			"set intervalstyle to 'postgres'",
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
			"set intervalstyle to 'postgres'",
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
			"set intervalstyle to 'postgres'",
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
			"set intervalstyle to 'postgres'",
			"select 1",
			"BEGIN",
			"select 2",
			"COMMIT",
		]);
	});
});

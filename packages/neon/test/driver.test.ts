import { schema, select, table, uuid } from "@hejbro/core";
import { db } from "@hejbro/query";
import type { Pool as NeonPool } from "@neondatabase/serverless";
import { neon, Pool } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { neonDriver } from "../src/driver";
import { buildHttpDriver, type HttpQueryable } from "../src/http";
import { anonymousRole, authenticatedRole } from "../src/roles";
import { intervalPassthroughTypes } from "../src/type-overrides";

/** What `driver.ts`'s own `makeSession` actually sends a queryable -- a bare `"BEGIN"`/`"COMMIT"`/`"ROLLBACK"` string, or the structured `{text, values, types}` config every compiled statement goes through. Typed narrowly to exactly the shapes the driver constructs. */
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

const sqlTextOf = (call: QueryCall): string => {
	if (typeof call === "string") {
		return call;
	}
	return call.text;
};

/** A `HttpQueryable`-shaped stub (never actually called by the WS tests below -- present only so `neonDriver`'s overload has a value to fix its capabilities against). */
const HTTP_CONNECTION_STRING = "postgres://user:pass@ep-test.neon.tech/main";

/**
 * A pool whose `connect` always hands back the *same* stub client and
 * records every call that client's own `query` received, in order --
 * mirrors `@hejbro/pg`'s own `stubPoolWithClient` (`packages/pg/test/
 * driver.test.ts`, read-only reference). Deliberately has no `query`
 * method of its own -- a statement sent through `pool.query` instead of
 * the checked-out client would throw, not silently succeed against the
 * wrong connection.
 */
const stubPoolWithClient = (
	failWhen?: (call: QueryCall) => Error | undefined,
): {
	readonly pool: NeonPool;
	readonly calls: Array<QueryCall>;
	readonly releaseCalls: Array<ReadonlyArray<unknown>>;
} => {
	const calls: Array<QueryCall> = [];
	const releaseCalls: Array<ReadonlyArray<unknown>> = [];
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
		release: vi.fn((...args: ReadonlyArray<unknown>) => {
			releaseCalls.push(args);
		}),
	};
	const pool = {
		connect: vi.fn(async () => client),
	} as unknown as NeonPool;
	return { pool, calls, releaseCalls };
};

describe("neonDriver -- the overload fixes the capability set (task 3.1)", () => {
	it("a Pool argument declares interactive-transactions and session-state true", () => {
		const pool = new Pool({
			connectionString: "postgres://localhost/does-not-need-to-connect",
		});
		const driver = neonDriver(pool);
		expect(driver.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": true,
		});
	});

	it("a neon() query function declares both capabilities false", () => {
		const sql = neon(HTTP_CONNECTION_STRING);
		const driver = neonDriver(sql);
		expect(driver.capabilities).toEqual({
			"interactive-transactions": false,
			"session-state": false,
		});
	});

	it("the path is fixed by the client, not by a runtime probe -- capabilities are readable with zero connection attempts", () => {
		const pool = new Pool({
			connectionString: "postgres://localhost/does-not-need-to-connect",
		});
		const connectSpy = vi.spyOn(pool, "connect");

		const driver = neonDriver(pool);

		// The overload's own dispatch (typeof client === "function") never
		// touches the pool -- capabilities are already final the instant
		// neonDriver() returns, synchronously, before any statement or
		// connection attempt of any kind.
		expect(driver.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": true,
		});
		expect(connectSpy).not.toHaveBeenCalled();
	});
});

describe("neonDriver(pool) execute (task 3.2)", () => {
	it("executes a compiled statement over the pool and returns its rows", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = neonDriver(pool);

		await driver.execute({
			sql: "select id from widgets where id = $1",
			params: [7],
			kind: "sql",
		});

		const config = calls
			.filter((call): call is CapturedQueryConfig => typeof call !== "string")
			.find((call) => call.text === "select id from widgets where id = $1");
		if (config === undefined) {
			throw new Error("the caller's own statement was never sent");
		}
		expect(config.values).toEqual([7]);
	});

	it("releases the checked-out client after execute", async () => {
		const { pool, releaseCalls } = stubPoolWithClient();
		const driver = neonDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(releaseCalls).toHaveLength(1);
	});
});

describe("neonDriver(pool) transaction (task 3.3)", () => {
	it("runs a transaction's statements through one held client and commits on success", async () => {
		const { pool, calls, releaseCalls } = stubPoolWithClient();
		const driver = neonDriver(pool);

		const result = await driver.transaction(async (session) => {
			await session.execute({ sql: "select 1", params: [], kind: "sql" });
			return "done";
		});

		expect(result).toBe("done");
		expect(pool.connect).toHaveBeenCalledTimes(1);
		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"BEGIN",
			"select 1",
			"COMMIT",
		]);
		expect(releaseCalls).toHaveLength(1);
	});

	it("rolls back and rethrows the callback's own error, unchanged, when the callback throws", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = neonDriver(pool);
		const originalError = new Error("callback boom");

		await expect(
			driver.transaction(async () => {
				throw originalError;
			}),
		).rejects.toBe(originalError);

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"BEGIN",
			"ROLLBACK",
		]);
	});
});

describe("neonDriver(pool) setupSession pin and capability (task 3.4)", () => {
	it("pins the session at checkout and declares both capabilities", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = neonDriver(pool);

		expect(driver.capabilities).toEqual({
			"interactive-transactions": true,
			"session-state": true,
		});

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 1",
		]);
	});

	it("pins once per checkout, not once per statement, on the same client", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = neonDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });
		await driver.execute({ sql: "select 2", params: [], kind: "sql" });

		expect(calls.map(sqlTextOf)).toEqual([
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
			"select 1",
			"select 2",
		]);
	});
});

describe("neonDriver(pool) contributedRoles (task 3.5)", () => {
	it("contributes Neon's two Data API roles", () => {
		const pool = new Pool({
			connectionString: "postgres://localhost/does-not-need-to-connect",
		});
		const driver = neonDriver(pool);

		expect(driver.contributedRoles).toEqual([authenticatedRole, anonymousRole]);
	});
});

describe("neonDriver(pool) execute + interval types override (task 3.6)", () => {
	it("sends the raw-text type override with every query", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = neonDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		const config = calls
			.filter((call): call is CapturedQueryConfig => typeof call !== "string")
			.find((call) => call.text === "select 1");
		if (config === undefined) {
			throw new Error("the caller's own statement was never sent");
		}

		// oid 1186 (interval): raw text, never a parsed object.
		const intervalFixture = "1 year 2 mons 3 days 04:05:06.789012";
		expect(config.types.getTypeParser(1186, "text")(intervalFixture)).toBe(
			intervalFixture,
		);
		// oid 1187 (interval[]): raw array-literal text.
		const intervalArrayRaw = '{"1 day","2 days 03:00:00"}';
		expect(config.types.getTypeParser(1187, "text")(intervalArrayRaw)).toBe(
			intervalArrayRaw,
		);
		// oid 1231 (numeric[]): raw array-literal text, not already-parsed
		// numbers -- the axis a "drop 1231 from the oid list" mutant lives
		// on. Asserted independently of 1186/1187 so removing only this
		// entry from the override's oid set cannot pass unnoticed.
		const numericArrayRaw = "{123.450000,0.100000}";
		expect(config.types.getTypeParser(1231, "text")(numericArrayRaw)).toBe(
			numericArrayRaw,
		);
		// oid 23 (int4): still delegated to the client's own default --
		// without this axis, an override that answers every oid with
		// identity (breaking delegation entirely) would still pass the
		// three assertions above alone.
		expect(config.types.getTypeParser(23, "text")("42")).toBe(42);
	});
});

describe("both connection paths use the same type-overrides module (task 6.4)", () => {
	it("both drivers send the same override object", async () => {
		const { pool, calls } = stubPoolWithClient();
		const wsDriver = neonDriver(pool);
		await wsDriver.execute({ sql: "select 1", params: [], kind: "sql" });
		const wsConfig = calls
			.filter((call): call is CapturedQueryConfig => typeof call !== "string")
			.find((call) => call.text === "select 1");
		if (wsConfig === undefined) {
			throw new Error("the WS path's caller statement was never sent");
		}
		// Reference identity (toBe, not toEqual): both drivers must hand
		// the query the exact same module-level object, not two literals
		// that merely look alike -- the only way "done means the oid set
		// is still pinned afterwards" (tasks.md 6.4) survives a future
		// refactor that only checks sameness, never content.
		expect(wsConfig.types).toBe(intervalPassthroughTypes);

		const queryTypesSeen: Array<unknown> = [];
		const fakeSql = Object.assign(
			() => {
				throw new Error("tagged-template form not used by this driver");
			},
			{
				query: vi.fn(
					(_text: string, _params: unknown[], opts?: { types?: unknown }) => {
						queryTypesSeen.push(opts?.types);
						return { queryData: { query: _text, params: _params }, opts };
					},
				),
				transaction: vi.fn(async (members: ReadonlyArray<unknown>) =>
					members.map(() => []),
				),
			},
		) as unknown as HttpQueryable;
		const httpDriver = buildHttpDriver(fakeSql);
		await httpDriver.execute({ sql: "select 1", params: [], kind: "sql" });

		const httpConfigTypes = queryTypesSeen.at(-1);
		expect(httpConfigTypes).toBe(intervalPassthroughTypes);
		// Both paths resolve to the exact same object as each other, not
		// just each equal to the imported constant by coincidence.
		expect(httpConfigTypes).toBe(wsConfig.types);
	});
});

describe("neonDriver(pool) + db.as(context) baseline pin, session path (task 4.3, #557 -- fixed before the context-application generalization lands, so a later change that moves this is caught here)", () => {
	it("sends the pin, then the context statements, then the caller's statement, all inside one transaction -- the setting travels as a bind parameter", async () => {
		const { pool, calls } = stubPoolWithClient();
		const driver = neonDriver(pool);
		const app = schema("app");
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		const handle = db({ widgets }, driver);

		await handle
			.as({ role: authenticatedRole, settings: { "app.claim": "value" } })
			.execute(select(widgets));

		const texts = calls.map(sqlTextOf);
		expect(texts).toHaveLength(6);
		expect(texts[0]).toBe(
			"set intervalstyle to 'postgres'; set bytea_output to 'hex'",
		);
		expect(texts[1]).toBe("BEGIN");
		// role first, then one set_config per setting, ahead of the
		// caller's own statement -- driver.contributedRoles already unlocks
		// authenticatedRole with no grant/RLS in the schema (task 3.5).
		expect(texts[2]).toBe('set local role "authenticated"');
		expect(texts[3]).toBe("select set_config($1, $2, true)");
		expect(texts[4]).toContain("widgets");
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

describe("buildHttpDriver + db.as(context) still refused with missing-capability (task 4.3, #557 -- the boundary this change must not move: a context-rendering contribution point existing on the contract does not widen who may run a context)", () => {
	it("db.as(context) on the HTTP driver fails with the same missing-capability error it failed with before, and never sends a request", async () => {
		const sentBatches: Array<unknown> = [];
		const fakeSql = Object.assign(
			() => {
				throw new Error("tagged-template form not used by this driver");
			},
			{
				query: vi.fn(() => {
					sentBatches.push("query");
					return { queryData: {} };
				}),
				transaction: vi.fn(async (members: ReadonlyArray<unknown>) => {
					sentBatches.push(members);
					return members.map(() => []);
				}),
			},
		) as unknown as HttpQueryable;
		const driver = buildHttpDriver(fakeSql);
		const app = schema("app");
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		// `buildHttpDriver` is called directly here (bypassing `neonDriver`'s
		// own WS-only `contributedRoles`, mirroring this file's existing
		// "task 6.4" test above), so the role is declared explicitly through
		// `db()`'s own `roles` option instead -- the point under test is the
		// capability gate, not the role whitelist.
		const handle = db({ widgets }, driver, { roles: [authenticatedRole] });

		await expect(
			handle.as({ role: authenticatedRole }).execute(select(widgets)),
		).rejects.toMatchObject({
			code: "driver-missing-capability",
			capability: "interactive-transactions",
			// pins which layer actually refused (review round 1, F-adjacent
			// recommendation): the HTTP driver's own transaction() throws
			// this exact same code/capability unconditionally too (its own
			// hardcoded defense), so those two fields alone can't tell the
			// query layer's own gate apart from the driver's redundant one.
			// `operation` only ever comes from the query layer's own
			// assertCapability call site (context.ts's `scopedRun("db.as",
			// ...)`) -- the driver's own throwMissingCapability call names
			// "transaction" instead (see http-session.test.ts).
			operation: "db.as",
		});

		// nothing reached the fake sql client at all -- the query layer's
		// own capability gate (assertCapability, called before the
		// resolver/context is ever touched) refuses this before the
		// driver's own transaction/query members are invoked.
		expect(sentBatches).toHaveLength(0);
	});
});

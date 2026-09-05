import { roleName, schema, select, table, uuid } from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import { db, throwMissingCapability } from "@hejbro/query";
import { assertSessionStateConformance } from "@hejbro/query/testing/driver-conformance";
import { neon, neonConfig } from "@neondatabase/serverless";
import { afterEach, describe, expect, it } from "vitest";
import { buildHttpDriver } from "../src/http";

/** A connection string shaped well enough for `neon()`'s own URL parser -- never dialed, every test below stubs the transport. */
const CONNECTION_STRING = "postgres://user:pass@ep-test.neon.tech/main";

/** One captured `fetchFunction` call: the URL and the parsed JSON body Neon's client actually sent. */
type CapturedRequest = {
	readonly url: string;
	readonly body: {
		readonly queries: ReadonlyArray<{
			query: string;
			params: ReadonlyArray<unknown>;
		}>;
	};
};

/** A `{fields, rows}` result shaped exactly like Neon's own HTTP response entry -- `Neon-Array-Mode: true` (the client always sets it) means every row arrives as an array of raw text values, one per field, matched by position. */
type StubResult = {
	readonly fields: ReadonlyArray<{
		readonly name: string;
		readonly dataTypeID: number;
	}>;
	readonly rows: ReadonlyArray<ReadonlyArray<string | null>>;
};

const EMPTY_RESULT: StubResult = { fields: [], rows: [] };

/** Postgres's builtin `text` oid -- the default type parser for it is the identity function, so a stub result can use it without needing to know any other oid's parsing rule. */
const TEXT_OID = 25;

/** The three oids `intervalPassthroughTypes` forces to raw text (mirrors `@hejbro/pg`'s own list) -- `interval`, `interval[]`, `numeric[]`. Without a test that sends one of these, the override's own `if` branch never runs and only its fallback path is covered. */
const INTERVAL_OID = 1186;
const INTERVAL_ARRAY_OID = 1187;
const NUMERIC_ARRAY_OID = 1231;

/**
 * Sets `neonConfig.fetchFunction` (global, per the client's own API --
 * there is no per-call override) to a stub that records every call and
 * answers with `results`, then returns the array `push`ed into on each
 * call -- so a test can assert both what was sent and how many requests
 * it cost. Reset by the shared `afterEach` below; every test in this
 * file goes through this one helper so a forgotten reset never leaks
 * into the next test.
 */
const stubSuccess = (
	results: ReadonlyArray<StubResult>,
): ReadonlyArray<CapturedRequest> => {
	const calls: Array<CapturedRequest> = [];
	neonConfig.fetchFunction = async (url: string, init: { body: string }) => {
		calls.push({ url, body: JSON.parse(init.body) });
		return {
			ok: true,
			json: async () => ({ results }),
		};
	};
	return calls;
};

/** Same shape as {@link stubSuccess}, but the server answers with a non-2xx status -- the client's own error-surfacing path (`Server error (HTTP status ...)`), never caught or rewritten by this driver. */
const stubServerError = (status: number, text: string): void => {
	neonConfig.fetchFunction = async () => ({
		ok: false,
		status,
		text: async () => text,
	});
};

afterEach(() => {
	neonConfig.fetchFunction = undefined;
});

describe("HTTP session batch", () => {
	it("sends both pins and the caller's statement as one batch and returns the last result", async () => {
		const calls = stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{
				fields: [{ name: "greeting", dataTypeID: TEXT_OID }],
				rows: [["hello"]],
			},
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		const rows = await driver.execute({
			sql: "select $1 as greeting",
			params: ["hello"],
			kind: "sql",
		});

		expect(rows).toEqual([{ greeting: "hello" }]);
		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call).toBeDefined();
		expect(call?.body.queries).toEqual([
			{ query: "set intervalstyle to 'postgres'", params: [] },
			{ query: "set bytea_output to 'hex'", params: [] },
			{ query: "select $1 as greeting", params: ["hello"] },
		]);
	});

	it("returns only the caller's rows from a pinned batch", async () => {
		stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{
				fields: [{ name: "id", dataTypeID: TEXT_OID }],
				rows: [["1"], ["2"]],
			},
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		const rows = await driver.execute({
			sql: "select id from widgets",
			params: [],
			kind: "sql",
		});

		expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
	});

	it("keeps interval and numeric[]/interval[] arrivals as raw text, and leaves every other oid to the client's own default parser", async () => {
		stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{
				fields: [
					{ name: "iv", dataTypeID: INTERVAL_OID },
					{ name: "ivs", dataTypeID: INTERVAL_ARRAY_OID },
					{ name: "nums", dataTypeID: NUMERIC_ARRAY_OID },
					{ name: "greeting", dataTypeID: TEXT_OID },
				],
				rows: [["1 day 02:00:00", "{1 day,2 days}", "{1.50,2.00}", "hello"]],
			},
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		const rows = await driver.execute({
			sql: "select iv, ivs, nums, greeting from widgets",
			params: [],
			kind: "sql",
		});

		expect(rows).toEqual([
			{
				iv: "1 day 02:00:00",
				ivs: "{1 day,2 days}",
				nums: "{1.50,2.00}",
				greeting: "hello",
			},
		]);
	});

	it("declares interactive-transactions/session-state/prepared-statements false and batched-transactions true, before any connection", () => {
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		expect(driver.capabilities).toEqual({
			"interactive-transactions": false,
			"session-state": false,
			"prepared-statements": false,
			"batched-transactions": true,
		});
	});

	it("the one-shot driver's refusal is the query layer's own error (#490)", async () => {
		const calls = stubSuccess([EMPTY_RESULT]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		// Calls the exported thrower with the exact arguments the driver's
		// own `transaction` member is expected to use, so the assertion
		// below is pinned to `@hejbro/query`'s current wording rather than
		// to a literal copy that could silently drift from it.
		const expected = (() => {
			try {
				throwMissingCapability("interactive-transactions", "transaction");
			} catch (error) {
				return error as {
					code: string;
					capability: string;
					operation: string;
					message: string;
				};
			}
		})();

		await expect(
			driver.transaction(async (session) =>
				session.execute({ sql: "select 1", params: [], kind: "sql" }),
			),
		).rejects.toMatchObject({
			code: expected.code,
			capability: expected.capability,
			operation: expected.operation,
			message: expected.message,
		});
		expect(calls).toHaveLength(0);
	});

	it("setupSession resolves and sends no request", async () => {
		const calls = stubSuccess([EMPTY_RESULT]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);
		// The contract calls this with the connection's own session; the
		// HTTP path has none to pin, so the argument is never touched --
		// any object matching the shape is enough to prove that.
		const unusedSession: DriverSession = {
			execute: async () => {
				throw new Error("setupSession must never call execute");
			},
		};

		await expect(driver.setupSession(unusedSession)).resolves.toBeUndefined();
		expect(calls).toHaveLength(0);
	});

	it("surfaces the database error from a failed batch", async () => {
		stubServerError(500, "connection to database failed");
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		await expect(
			driver.execute({ sql: "select 1", params: [], kind: "sql" }),
		).rejects.toThrow(/connection to database failed/);
	});
});

describe("Driver.batch (task 1.2b, #486)", () => {
	it("sends the pins, then every member, in the order given -- one request", async () => {
		const calls = stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{ fields: [{ name: "a", dataTypeID: TEXT_OID }], rows: [["1"]] },
			{ fields: [{ name: "b", dataTypeID: TEXT_OID }], rows: [["2"]] },
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		await driver.batch([
			{ sql: "select $1 as a", params: [1], kind: "sql" },
			{ sql: "select $1 as b", params: [2], kind: "sql" },
		]);

		expect(calls).toHaveLength(1);
		// the client's own `prepareValue` stringifies non-object params
		// before they hit the wire (measured: same as `neon-session.test.ts`'s
		// own existing "hello" case, just visible here on numbers too).
		expect(calls[0]?.body.queries).toEqual([
			{ query: "set intervalstyle to 'postgres'", params: [] },
			{ query: "set bytea_output to 'hex'", params: [] },
			{ query: "select $1 as a", params: ["1"] },
			{ query: "select $1 as b", params: ["2"] },
		]);
	});

	it("returns one row list per member, in order -- the pins' own two results are sliced off, never mistaken for a member's own", async () => {
		stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{ fields: [{ name: "a", dataTypeID: TEXT_OID }], rows: [["1"]] },
			{ fields: [{ name: "b", dataTypeID: TEXT_OID }], rows: [["2"], ["3"]] },
			{ fields: [{ name: "c", dataTypeID: TEXT_OID }], rows: [] },
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		const results = await driver.batch([
			{ sql: "select $1 as a", params: [1], kind: "sql" },
			{ sql: "select id as b from widgets", params: [], kind: "sql" },
			{ sql: "select 1 as c where false", params: [], kind: "sql" },
		]);

		expect(results).toHaveLength(3);
		expect(results[0]).toEqual([{ a: "1" }]);
		expect(results[1]).toEqual([{ b: "2" }, { b: "3" }]);
		expect(results[2]).toEqual([]);
	});

	it("keeps interval/numeric[]/interval[] arrivals as raw text on every member, the same override execute uses", async () => {
		stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{
				fields: [{ name: "iv", dataTypeID: INTERVAL_OID }],
				rows: [["1 day 02:00:00"]],
			},
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		const results = await driver.batch([
			{ sql: "select iv from widgets", params: [], kind: "sql" },
		]);

		expect(results[0]).toEqual([{ iv: "1 day 02:00:00" }]);
	});

	it("a failing member rejects the whole call -- no partial result, no member index (the batch is one transaction, one HTTP request)", async () => {
		stubServerError(500, "duplicate key value");
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		await expect(
			driver.batch([
				{ sql: "select 1 as a", params: [], kind: "sql" },
				{ sql: "insert into widgets values ($1)", params: [1], kind: "sql" },
				{ sql: "select 1 as c", params: [], kind: "sql" },
			]),
		).rejects.toThrow(/duplicate key value/);
	});

	it("batch([]) sends nothing over the wire and resolves to an empty array -- zero statements means zero requests, not a pins-only round trip", async () => {
		const calls = stubSuccess([]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		const results = await driver.batch([]);

		expect(results).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("execute is batch of one, reusing the exact same pin/slice logic -- proven by the driver-contract conformance suite below sharing this same recorded transcript", async () => {
		const calls = stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{ fields: [{ name: "greeting", dataTypeID: TEXT_OID }], rows: [["hi"]] },
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		const rows = await driver.execute({
			sql: "select $1 as greeting",
			params: ["hi"],
			kind: "sql",
		});

		expect(rows).toEqual([{ greeting: "hi" }]);
		expect(calls).toHaveLength(1);
	});
});

describe("db.as(context) runs on the HTTP driver as one batch (task 1.2b, design.md Q5)", () => {
	it("sends the driver's own pins, then the context's own statements, then the caller's statement, all as one request", async () => {
		const calls = stubSuccess([
			EMPTY_RESULT, // intervalstyle pin
			EMPTY_RESULT, // bytea_output pin
			EMPTY_RESULT, // set local role
			{ fields: [{ name: "id", dataTypeID: TEXT_OID }], rows: [["1"]] }, // caller statement
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);
		const appSchema = schema("app");
		const widgets = table(appSchema, "widgets", { id: uuid().primaryKey() });
		const handle = db({ widgets }, driver, {
			roles: [roleName("app_reader")],
		});

		const rows = await handle
			.as({ role: roleName("app_reader") })
			.execute(select(widgets));

		expect(rows).toEqual([{ id: "1" }]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.body.queries.map((q) => q.query)).toEqual([
			"set intervalstyle to 'postgres'",
			"set bytea_output to 'hex'",
			'set local role "app_reader"',
			expect.stringContaining("widgets"),
		]);
	});
});

describe("buildHttpDriver conforms to the driver contract (#481, task 1.7)", () => {
	it("conforms to the driver contract", async () => {
		// session-state:false (task 2.3, D95/D96): the obligation is that
		// the pins ride with every execution -- captured the same way this
		// file's own "sends both pins and the caller's statement as one
		// batch" test above already does, via the HTTP batch this driver
		// actually sent.
		const calls = stubSuccess([
			EMPTY_RESULT,
			EMPTY_RESULT,
			{
				fields: [{ name: "greeting", dataTypeID: TEXT_OID }],
				rows: [["hello"]],
			},
		]);
		const sql = neon(CONNECTION_STRING);
		const driver = buildHttpDriver(sql);

		await driver.execute({
			sql: "select $1 as greeting",
			params: ["hello"],
			kind: "sql",
		});

		const [call] = calls;
		expect(call).toBeDefined();
		const recorded = (call?.body.queries ?? []).map((q) => ({
			sql: q.query,
			params: q.params,
		}));

		expect(() =>
			assertSessionStateConformance(driver.capabilities, {
				recordedForOneExecute: recorded,
				callerStatement: { sql: "select $1 as greeting", params: ["hello"] },
			}),
		).not.toThrow();
	});
});

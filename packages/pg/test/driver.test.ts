import { Pool, types as pgTypes } from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgDriver } from "../src/driver";

/**
 * What `pgDriver`'s `execute` actually sends to a node-postgres pool --
 * `text`/`values` plus the per-query `types` override (owner decision
 * ③). Typed narrowly to exactly the shape the driver constructs, so the
 * stub below never needs a full `pg` `QueryConfig`.
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

/** A stub `Pool` whose `query` records every config it was handed, never touching a real connection. */
const recordingPool = (): {
	readonly pool: Pool;
	readonly received: Array<CapturedQueryConfig>;
} => {
	const received: Array<CapturedQueryConfig> = [];
	const pool = {
		query: vi.fn(async (config: CapturedQueryConfig) => {
			received.push(config);
			return { rows: [] };
		}),
	} as unknown as Pool;
	return { pool, received };
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
		// spies out the network entirely -- this proves execute() itself
		// never calls end(), independent of whether a real database is
		// reachable.
		vi.spyOn(driver.client, "query").mockResolvedValue({
			rows: [],
		} as never);
		const endSpy = vi.spyOn(driver.client, "end");

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(endSpy).not.toHaveBeenCalled();
	});
});

describe("pgDriver execute + interval types override (owner decision ③, task 5.3)", () => {
	it("interval reaches the row as Postgres text while other types keep pg defaults", async () => {
		const { pool, received } = recordingPool();
		const driver = pgDriver(pool);

		await driver.execute({ sql: "select 1", params: [], kind: "sql" });

		const config = received.at(0);
		if (config === undefined) {
			throw new Error("pool.query was never called");
		}
		expect(config.text).toBe("select 1");
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

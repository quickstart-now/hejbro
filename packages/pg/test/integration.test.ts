import { execFileSync } from "node:child_process";
import {
	bigint,
	insert,
	interval,
	numeric,
	schema,
	select,
	serializeInterval,
	table,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { db } from "@hejbro/query";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgDriver } from "../src/driver";

/**
 * Docker-gated integration harness (owner decision ⑤, task 5.6, extended
 * by task 1.5/B2/#320, seed flipped to the typed builder by #341) --
 * proves the declared arrival shapes (bigint mode, numeric mode,
 * `IntervalValue`, `Date`, and their element-wise array counterparts)
 * round-trip through a *real* `db()` handle against a real postgres:17,
 * not a stub. Never runs under the default `pnpm test`/CI (wired via
 * `vitest.integration.config.ts` + task 5.1's exclude patterns) --
 * local-only, `pnpm --filter @hejbro/pg test:integration`.
 *
 * Task 1.5 closed the array gaps this harness used to exclude, and along
 * the way found a real one: pg's own default array parser for `numeric[]`
 * (oid 1231) returns an array of already-`parseFloat`'d JS numbers, not
 * text (unlike scalar `numeric`, oid 1700, which pg already leaves as raw
 * text) -- exactly the silent precision loss this whole change fights
 * elsewhere. Task B2.1/B2.2 closed that gap with a driver-level oid 1231
 * override (mirroring interval[]'s own oid 1187 override) plus a matching
 * `convert.ts` branch, so `numeric({mode:'string'}).array()` now round-
 * trips exact decimal text too -- proved below (`precisions`), alongside
 * `bigint({mode:'number'}).array()` (`amounts`, pg's own default array
 * parser already returns text elements for oid 1016, no override needed)
 * and `interval[]` (`durations`, oid 1187). `approx` keeps a `mode:
 * 'number'` numeric array witness too -- that mode's own contract only
 * promises exactness within `Number.MAX_SAFE_INTEGER`, so pg's own float
 * parse ahead of ours costs nothing further there.
 *
 * #341: rows are seeded through the typed `insert()` builder -- the raw
 * parameterized seed this replaced cited a `MutationValue` gap the
 * write-side lift (#345) dissolved. Seeding through the builder makes
 * this file the real-server proof of the *write* path too: what
 * postgres:17 accepts here is core's own serialization --
 * `serializeInterval`'s always-full interval text (positive, negative,
 * and mixed-sign-across-axes forms) and `serializeArrayLiteral`'s
 * canonical `{...}` literal text, each travelling as a bind parameter.
 * The test closes by capturing the server's *own* output text raw and
 * asserting the exact strings -- the repository's first recorded samples
 * of Postgres's actual output grammar (every earlier anchor was a
 * hand-written fixture; `driver.test.ts` now names its own as such).
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17";
const CONTAINER = `hejbro-pg-integration-${process.pid}`;

/** `true` iff a Docker daemon actually answers -- checked once, in `beforeAll`, so a missing daemon fails the whole suite loudly with the same guidance `scripts/roundtrip.sh`'s own skill doc gives, rather than a cryptic connection error from the first real docker/pg call. */
const dockerAvailable = (): boolean => {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

/** Blocks the process for `seconds` -- shells out to `sleep` rather than an async timer, since container-readiness polling here is deliberately synchronous (matches `scripts/roundtrip.sh`'s own imperative `until … ; do sleep 1; done` shape, translated to Node). */
const sleepSync = (seconds: number): void => {
	execFileSync("sleep", [String(seconds)]);
};

/** Polls `pg_isready` inside `CONTAINER` until Postgres accepts connections, or throws after `maxAttempts` (a real, if rare, way this harness can hang otherwise). */
const waitUntilReady = (maxAttempts = 30): void => {
	const isReady = (): boolean => {
		try {
			execFileSync(
				"docker",
				["exec", CONTAINER, "pg_isready", "-U", "postgres", "-q"],
				{ stdio: "ignore" },
			);
			return true;
		} catch {
			return false;
		}
	};
	const attempt = (remaining: number): void => {
		if (isReady()) {
			return;
		}
		if (remaining <= 0) {
			throw new Error(
				`postgres in container "${CONTAINER}" never became ready. Next: check \`docker logs ${CONTAINER}\`.`,
			);
		}
		sleepSync(1);
		attempt(remaining - 1);
	};
	attempt(maxAttempts);
};

/** The host port Docker mapped container port 5432 to (`-P`, a random free host port -- never a fixed one, so a leftover container from a crashed prior run can't collide with this one). */
const discoverHostPort = (): number => {
	const output = execFileSync("docker", ["port", CONTAINER, "5432/tcp"], {
		encoding: "utf8",
	});
	// `docker port` prints one line per bound address family (IPv4, then
	// IPv6) -- only the first line is used; both map to the same host
	// port, so which one is irrelevant, but slicing the *whole* output
	// instead of just this line was the actual bug an early run of this
	// test caught (`Number("32770\n[::]:32770")` is `NaN`, not the port).
	const firstLine = output.trim().split("\n")[0];
	const lastColon = firstLine?.lastIndexOf(":");
	if (firstLine === undefined || lastColon === undefined || lastColon === -1) {
		throw new Error(
			`could not parse the host port docker mapped for container "${CONTAINER}" from: ${JSON.stringify(output)}`,
		);
	}
	return Number(firstLine.slice(lastColon + 1));
};

const testSchema = schema("g5_integration");
const roundtrip = table(testSchema, "roundtrip", {
	id: uuid().primaryKey(),
	amount: bigint().notNull(),
	precise: numeric({ mode: "string" }).notNull(),
	duration: interval().notNull(),
	created: timestamptz().notNull(),
	// task 1.5/B2/#320: element-wise array conversion, proved against a
	// real database rather than only the recorded-driver unit tests
	// (1.1/1.2/B2.2). `precisions` is `mode: 'string'` -- exact decimal
	// text, lossless even beyond `Number.MAX_SAFE_INTEGER` (task B2.1's
	// oid 1231 driver override is what makes this provable at all; see
	// this file's own top comment). `approx` is the separate `mode:
	// 'number'` witness -- that mode's own contract only ever promised
	// exactness within `Number.MAX_SAFE_INTEGER`, so it stays green under
	// the same B2.1 override.
	amounts: bigint({ mode: "number" }).array().notNull(),
	precisions: numeric({ mode: "string" }).array().notNull(),
	approx: numeric({ mode: "number" }).array().notNull(),
	durations: interval().array().notNull(),
});

describe("pgDriver + a real db() handle against postgres:17 (owner decision ⑤, task 5.6)", () => {
	const pool: { current: Pool | undefined } = { current: undefined };
	// tracks whether `docker run` actually succeeded -- `afterAll` must
	// not attempt `docker rm` for a container that was never started
	// (the Docker-absent case above), which would otherwise mask the
	// real, guided failure with a second, confusing "docker rm failed".
	const containerStarted: { current: boolean } = { current: false };

	beforeAll(() => {
		if (!dockerAvailable()) {
			throw new Error(
				"packages/pg's integration suite needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter @hejbro/pg test:integration`.",
			);
		}
		execFileSync("docker", [
			"run",
			"-d",
			"--name",
			CONTAINER,
			"-e",
			"POSTGRES_PASSWORD=postgres",
			"-P",
			IMAGE,
		]);
		containerStarted.current = true;
		waitUntilReady();
		const port = discoverHostPort();
		pool.current = new Pool({
			host: "localhost",
			port,
			user: "postgres",
			password: "postgres",
			database: "postgres",
		});
	}, 60_000);

	afterAll(async () => {
		await pool.current?.end();
		if (containerStarted.current) {
			execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
		}
	});

	it("typed insert() and select round-trip rows on a real database, and the server's raw output grammar is captured", async () => {
		const activePool = pool.current;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const driver = pgDriver(activePool);

		// schema/table setup is raw DDL through the driver directly, not
		// through db() -- creating tables is the CLI/migration generator's
		// job (out of this group's scope entirely), never db()'s.
		await driver.execute({
			sql: "create schema g5_integration",
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: `create table g5_integration.roundtrip (
				id uuid primary key,
				amount bigint not null,
				precise numeric not null,
				duration interval not null,
				created timestamptz not null,
				amounts bigint[] not null,
				precisions numeric[] not null,
				approx numeric[] not null,
				durations interval[] not null
			)`,
			params: [],
			kind: "sql",
		});

		const handle = db({ roundtrip }, driver);

		const insertedId = "11111111-1111-1111-1111-111111111111";
		const insertedDuration = {
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 789012,
		};
		const insertedCreated = "2020-06-15T12:30:00.000Z";
		const insertedAmountsArray = [123, 456, 789];
		// exact decimal text, including one value with more significant
		// digits than a JS double can hold exactly (`Number.MAX_SAFE_INTEGER`
		// is 2^53-1, 16 digits) -- this is the exact spot pg's default
		// `numeric[]` array parser used to silently zero out beyond the 9th
		// significant digit, before task B2.1's oid 1231 override.
		const insertedPreciseArray = [
			"123.450000",
			"170141183460469231731.687303715884105728",
		];
		const insertedApproxArray = [123.45, 0.5];
		const insertedDurationsArray = [
			{
				years: 0,
				months: 0,
				days: 1,
				hours: 0,
				minutes: 0,
				seconds: 0,
				microseconds: 0,
			},
			{
				years: 0,
				months: 0,
				days: 2,
				hours: 3,
				minutes: 0,
				seconds: 0,
				microseconds: 0,
			},
		];

		// #341 (b): negative and mixed-sign-across-axes forms -- year-month
		// and time axes negative, day axis positive, plus negative elements
		// inside an array literal. Postgres's three interval axes are
		// mutually independent, and no anchor before this row ever proved
		// the sign-carrying serializer forms against a real server (every
		// prior one was all-positive).
		const mixedSignId = "22222222-2222-2222-2222-222222222222";
		const mixedSignDuration = {
			years: -1,
			months: -2,
			days: 3,
			hours: 0,
			minutes: -5,
			seconds: 0,
			microseconds: 0,
		};
		const mixedSignDurationsArray = [
			{
				years: 0,
				months: 0,
				days: 0,
				hours: 0,
				minutes: -5,
				seconds: 0,
				microseconds: 0,
			},
			{
				years: 0,
				months: 0,
				days: -3,
				hours: 0,
				minutes: 0,
				seconds: 0,
				microseconds: 0,
			},
		];

		// #341 (a): the always-full text this insert actually sends, pinned
		// here so the raw capture at the end of this test records the exact
		// difference between hejbro's write form and the server's own print
		// form for the very same stored values.
		expect(serializeInterval(insertedDuration)).toBe(
			"1 years 2 mons 3 days 04:05:06.789012",
		);
		expect(serializeInterval(mixedSignDuration)).toBe(
			"-1 years -2 mons 3 days -00:05:00.000000",
		);

		// #341: seeded through the typed insert() builder -- the raw
		// parameterized seed this replaced cited a `MutationValue` gap the
		// write-side lift (#345) dissolved. What postgres:17 accepts here
		// is core's own serialization: `serializeInterval` text for the
		// interval columns, `serializeArrayLiteral`'s canonical `{...}`
		// literal text for every array column, `bigint` as decimal text.
		await handle.execute(
			insert(roundtrip).values([
				{
					id: insertedId,
					amount: 9007199254740993n,
					precise: "123.456000",
					duration: insertedDuration,
					created: new Date(insertedCreated),
					amounts: insertedAmountsArray,
					precisions: insertedPreciseArray,
					approx: insertedApproxArray,
					durations: insertedDurationsArray,
				},
				{
					id: mixedSignId,
					amount: -42n,
					precise: "-0.500000",
					duration: mixedSignDuration,
					created: new Date("1999-12-31T23:59:59.999Z"),
					amounts: [-1, 0, 42],
					precisions: ["-123.450000"],
					approx: [-0.5],
					durations: mixedSignDurationsArray,
				},
			]),
		);

		const rows = await handle.execute(select(roundtrip));

		expect(rows).toHaveLength(2);
		const row = rows.find((candidate) => candidate.id === insertedId);
		const mixedRow = rows.find((candidate) => candidate.id === mixedSignId);
		if (row === undefined || mixedRow === undefined) {
			throw new Error("select did not return both seeded rows");
		}

		// bigint mode (default 'bigint', task 3.4/4.4): a real bigint, not
		// a number that would have silently lost precision.
		expect(row.amount).toBe(9007199254740993n);
		expect(typeof row.amount).toBe("bigint");

		// numeric mode 'string': exact decimal text, never a float.
		expect(row.precise).toBe("123.456000");

		// IntervalValue (task 5.3's per-query override + task 5.5's
		// IntervalStyle pin, working together against a real connection --
		// without the pin, a non-'postgres' IntervalStyle default could
		// change the wire text pg-types would otherwise try to parse; the
		// override makes that moot by handing raw text straight through
		// regardless, but the pin is still what keeps the *other* declared
		// arrival shapes (dates, in particular) in the format this
		// pipeline assumes). The expected value is the seeded object
		// itself: with the seed typed (#341), write value = read value IS
		// the round-trip statement.
		expect(row.duration).toEqual(insertedDuration);

		// timestamptz -> a real Date, at the instant inserted.
		expect(row.created).toBeInstanceOf(Date);
		expect((row.created as Date).toISOString()).toBe(insertedCreated);

		// moded bigint array (task 1.2's "moded array" branch): pg's own
		// default array parser already hands back a JS array of numbers for
		// oid 1016 (_int8) -- no driver override needed for this axis, only
		// element-wise conversion against the declared mode.
		expect(row.amounts).toEqual([123, 456, 789]);

		// numeric array, mode 'string' (task B2.1/B2.2): exact decimal text
		// per element, preserved even past `Number.MAX_SAFE_INTEGER`'s own
		// significant-digit limit -- pg's default `numeric[]` array parser
		// would have already destroyed this via `parseFloat` before B2.1's
		// oid 1231 override.
		expect(row.precisions).toEqual([
			"123.450000",
			"170141183460469231731.687303715884105728",
		]);

		// numeric array, mode 'number' -- the separate, already-approximate
		// witness (see the `approx` column's own comment above).
		expect(row.approx).toEqual([123.45, 0.5]);

		// interval[] (task 1.3's driver override, oid 1187 + task 1.1's
		// array-literal text parser + task 1.2's per-element parseInterval):
		// a real database's own array-literal text for this column,
		// converted to structured IntervalValue elements.
		expect(row.durations).toEqual(insertedDurationsArray);

		// #341 (b) on the read side: the same structured values come back,
		// every zero field `+0` -- `toEqual` distinguishes `-0`, so this
		// asserts the parser's (D) normalization live against the server's
		// own `-00:05:00` text rather than a hand-built fixture.
		expect(mixedRow.amount).toBe(-42n);
		expect(mixedRow.precise).toBe("-0.500000");
		expect(mixedRow.duration).toEqual(mixedSignDuration);
		expect(mixedRow.created).toBeInstanceOf(Date);
		expect((mixedRow.created as Date).toISOString()).toBe(
			"1999-12-31T23:59:59.999Z",
		);
		expect(mixedRow.amounts).toEqual([-1, 0, 42]);
		expect(mixedRow.precisions).toEqual(["-123.450000"]);
		expect(mixedRow.approx).toEqual([-0.5]);
		expect(mixedRow.durations).toEqual(mixedSignDurationsArray);

		// #341 (d): the server's own output text, captured raw (cast to
		// `::text`, so no client-side parser ever touches it) and asserted
		// as exact strings -- the repository's first recorded samples of
		// Postgres's actual output grammar. Against the always-full write
		// forms pinned above, these record: singular unit names at 1
		// (`1 year`), zero axes elided entirely, an explicit `+` on a
		// positive group following a negative one, `.000000` fractions
		// dropped, and array elements quoted per-element only when their
		// own text contains a space (measured below: the pure time-axis
		// element `-00:05:00` arrives unquoted next to a quoted
		// `"-3 days"`).
		// `parseInterval` accepting both the elided output form and our
		// always-full input form is the "the server parses a normalized
		// variant of its own output grammar" rationale, previously resting
		// on Postgres knowledge alone.
		const rawRows = (await driver.execute({
			sql: "select id::text as id, duration::text as duration, durations::text as durations from g5_integration.roundtrip",
			params: [],
			kind: "sql",
		})) as ReadonlyArray<{ id: string; duration: string; durations: string }>;
		const rawById = new Map(rawRows.map((raw) => [raw.id, raw]));
		expect(rawById.get(insertedId)?.duration).toBe(
			"1 year 2 mons 3 days 04:05:06.789012",
		);
		expect(rawById.get(insertedId)?.durations).toBe(
			'{"1 day","2 days 03:00:00"}',
		);
		expect(rawById.get(mixedSignId)?.duration).toBe(
			"-1 years -2 mons +3 days -00:05:00",
		);
		expect(rawById.get(mixedSignId)?.durations).toBe('{-00:05:00,"-3 days"}');
	});
});

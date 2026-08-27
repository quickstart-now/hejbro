import { execFileSync } from "node:child_process";
import {
	bigint,
	interval,
	numeric,
	schema,
	select,
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
 * by task 1.5/#320) -- proves the declared arrival shapes (bigint mode,
 * numeric mode, `IntervalValue`, `Date`, and now their element-wise array
 * counterparts) round-trip through a *real* `db()` handle against a real
 * postgres:17, not a stub. Never runs under the default `pnpm test`/CI
 * (wired via `vitest.integration.config.ts` + task 5.1's exclude
 * patterns) -- local-only, `pnpm --filter @hejbro/pg test:integration`.
 *
 * Task 1.5 closes the two array gaps this harness used to exclude: a
 * `bigint({mode:'number'})` array and a `numeric` array (both moded --
 * `@hejbro/pg` never overrides an array oid for them, so they arrive as
 * `pg`'s own already-parsed JS arrays, task 1.2's "moded array" branch),
 * and an `interval[]` column (oid 1187, task 1.3's driver override --
 * arrives as raw array-literal text, task 1.1's parser + task 1.2's
 * per-element `parseInterval`). Array values are seeded via the same raw
 * parameterized `driver.execute` calls as every other column here (not
 * the typed `insert()` builder -- group 2's write-side value types are a
 * separate, later scope): `pg` serializes a bound JS array parameter to
 * Postgres array-literal text itself, the same way it serializes any
 * other bound value.
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
	// task 1.5/#320: element-wise array conversion, proved against a real
	// database rather than only the recorded-driver unit tests (1.1/1.2).
	// `precisions` is `mode: 'number'`, not 'string' -- a real finding from
	// this integration proof: unlike scalar `numeric` (oid 1700, pg leaves
	// it as raw text), pg's *default* array parser for `numeric[]` (oid
	// 1231, never overridden by this group -- only 1186/1187 are) returns
	// an array of already-`parseFloat`'d JS numbers, not text. 'string'/
	// 'bigint' mode over a `numeric[]` column can't round-trip losslessly
	// through the current driver as a result (flagged to the planner;
	// possibly a future oid-1231 override, out of this task's scope).
	// 'number' mode's own contract only promises exactness within
	// `Number.MAX_SAFE_INTEGER` to begin with, so pg's own float parse
	// ahead of ours costs nothing further for this proof.
	amounts: bigint({ mode: "number" }).array().notNull(),
	precisions: numeric({ mode: "number" }).array().notNull(),
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

	it("select round-trips typed rows on a real database", async () => {
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
				durations interval[] not null
			)`,
			params: [],
			kind: "sql",
		});

		const insertedId = "11111111-1111-1111-1111-111111111111";
		const insertedDuration = "1 year 2 mons 3 days 04:05:06.789012";
		const insertedCreated = "2020-06-15T12:30:00.000Z";
		const insertedAmountsArray = [123, 456, 789];
		const insertedPreciseArray = [123.45, 0.5];
		const insertedDurationsArray = ["1 day", "2 days 03:00:00"];

		// seeded via a raw parameterized statement, not the typed insert()
		// builder: `insert()`'s value type (core's `MutationValue`) only
		// accepts a plain `number` for the "numeric" family (bigint and
		// numeric columns alike) and has no scalar-literal case for
		// "interval" at all -- a pre-existing gap in `@hejbro/core`
		// entirely outside this group's file scope, not something to
		// paper over here. The behavior this task actually proves is the
		// *read* side (arrival-shape conversion through a real db()
		// handle), which is exactly what the assertions below exercise.
		await driver.execute({
			sql: "insert into g5_integration.roundtrip (id, amount, precise, duration, created, amounts, precisions, durations) values ($1, $2, $3, $4, $5, $6, $7, $8)",
			params: [
				insertedId,
				"9007199254740993",
				"123.456000",
				insertedDuration,
				insertedCreated,
				insertedAmountsArray,
				insertedPreciseArray,
				insertedDurationsArray,
			],
			kind: "sql",
		});

		const handle = db({ roundtrip }, driver);
		const rows = await handle.execute(select(roundtrip));

		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (row === undefined) {
			throw new Error("select returned no row");
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
		// pipeline assumes).
		expect(row.duration).toEqual({
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 789012,
		});

		// timestamptz -> a real Date, at the instant inserted.
		expect(row.created).toBeInstanceOf(Date);
		expect((row.created as Date).toISOString()).toBe(insertedCreated);

		// moded bigint array (task 1.2's "moded array" branch): pg's own
		// default array parser already hands back a JS array of numbers for
		// oid 1016 (_int8) -- no driver override needed for this axis, only
		// element-wise conversion against the declared mode.
		expect(row.amounts).toEqual([123, 456, 789]);

		// moded numeric array, mode 'number' (see the `precisions` column's
		// own comment above for why 'string' isn't provable here yet).
		expect(row.precisions).toEqual([123.45, 0.5]);

		// interval[] (task 1.3's driver override, oid 1187 + task 1.1's
		// array-literal text parser + task 1.2's per-element parseInterval):
		// a real database's own array-literal text for this column,
		// converted to structured IntervalValue elements.
		expect(row.durations).toEqual([
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
		]);
	});
});

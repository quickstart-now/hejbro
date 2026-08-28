import { execFileSync } from "node:child_process";
import {
	assertNoNulls,
	bigint,
	bytea,
	date,
	emptySnapshot,
	eq,
	generateMigration,
	getTableMeta,
	HejbroError,
	insert,
	integer,
	interval,
	numeric,
	rls,
	roleName,
	schema,
	select,
	serializeInterval,
	sql,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { db } from "@hejbro/query";
import { Pool } from "pg";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	expectTypeOf,
	it,
} from "vitest";
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
 *
 * add-array-ergonomics, group 4/task 4.1: `labels` (`text().array()
 * .notNullElements().notNull()`) extends this same real-server proof to
 * the non-null-element array feature. Three things only a live postgres:17
 * can show: (a) the CHECK text `create table` receives here is pinned as
 * identical to what `generateMigration` itself emits for this exact
 * declaration, and the server accepts a CHECK whose expression is a fully
 * schema/table/column-qualified `array_position(...)` reference inside a
 * table constraint -- a create-table failure here would mean the
 * generated SQL those unit tests approved is not actually valid DDL; (b)
 * a null array element written through the typed `insert()` builder is
 * rejected by the *database itself* (SQLSTATE 23514, the named
 * constraint) and surfaces through `@hejbro/query`'s
 * `query-execution-failed` wrapper -- never a client-side check, so a
 * constraint someone drops or renames in a future migration would still
 * be caught by the database, not silently accepted; (c) the compile-time
 * narrowing this feature buys (`ReadonlyArray<string>` on read, and
 * `assertNoNulls`'s single-call narrowing of a nullable-element array) is
 * proved against values a real server actually returned, not a
 * hand-built fixture.
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

/**
 * The exact CHECK text `generateMigration` emits for `labels`'s
 * `.notNullElements()` (pinned against the generator itself below, before
 * `create table` ever sees it) -- the `app.posts.tags` fixture from
 * `packages/core/test/dsl/check.test.ts:178,217`, carried over verbatim
 * onto this file's own `g5_integration.roundtrip.labels`.
 */
const labelsNoNullElementsConstraint =
	'constraint "labels_no_null_elements" check (array_position("g5_integration"."roundtrip"."labels", null) is null)';

/**
 * `seq`'s exact create-table clause -- core's own `generateMigration`
 * output for a bare `bigint().generatedAlwaysAsIdentity()` column,
 * eye-verified against the generator (never derived from it at runtime:
 * a runtime-sliced value re-fed into `.toContain` below would always
 * pass, proving nothing) and copied here as a literal, exactly
 * `labelsNoNullElementsConstraint`'s own discipline above. The raw
 * `create table` this test executes below splices this same constant in,
 * so a drift between the two can only ever be caught by the `.toContain`
 * assertion, never hidden by re-deriving one side from the other.
 */
const seqIdentityColumnSql =
	'"seq" bigint not null generated always as identity';

/**
 * `doubled`'s exact create-table clause -- core's own `generateMigration`
 * output for `bigint().generatedAlwaysAs(sql\`amount * 2\`)`, eye-verified
 * and pinned the same way as {@link seqIdentityColumnSql}.
 */
const doubledGeneratedColumnSql =
	'"doubled" bigint generated always as (amount * 2) stored';

/**
 * The bare `add generated always as identity` phrase -- the same grammar
 * {@link seqIdentityColumnSql} ends in, reused by the ordering-rule
 * witness's own `alter column ... add ...` statements below. Core's
 * `table-kind-emit.ts` emits this exact text for an identity-add
 * transition (see
 * `packages/core/test/golden/cases/identity-column-lifecycle/expected/step-1.sql`).
 */
const identityAddPhrase = "add generated always as identity";

const testSchema = schema("g5_integration");
const roundtrip = table(testSchema, "roundtrip", {
	id: uuid().primaryKey(),
	amount: bigint().notNull(),
	precise: numeric({ mode: "string" }).notNull(),
	duration: interval().notNull(),
	created: timestamptz().notNull(),
	// #339: a two-word declared key (SQL `note_text`) -- proves against a
	// real server that result rows arrive keyed by the DECLARED key, not
	// the SQL name (the query layer's row-key remap).
	noteText: text().notNull(),
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
	// add-array-ergonomics, group 4/task 4.1: the non-null-element array
	// witness -- see this file's own top comment for what this proves.
	labels: text().array().notNullElements().notNull(),
	// add-generated-columns, group 4/task 4.1
	seq: bigint().generatedAlwaysAsIdentity(),
	doubled: bigint().generatedAlwaysAs(sql`amount * 2`),
});

/**
 * The ordering-rule witness's own two table shapes (task 4.1's "witness
 * two ordering rules" addendum) -- `count` starts plain and nullable,
 * then gains a bare `generated always as identity`. `id` exists only so
 * the table is well-formed; only `count`'s own transition is under test.
 */
const lifecyclePlain = table(testSchema, "lifecycle", {
	id: integer().primaryKey(),
	count: integer(),
});
const lifecycleIdentity = table(testSchema, "lifecycle", {
	id: integer().primaryKey(),
	count: integer().generatedAlwaysAsIdentity(),
});

/**
 * Chained snapshots (each step's `previousSnapshot` is the prior step's
 * own `.snapshot`, mirroring `identity-column-lifecycle`'s golden case
 * shape) -- `lifecycleBase`'s `.sql` is never executed (the real table
 * below is created by hand, identically); only its `.snapshot` feeds the
 * next diff. `lifecycleWithIdentity`/`lifecycleWithoutIdentity` are the
 * two alter transitions the `it` below actually witnesses live.
 */
const lifecycleBase = generateMigration({
	declarations: [testSchema, getTableMeta(lifecyclePlain)],
	previousSnapshot: emptySnapshot,
});
const lifecycleWithIdentity = generateMigration({
	declarations: [testSchema, getTableMeta(lifecycleIdentity)],
	previousSnapshot: lifecycleBase.snapshot,
});
const lifecycleWithoutIdentity = generateMigration({
	declarations: [testSchema, getTableMeta(lifecyclePlain)],
	previousSnapshot: lifecycleWithIdentity.snapshot,
});

/**
 * The four alter statements `generateMigration` derives for the two
 * transitions above -- hand-written literals (never sliced from the
 * generator's own output at runtime; the same discipline
 * {@link seqIdentityColumnSql} documents), pinned by `.toContain` in the
 * `it` below before either is ever sent to Postgres. `lifecycleAddIdentity`
 * reuses {@link identityAddPhrase}, the same grammar
 * {@link seqIdentityColumnSql} ends in.
 */
const lifecycleSetNotNull =
	'alter table "g5_integration"."lifecycle" alter column "count" set not null;';
const lifecycleAddIdentity = `alter table "g5_integration"."lifecycle" alter column "count" ${identityAddPhrase};`;
const lifecycleDropIdentity =
	'alter table "g5_integration"."lifecycle" alter column "count" drop identity;';
const lifecycleDropNotNull =
	'alter table "g5_integration"."lifecycle" alter column "count" drop not null;';

/**
 * add-relational-reads, group 4/task 4.1: the relational-read witness's
 * own three tables. `authorId` is nullable on purpose (the missing
 * forward row must arrive `null`), and `rel_comments` carries one column
 * per arrival-contract axis the F1 ruling fixed (bigint text, timestamptz
 * ISO, date local-midnight, interval via the driver pin, bytea via the
 * hex pin, bigint[] element-wise) plus row-level security so the scoped
 * read can prove nested rows obey the context's policies.
 */
const relAuthors = table(testSchema, "rel_authors", {
	id: uuid().primaryKey(),
	name: text().notNull(),
});
const relPosts = table(testSchema, "rel_posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
	authorId: uuid().references(() => relAuthors.id),
});
const relComments = table(
	testSchema,
	"rel_comments",
	{
		id: uuid().primaryKey(),
		postId: uuid()
			.notNull()
			.references(() => relPosts.id),
		viewCount: bigint().notNull(),
		postedOn: date(),
		postedAt: timestamptz().notNull(),
		spent: interval().notNull(),
		payload: bytea(),
		tags: bigint().array().notNull(),
	},
	(t) => ({
		rls: rls.enabled({
			read: rls
				.policy("g4_viewer_read")
				.for("select")
				.to("g4_viewer")
				.using(sql`${t.viewCount} < 100`),
		}),
	}),
);

// Tables passed WHOLE (not via getTableMeta): generate's rls/policy
// expansion is the Table branch's own -- a raw TableDeclaration skips
// it, which is exactly the drift the policy pin below would then miss.
const relMigration = generateMigration({
	declarations: [testSchema, relAuthors, relPosts, relComments],
	previousSnapshot: emptySnapshot,
}).sql;

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

		// add-array-ergonomics, group 4/task 4.1: pin the CHECK text this
		// `create table` is about to receive against `generateMigration`'s
		// own output for the exact same declaration -- the raw DDL below is
		// never produced by the migration engine (out of this group's scope
		// entirely), so this is what keeps the two texts from silently
		// drifting apart. add-generated-columns, group 4/task 4.1 reuses the
		// same `generateMigration` call for `seq`/`doubled`'s own clauses.
		const roundtripMigrationSql = generateMigration({
			declarations: [testSchema, getTableMeta(roundtrip)],
			previousSnapshot: emptySnapshot,
		}).sql;
		expect(roundtripMigrationSql).toContain(labelsNoNullElementsConstraint);
		expect(roundtripMigrationSql).toContain(seqIdentityColumnSql);
		expect(roundtripMigrationSql).toContain(doubledGeneratedColumnSql);

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
				note_text text not null,
				amounts bigint[] not null,
				precisions numeric[] not null,
				approx numeric[] not null,
				durations interval[] not null,
				labels text[] not null,
				${seqIdentityColumnSql},
				${doubledGeneratedColumnSql},
				${labelsNoNullElementsConstraint}
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
					noteText: "first note",
					amounts: insertedAmountsArray,
					precisions: insertedPreciseArray,
					approx: insertedApproxArray,
					durations: insertedDurationsArray,
					labels: ["alpha", "beta"],
				},
				{
					id: mixedSignId,
					amount: -42n,
					precise: "-0.500000",
					duration: mixedSignDuration,
					created: new Date("1999-12-31T23:59:59.999Z"),
					noteText: "mixed note",
					// #349: a SQL null element written through the typed
					// builder (writer renders the unquoted NULL token) and
					// read back as `null` at the same position -- the
					// execution spec's "every NULL element is null" sentence,
					// witnessed against a real server.
					amounts: [-1, null, 42],
					precisions: ["-123.450000"],
					approx: [-0.5],
					durations: mixedSignDurationsArray,
					// add-array-ergonomics, group 4/task 4.1: the empty-array edge
					// -- `array_position([], null)` is `null`, so the CHECK passes
					// trivially, and this row proves that for free.
					labels: [],
				},
			]),
		);

		// add-array-ergonomics, group 4/task 4.1: a null array element written
		// through the typed `insert()` builder is rejected by the *database*
		// itself, not the client -- proving the CHECK created above is a real
		// backstop, not merely accepted DDL. `as unknown as
		// ReadonlyArray<string>` is a deliberate type escape hatch: the
		// declared type already refuses a null element here (proved by the
		// core package's own type tests for `.notNullElements()`), so
		// reaching the database at all requires bypassing that type on
		// purpose.
		try {
			await handle.execute(
				insert(roundtrip).values([
					{
						id: "33333333-3333-3333-3333-333333333333",
						amount: 1n,
						precise: "0.000000",
						duration: insertedDuration,
						created: new Date(insertedCreated),
						noteText: "rejected note",
						amounts: [1],
						precisions: ["1.000000"],
						approx: [1],
						durations: insertedDurationsArray,
						labels: ["ok", null] as unknown as ReadonlyArray<string>,
					},
				]),
			);
			expect.unreachable(
				"the database should have rejected the null array element",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "query-execution-failed");
			expect(error).toHaveProperty("kind", "insert");
			const cause = (error as { cause?: unknown }).cause;
			expect(cause).toHaveProperty("code", "23514");
			expect(cause).toHaveProperty("constraint", "labels_no_null_elements");
		}

		// add-generated-columns, group 4/task 4.1: `seq` (generated always as
		// identity) has no key at all on `InsertInput` (D100 decision 5) --
		// core's own raw `insert()` (`MutationRow`, used everywhere else in
		// this file) leaves every column optional and does NOT enforce this
		// exclusion (#390), so this proof goes through the query package's
		// chain entry point instead (`handle.insert(...)`, `InsertInput`-typed,
		// `chain-mutation-input.test.ts`'s #351 wiring) -- the only place the
		// type layer actually refuses this key. `as never` is the deliberate
		// cast escape: reaching the database at all requires bypassing that
		// refusal on purpose, exactly like the labels case above.
		try {
			await handle.insert(roundtrip).values([
				{
					id: "44444444-4444-4444-4444-444444444444",
					amount: 1n,
					precise: "0.000000",
					duration: insertedDuration,
					created: new Date(insertedCreated),
					noteText: "rejected note",
					amounts: [1],
					precisions: ["1.000000"],
					approx: [1],
					durations: insertedDurationsArray,
					labels: [],
					seq: 1n,
				},
			] as never);
			expect.unreachable(
				"the database should have rejected the explicit identity write",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "query-execution-failed");
			expect(error).toHaveProperty("kind", "insert");
			const cause = (error as { cause?: unknown }).cause;
			expect(cause).toHaveProperty("code", "428C9");
		}

		// add-generated-columns, group 4/task 4.1: the same proof for
		// `doubled` (stored generated) -- Postgres refuses a client-supplied
		// value for either ALWAYS-family kind alike (measured, not assumed).
		// Same #390 gap: core's raw `insert()` would not have refused this
		// key either, so this goes through the chain entry point too.
		try {
			await handle.insert(roundtrip).values([
				{
					id: "55555555-5555-5555-5555-555555555555",
					amount: 1n,
					precise: "0.000000",
					duration: insertedDuration,
					created: new Date(insertedCreated),
					noteText: "rejected note",
					amounts: [1],
					precisions: ["1.000000"],
					approx: [1],
					durations: insertedDurationsArray,
					labels: [],
					doubled: 2n,
				},
			] as never);
			expect.unreachable(
				"the database should have rejected the explicit generated-column write",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "query-execution-failed");
			expect(error).toHaveProperty("kind", "insert");
			const cause = (error as { cause?: unknown }).cause;
			expect(cause).toHaveProperty("code", "428C9");
		}

		// add-generated-columns, group 4/task 4.1: the type-level rejection
		// itself, pinned separately from the two runtime proofs above --
		// each statement is only ever built, never awaited, so it never
		// reaches the driver (a chain is inert until awaited, `chain.ts`'s
		// own contract). `sql` keeps the value arm itself error-free so the
		// directive consumes exactly the "does not exist" diagnostic.
		const identityWriteTypeRejected = handle.insert(roundtrip).values([
			{
				id: "66666666-6666-6666-6666-666666666666",
				amount: 1n,
				precise: "0.000000",
				duration: insertedDuration,
				created: new Date(insertedCreated),
				noteText: "never sent",
				amounts: [1],
				precisions: ["1.000000"],
				approx: [1],
				durations: insertedDurationsArray,
				labels: [],
				// @ts-expect-error seq is ALWAYS-family (generated always as identity, D100 decision 5) -- no key exists on InsertInput to supply.
				seq: sql`1`,
			},
		]);
		expect(identityWriteTypeRejected).toBeDefined();

		const generatedWriteTypeRejected = handle.insert(roundtrip).values([
			{
				id: "77777777-7777-7777-7777-777777777777",
				amount: 1n,
				precise: "0.000000",
				duration: insertedDuration,
				created: new Date(insertedCreated),
				noteText: "never sent",
				amounts: [1],
				precisions: ["1.000000"],
				approx: [1],
				durations: insertedDurationsArray,
				labels: [],
				// @ts-expect-error doubled is ALWAYS-family (stored generated, D100 decision 5) -- no key exists on InsertInput to supply.
				doubled: sql`2`,
			},
		]);
		expect(generatedWriteTypeRejected).toBeDefined();

		const rows = await handle.execute(select(roundtrip));

		// the rejected insert above contributed nothing -- still exactly the
		// two rows the first, accepted insert seeded.
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

		// #339: the two-word column arrives under its declared key against a
		// real server (the driver's raw row carries `note_text`).
		expect(row.noteText).toBe("first note");
		expect(row).not.toHaveProperty("note_text");

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

		// add-array-ergonomics, group 4/task 4.1: `.notNullElements()`
		// narrows the declared read type itself (no `| null` in the
		// element), proved against a real server's returned row -- element
		// consumption (`.map`) needs no null filter or guard first.
		expectTypeOf(row.labels).toEqualTypeOf<ReadonlyArray<string>>();
		expect(row.labels).toEqual(["alpha", "beta"]);
		expect(row.labels.map((label) => label.toUpperCase())).toEqual([
			"ALPHA",
			"BETA",
		]);

		// add-array-ergonomics, group 4/task 4.1: `assertNoNulls` applied to
		// a nullable-element array column (`amounts`) narrows in one call,
		// against the value a real server actually returned -- a clean
		// array (no null elements) comes back with every element intact.
		const safeAmounts = assertNoNulls(row.amounts);
		expectTypeOf(safeAmounts).toEqualTypeOf<ReadonlyArray<number>>();
		expect(safeAmounts).toHaveLength(3);
		expect(safeAmounts).toEqual([123, 456, 789]);
		expect(safeAmounts.map((amount) => amount + 1)).toEqual([124, 457, 790]);

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
		expect(mixedRow.noteText).toBe("mixed note");
		expect(mixedRow.amounts).toEqual([-1, null, 42]);
		expect(mixedRow.precisions).toEqual(["-123.450000"]);
		expect(mixedRow.approx).toEqual([-0.5]);
		expect(mixedRow.durations).toEqual(mixedSignDurationsArray);

		// add-array-ergonomics, group 4/task 4.1: the empty-array edge on
		// the read side -- `array_position([], null)` is `null`, so the
		// CHECK passed trivially at insert time, and the empty array comes
		// back as an empty array, not `null` or a one-element array.
		expect(mixedRow.labels).toEqual([]);

		// add-generated-columns, group 4/task 4.1: identity values arrive
		// assigned -- the seed insert above is this sequence's first touch,
		// so insertion order fixes the assigned values deterministically
		// (`row` seeded first, `mixedRow` second).
		expect(row.seq).toBe(1n);
		expect(mixedRow.seq).toBe(2n);

		// the computed column arrives computed: `amount * 2`, including past
		// `Number.MAX_SAFE_INTEGER` (bigint mode never loses precision).
		expect(row.doubled).toBe(18014398509481986n);
		expect(mixedRow.doubled).toBe(-84n);

		// add-array-ergonomics, group 4/task 4.1: `assertNoNulls` applied to
		// `mixedRow.amounts` (`[-1, null, 42]`, a real server's own answer,
		// not a hand-built fixture) throws `HejbroError("null-array-element")`
		// naming the first null element's index -- it never silently drops
		// it.
		try {
			assertNoNulls(mixedRow.amounts);
			expect.unreachable("a null element should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("null-array-element");
			expect((error as HejbroError).message).toMatch(/\bindex 1\b/);
		}

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

	it("identity ordering rules (add-generated-columns, group 4/task 4.1): the exact statements generateMigration derives, measured live in both directions against a real postgres:17", async () => {
		const activePool = pool.current;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const driver = pgDriver(activePool);

		// group 2 derived two ordering rules from Postgres semantics but
		// could not measure them without a live server (task 4.1's own
		// addendum) -- pin the four statements against generateMigration's
		// own chained-snapshot derivation before either is ever sent to
		// Postgres. A wrong derivation here would break a real migration at
		// apply time, not just this test.
		expect(lifecycleWithIdentity.sql).toContain(lifecycleSetNotNull);
		expect(lifecycleWithIdentity.sql).toContain(lifecycleAddIdentity);
		expect(
			lifecycleWithIdentity.sql.indexOf(lifecycleSetNotNull) <
				lifecycleWithIdentity.sql.indexOf(lifecycleAddIdentity),
		).toBe(true);
		expect(lifecycleWithoutIdentity.sql).toContain(lifecycleDropIdentity);
		expect(lifecycleWithoutIdentity.sql).toContain(lifecycleDropNotNull);
		expect(
			lifecycleWithoutIdentity.sql.indexOf(lifecycleDropIdentity) <
				lifecycleWithoutIdentity.sql.indexOf(lifecycleDropNotNull),
		).toBe(true);

		// `g5_integration` already exists (created by the first `it` above,
		// same describe/`beforeAll` pool, run first by vitest's declaration
		// order) -- this scratch table lives in it, untouched by the
		// `roundtrip` fixture. Created plain, matching `lifecyclePlain`
		// exactly (the `.sql` this shape would itself generate is never
		// executed -- only its `.snapshot`, above, feeds the chain).
		await driver.execute({
			sql: "create table g5_integration.lifecycle (id integer primary key, count integer)",
			params: [],
			kind: "sql",
		});

		// rule 1, reversed: adding identity before `set not null` is
		// rejected -- the exact same pinned string the derived-order
		// execution below uses, just run first against a column that isn't
		// NOT NULL yet.
		try {
			await driver.execute({
				sql: lifecycleAddIdentity,
				params: [],
				kind: "sql",
			});
			expect.unreachable(
				"postgres should reject adding identity before NOT NULL",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "55000");
			expect((error as { message?: string }).message).toMatch(
				/must be declared NOT NULL before identity can be added/,
			);
		}

		// rule 1, derived order: succeeds.
		await driver.execute({ sql: lifecycleSetNotNull, params: [], kind: "sql" });
		await driver.execute({
			sql: lifecycleAddIdentity,
			params: [],
			kind: "sql",
		});

		// rule 2, reversed: dropping `not null` before `drop identity` is
		// rejected.
		try {
			await driver.execute({
				sql: lifecycleDropNotNull,
				params: [],
				kind: "sql",
			});
			expect.unreachable(
				"postgres should reject dropping NOT NULL on an identity column",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "42601");
			expect((error as { message?: string }).message).toMatch(
				/is an identity column/,
			);
		}

		// rule 2, derived order: succeeds.
		await driver.execute({
			sql: lifecycleDropIdentity,
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: lifecycleDropNotNull,
			params: [],
			kind: "sql",
		});
	});
	it("relational reads (add-relational-reads, group 4/task 4.1): related() against a real postgres:17 -- revive, shapes, and rls-scoped nested rows", async () => {
		const activePool = pool.current;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const driver = pgDriver(activePool);

		// The FK clauses and the policy the raw DDL below receives are
		// pinned as core's own emit output (the one-shared-constant rule):
		// the raw DDL is never produced by the migration engine here, so
		// these pins are what keep the two texts from drifting apart.
		const postFkClause =
			'constraint "rel_posts_author_id_fk" foreign key ("author_id") references "g5_integration"."rel_authors" ("id")';
		const commentFkClause =
			'constraint "rel_comments_post_id_fk" foreign key ("post_id") references "g5_integration"."rel_posts" ("id")';
		const policySql =
			'create policy "g4_viewer_read" on "g5_integration"."rel_comments" for select to "g4_viewer" using ("g5_integration"."rel_comments"."view_count" < 100);';
		expect(relMigration).toContain(postFkClause);
		expect(relMigration).toContain(commentFkClause);
		expect(relMigration).toContain(policySql);
		expect(relMigration).toContain(
			'alter table "g5_integration"."rel_comments" enable row level security',
		);

		await driver.execute({
			sql: `create table g5_integration.rel_authors (
				id uuid primary key,
				name text not null
			)`,
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: `create table g5_integration.rel_posts (
				id uuid primary key,
				title text not null,
				author_id uuid,
				${postFkClause}
			)`,
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: `create table g5_integration.rel_comments (
				id uuid primary key,
				post_id uuid not null,
				view_count bigint not null,
				posted_on date,
				posted_at timestamptz not null,
				spent interval not null,
				payload bytea,
				tags bigint[] not null,
				${commentFkClause}
			)`,
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: "create role g4_viewer",
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: 'alter table "g5_integration"."rel_comments" enable row level security',
			params: [],
			kind: "sql",
		});
		await driver.execute({ sql: policySql, params: [], kind: "sql" });
		await driver.execute({
			sql: "grant usage on schema g5_integration to g4_viewer; grant select on all tables in schema g5_integration to g4_viewer",
			params: [],
			kind: "sql",
		});

		const handle = db({ relAuthors, relPosts, relComments }, driver);

		const authorId = "aaaaaaaa-0000-4000-8000-000000000001";
		const postWithId = "bbbbbbbb-0000-4000-8000-000000000001";
		const postBareId = "bbbbbbbb-0000-4000-8000-000000000002";
		await handle.insert(relAuthors).values({ id: authorId, name: "mo" });
		await handle.insert(relPosts).values([
			{ id: postWithId, title: "with", authorId },
			{ id: postBareId, title: "bare" },
		]);
		const bigCount = 9007199254740993n;
		const postedOn = new Date(2026, 7, 28);
		const postedAt = new Date("2026-08-28T09:00:00.000Z");
		const spent = {
			years: 0,
			months: 0,
			days: 1,
			hours: 2,
			minutes: 3,
			seconds: 4,
			microseconds: 0,
		};
		await handle.insert(relComments).values([
			{
				id: "cccccccc-0000-4000-8000-000000000001",
				postId: postWithId,
				viewCount: 5n,
				postedOn,
				postedAt,
				spent,
				payload: sql`'\\x0102ff'::bytea`,
				tags: [1n, bigCount],
			},
			{
				id: "cccccccc-0000-4000-8000-000000000002",
				postId: postWithId,
				viewCount: 7n,
				postedAt,
				spent,
				tags: [2n],
			},
			{
				id: "cccccccc-0000-4000-8000-000000000003",
				postId: postWithId,
				viewCount: bigCount,
				postedAt,
				spent,
				tags: [3n],
			},
		]);

		// --- unscoped related read: shapes and full revive -------------
		const posts = await handle
			.select(relPosts)
			.related({ relComments: true, author: true })
			.orderBy(relPosts.title);
		expect(posts).toHaveLength(2);
		const bare = posts[0];
		const withAuthor = posts[1];
		expect(bare?.relComments).toEqual([]);
		expect(bare?.author).toBeNull();
		expect(withAuthor?.author?.name).toBe("mo");
		expect(withAuthor?.relComments).toHaveLength(3);
		const compareBigints = (a: bigint, b: bigint): number => {
			if (a < b) {
				return -1;
			}
			return 1;
		};
		const byCount = [...(withAuthor?.relComments ?? [])].sort((a, b) =>
			compareBigints(a.viewCount, b.viewCount),
		);
		const first = byCount[0];
		const biggest = byCount[2];
		expect(first?.viewCount).toBe(5n);
		expect(biggest?.viewCount).toBe(bigCount);
		expect(first?.postedAt.getTime()).toBe(postedAt.getTime());
		expect(first?.spent).toMatchObject({
			days: 1,
			hours: 2,
			minutes: 3,
			seconds: 4,
		});
		expect(first?.payload).toEqual(new Uint8Array([1, 2, 255]));
		expect(first?.tags).toEqual([1n, bigCount]);

		// the F1 contract in its TZ-independent form: the SAME column read
		// top-level and nested resolves the SAME instant, whatever zone
		// this machine runs in.
		const topRows = await handle
			.select(relComments)
			.where(eq(relComments.id, "cccccccc-0000-4000-8000-000000000001"));
		// instanceOf first: without it the same-instant assertion passes
		// VACUOUSLY when neither side arrived at all (review N1).
		expect(first?.postedOn).toBeInstanceOf(Date);
		expect(first?.postedOn?.getTime()).toBe(topRows[0]?.postedOn?.getTime());

		// --- scoped read: nested rows obey the context's policy --------
		const scoped = await handle
			.as({ role: roleName("g4_viewer") })
			.select(relPosts)
			.related({ relComments: true })
			.orderBy(relPosts.title);
		const scopedWith = scoped[1];
		const scopedCounts = [...(scopedWith?.relComments ?? [])]
			.map((comment) => comment.viewCount)
			.sort(compareBigints);
		// the >=100 comment is filtered BY THE DATABASE inside the single
		// related statement -- nested rows ride the same rls the context
		// grants, never a second unscoped query.
		expect(scopedCounts).toEqual([5n, 7n]);
	});
	it("set operations (add-set-operations, group 4/task 4.1): union/unionAll/except live, converted arrivals, and one rls-scoped set-op", async () => {
		const activePool = pool.current;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const driver = pgDriver(activePool);
		await driver.execute({
			sql: `create table g5_integration.so_a (
				id uuid primary key,
				label text not null,
				amount bigint not null,
				spent interval not null
			)`,
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: `create table g5_integration.so_b (
				id uuid primary key,
				label text not null,
				amount bigint not null,
				spent interval not null
			)`,
			params: [],
			kind: "sql",
		});
		const soA = table(testSchema, "so_a", {
			id: uuid().primaryKey(),
			label: text().notNull(),
			amount: bigint().notNull(),
			spent: interval().notNull(),
		});
		const soB = table(testSchema, "so_b", {
			id: uuid().primaryKey(),
			label: text().notNull(),
			amount: bigint().notNull(),
			spent: interval().notNull(),
		});
		const handle = db({ soA, soB }, driver);
		const spent = {
			years: 0,
			months: 0,
			days: 1,
			hours: 2,
			minutes: 0,
			seconds: 0,
			microseconds: 0,
		};
		const big = 9007199254740993n;
		await handle.insert(soA).values([
			{
				id: "dddddddd-0000-4000-8000-000000000001",
				label: "both",
				amount: big,
				spent,
			},
			{
				id: "dddddddd-0000-4000-8000-000000000002",
				label: "only_a",
				amount: 1n,
				spent,
			},
		]);
		await handle.insert(soB).values([
			// same VALUES as so_a's first row (id differs -- dedup is by the
			// whole row, so these two do NOT collapse; label+amount+spent do)
			{
				id: "dddddddd-0000-4000-8000-000000000003",
				label: "both",
				amount: big,
				spent,
			},
			{
				id: "dddddddd-0000-4000-8000-000000000004",
				label: "only_b",
				amount: 2n,
				spent,
			},
		]);

		// distinct-vs-all row counts over a shared-shape projection
		const shared = (t: typeof soA) =>
			handle.select({ label: t.label, amount: t.amount, spent: t.spent }, t);
		const distinctRows = await shared(soA).union(shared(soB));
		const allRows = await shared(soA).unionAll(shared(soB));
		expect(allRows).toHaveLength(4);
		expect(distinctRows).toHaveLength(3);

		// converted arrivals through the set-op (left-branch plan): bigint
		// stays bigint past 2^53, interval arrives structured
		const bigRow = distinctRows.find((row) => row.label === "both");
		expect(bigRow?.amount).toBe(big);
		expect(bigRow?.spent).toMatchObject({ days: 1, hours: 2 });

		// except + whole-set order/limit
		const onlyA = await shared(soA)
			.except(shared(soB))
			.orderBy(soA.label)
			.limit(5);
		expect(onlyA).toHaveLength(1);
		expect(onlyA[0]?.label).toBe("only_a");

		// rls-scoped set-op: one statement under the context
		await driver.execute({
			sql: "create role so_viewer",
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: "grant usage on schema g5_integration to so_viewer; grant select on all tables in schema g5_integration to so_viewer",
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: 'alter table "g5_integration"."so_a" enable row level security',
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: `create policy so_viewer_read on "g5_integration"."so_a" for select to so_viewer using (label <> 'only_a')`,
			params: [],
			kind: "sql",
		});
		const scopedHandle = db({ soA, soB }, driver, {
			roles: [roleName("so_viewer")],
		});
		const scoped = await scopedHandle
			.as({ role: roleName("so_viewer") })
			.select({ label: soA.label }, soA)
			.unionAll(scopedHandle.select({ label: soB.label }, soB));
		// so_a contributes only its policy-visible row ("both"); so_b (rls
		// off) contributes both of its rows -- the policy filtered INSIDE
		// the single set-op statement.
		expect(scoped.map((row) => row.label).sort()).toEqual([
			"both",
			"both",
			"only_b",
		]);
	});

	it("savepoints (#313): a rolled-back nested transaction keeps the outer one alive, live against a real postgres:17", async () => {
		const activePool = pool.current;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const driver = pgDriver(activePool);
		await driver.execute({
			sql: `create table g5_integration.sp_rows (
				id uuid primary key,
				label text not null
			)`,
			params: [],
			kind: "sql",
		});
		const spRows = table(testSchema, "sp_rows", {
			id: uuid().primaryKey(),
			label: text().notNull(),
		});
		const handle = db({ spRows }, driver);
		const boom = new Error("inner failed");

		// The claim a fixture driver cannot make: the server itself keeps
		// the outer transaction usable after the inner one rolls back, and
		// commits exactly the rows outside the rolled-back savepoint.
		const caught = await handle.transaction(async (tx) => {
			await tx
				.insert(spRows)
				.values({ id: "11111111-1111-1111-1111-111111111111", label: "kept" })
				.returning({ id: spRows.id });

			const inner = await tx
				.transaction(async (nested) => {
					await nested
						.insert(spRows)
						.values({
							id: "22222222-2222-2222-2222-222222222222",
							label: "discarded",
						})
						.returning({ id: spRows.id });
					throw boom;
				})
				.catch((error: unknown) => error);

			// the outer transaction is NOT aborted -- this statement would
			// fail with "current transaction is aborted" if the rollback had
			// taken the whole transaction down instead of just the savepoint.
			await tx
				.insert(spRows)
				.values({ id: "33333333-3333-3333-3333-333333333333", label: "after" })
				.returning({ id: spRows.id });
			return inner;
		});

		expect(caught).toBe(boom);
		const committed = await handle.select(spRows);
		expect(committed.map((row) => row.label).sort()).toEqual(["after", "kept"]);

		// a nested transaction that returns normally releases into the outer
		// one, so its rows commit with everything else.
		await handle.transaction(async (tx) => {
			await tx.transaction(async (nested) => {
				await nested
					.insert(spRows)
					.values({
						id: "44444444-4444-4444-4444-444444444444",
						label: "released",
					})
					.returning({ id: spRows.id });
			});
		});
		const withReleased = await handle.select(spRows);
		expect(withReleased.map((row) => row.label).sort()).toEqual([
			"after",
			"kept",
			"released",
		]);
	});

	it("offset and distinct on (#437): pagination and one row per group, live against a real postgres:17", async () => {
		const activePool = pool.current;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const driver = pgDriver(activePool);
		await driver.execute({
			sql: `create table g5_integration.dd_events (
				id uuid primary key,
				stream text not null,
				seq bigint not null,
				label text not null
			)`,
			params: [],
			kind: "sql",
		});
		const events = table(testSchema, "dd_events", {
			id: uuid().primaryKey(),
			stream: text().notNull(),
			seq: bigint({ mode: "bigint" }).notNull(),
			label: text().notNull(),
		});
		const handle = db({ events }, driver);
		await handle.insert(events).values([
			{
				id: "10000000-0000-0000-0000-000000000001",
				stream: "a",
				seq: 1n,
				label: "a1",
			},
			{
				id: "10000000-0000-0000-0000-000000000002",
				stream: "a",
				seq: 2n,
				label: "a2",
			},
			{
				id: "10000000-0000-0000-0000-000000000003",
				stream: "b",
				seq: 1n,
				label: "b1",
			},
			{
				id: "10000000-0000-0000-0000-000000000004",
				stream: "b",
				seq: 3n,
				label: "b3",
			},
			{
				id: "10000000-0000-0000-0000-000000000005",
				stream: "c",
				seq: 9n,
				label: "c9",
			},
		]);

		// pagination: the server, not the client, skips the first two rows.
		const page = await handle
			.select({ label: events.label }, events)
			.orderBy(events.label)
			.limit(2)
			.offset(2);
		expect(page.map((row) => row.label)).toEqual(["b1", "b3"]);

		// distinct on: one row per stream, and WHICH row is decided by the
		// order by -- the Postgres-specific semantics a fixture cannot prove.
		const latestPerStream = await handle
			.select({ stream: events.stream, label: events.label }, events)
			.distinctOn(events.stream)
			.orderBy(events.stream, { by: events.seq, direction: "desc" });
		expect(latestPerStream.map((row) => row.label)).toEqual(["a2", "b3", "c9"]);

		// plain distinct collapses duplicates the projection creates.
		const streams = await handle
			.select({ stream: events.stream }, events)
			.distinct()
			.orderBy(events.stream);
		expect(streams.map((row) => row.stream)).toEqual(["a", "b", "c"]);
	});
});

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pgDriver } from "@hejbro/pg";
import type { Driver } from "@hejbro/query";
import { createJiti } from "jiti";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import {
	readLock,
	vendorContractPath,
	vendorSqlPath,
} from "../src/vendor/lock";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

/**
 * The jiti-loaded contract module's own runtime shape, typed loosely on
 * purpose: `contract.ts` is generated text this test never imports
 * statically (jiti loads it from the consumer fixture's own filesystem
 * path, matching how `loadDeclarations`/`loadConfig` load a real user's
 * files, `loader.ts`), so there is no static type to import here. Full
 * type-level fidelity against the real `@hejbro/query` client surface is
 * already `examples/cli-smoke/test/vendored-contract.test.ts`'s own job
 * (a real `tsc` against the real, installed package); this shape is only
 * what this test itself calls.
 */
type MetricsRow = {
	readonly bigCount: bigint;
	readonly amount: string;
	readonly observedAt: Date;
};
type MetricsClient = {
	select(): Promise<ReadonlyArray<MetricsRow>>;
};
type ContractModule = {
	readonly createDb: (conn: Driver) => { readonly metrics: MetricsClient };
};

/** [add-unmanaged-objects, 3.2] The same loosely-typed jiti shape as {@link ContractModule}, for the existing-table + managed-FK fixture. */
type UsersRow = {
	readonly id: string;
	readonly email: string | null;
};
type PostsRow = {
	readonly id: string;
	readonly authorId: string;
};
type AuthJoinClient = {
	select(): Promise<ReadonlyArray<UsersRow>>;
};
type PostsClient = {
	select(): Promise<ReadonlyArray<PostsRow>>;
};
type AuthJoinContractModule = {
	readonly createDb: (conn: Driver) => {
		readonly users: AuthJoinClient;
		readonly posts: PostsClient;
	};
};

/**
 * The two-repository witness (group 9, #602) -- not this change's own
 * requirement. It was planned in the sibling change (`add-polyrepo-sync`,
 * R2-G9), moved to this one whole (lead decision PS-PIVOT-R3-09) because
 * its own 9.2 -- "the consumer raises a database from the vendored SQL
 * and runs a typed query through the contract" -- is *applying*, which is
 * this change's subject, not the sibling's. The sibling's own archived
 * record (`openspec/changes/archive/2026-09-02-add-polyrepo-sync/
 * tasks.md`, its R2-G9 section) states plainly that it ships with no
 * live-execution proof of its own: mocked-driver coverage
 * (`@hejbro/query`'s `recordingTransactionalDriver` suite) plus a real
 * `tsc`, no-database round trip (`examples/cli-smoke/test/
 * vendored-contract.test.ts`) -- neither is a live query. This file is
 * that missing live query, arriving from the change that absorbed the
 * work that produces one.
 *
 * What each task proves (read from the sibling's `schema-vendoring` spec,
 * merged into `openspec/specs/schema-vendoring/spec.md`, not invented
 * here):
 * - 9.1: "Vendoring pins what it read" -- the contract, the description
 *   and the squashed SQL are written, and the lock records the commit.
 * - 9.2: "The contract reproduces the consumer-visible type layer" and
 *   "A consumer holds a contract, not declarations" -- but the property
 *   only a *live* driver can settle is neither of those (both already
 *   have non-live proof elsewhere): it is **row conversion**, not SQL
 *   identity or static typing -- a `bigint`/`numeric`/`timestamptz`
 *   column's value actually arriving as the contract's declared type,
 *   decoded from a real driver's own wire bytes, not a mock's hand-fed
 *   JS value.
 * - 9.3: "Being behind is advice, not failure" (`outdated`) and
 *   "Vendoring pins what it read" a second time (`vendor` again) --
 *   staleness reported without failing, then the update lands as an
 *   observable diff.
 *
 * Docker-gated, local-only (`pnpm --filter hejbro test:integration`),
 * mirroring every other file in this directory. One image
 * (`postgres:17-alpine`): unlike `apply-live.integration.test.ts`, this
 * group is not testing a supported-version floor -- it is proving one
 * fact (real row conversion) that does not vary by server version.
 */
const IMAGE = "postgres:17-alpine";

const dockerAvailable = (): boolean => {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const sleep = (ms: number): Promise<void> =>
	new Promise((doResolve) => setTimeout(doResolve, ms));

/** Same two-occurrence wait `apply-live.integration.test.ts`/`check-live.integration.test.ts` already measured and fixed -- the postgres image's entrypoint answers "ready" once for its own temporary bootstrap server, then again for the real one. */
const readyLogLineCount = (container: string): number => {
	const logs = execFileSync("sh", ["-c", `docker logs ${container} 2>&1`], {
		encoding: "utf-8",
	});
	return (logs.match(/database system is ready to accept connections/g) ?? [])
		.length;
};

const waitUntilReady = async (
	container: string,
	attemptsLeft: number,
): Promise<void> => {
	if (readyLogLineCount(container) >= 2) {
		return;
	}
	if (attemptsLeft <= 0) {
		throw new Error(
			`postgres in container "${container}" never became ready. Next: check \`docker logs ${container}\`.`,
		);
	}
	await sleep(300);
	return waitUntilReady(container, attemptsLeft - 1);
};

const containerPort = (container: string): string => {
	const output = execFileSync("docker", ["port", container, "5432/tcp"], {
		encoding: "utf-8",
	});
	const firstLine = (output.trim().split("\n")[0] ?? "").trim();
	const port = firstLine.split(":").at(-1);
	if (port === undefined || port === "") {
		throw new Error(
			`could not parse the host port docker mapped for container "${container}" from: ${JSON.stringify(output)}`,
		);
	}
	return port;
};

const psqlCommand = (
	container: string,
	database: string,
	sql: string,
): void => {
	execFileSync(
		"docker",
		[
			"exec",
			container,
			"psql",
			"-U",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-d",
			database,
			"-c",
			sql,
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
};

const runGit = (cwd: string, args: ReadonlyArray<string>): void => {
	execFileSync("git", args, {
		cwd,
		stdio: ["ignore", "ignore", "inherit"],
		env: {
			...process.env,
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_AUTHOR_NAME: "hejbro test",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_AUTHOR_EMAIL: "test@example.com",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_COMMITTER_NAME: "hejbro test",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
};

const initGitRepo = (cwd: string): void => {
	runGit(cwd, ["init", "-q"]);
};

const METRICS_SCHEMA_V1 = `import { bigint, numeric, schema, table, timestamptz, uuid } from "hejbro";

export const app = schema("app");
export const metrics = table(app, "metrics", {
	id: uuid().primaryKey().defaultRandom(),
	bigCount: bigint(),
	amount: numeric(),
	observedAt: timestamptz(),
});
`;

/** [task 9.3] Adds a column -- the schema repository's own next commit, what `outdated`/`vendor` are asked to notice. */
const METRICS_SCHEMA_V2 = `import { bigint, numeric, schema, table, text, timestamptz, uuid } from "hejbro";

export const app = schema("app");
export const metrics = table(app, "metrics", {
	id: uuid().primaryKey().defaultRandom(),
	bigCount: bigint(),
	amount: numeric(),
	observedAt: timestamptz(),
	label: text(),
});
`;

/**
 * [add-unmanaged-objects, 3.2] `authUsers` is `@hejbro/supabase`'s own
 * `existingTable()` (`packages/supabase/src/auth-tables.ts`) -- real
 * usage, not a stand-in -- exported here (a real declaration, group 1),
 * with a managed table's foreign key onto it. `createCliFixtureDir()`
 * already symlinks `node_modules/@hejbro/supabase` into every fixture
 * for exactly this import (`support/cli-runner.ts`'s own doc comment).
 */
const AUTH_JOIN_SCHEMA = `import { authUsers } from "@hejbro/supabase";
import { schema, table, uuid } from "hejbro";

export { authUsers };

export const app = schema("app");
export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	authorId: uuid().notNull().references(() => authUsers.id),
});
`;

/** [mutant, add-unmanaged-objects 3.2] The identical schema, `authUsers` built and referenced but never re-exported -- the undeclared axis, matching what a schema repository looks like today (before this task). */
const AUTH_JOIN_SCHEMA_UNDECLARED = `import { authUsers } from "@hejbro/supabase";
import { schema, table, uuid } from "hejbro";

export const app = schema("app");
export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	authorId: uuid().notNull().references(() => authUsers.id),
});
`;

/**
 * Writes the schema declaration, `generate --export`s it, and commits
 * everything -- the schema repository's own one lifecycle step, reused
 * for its first commit (9.1's fixture) and its second (9.3's staleness
 * fixture). Asserts `generate --export`'s own exit code rather than
 * leaving a silent failure for a later `vendor` call to surface
 * confusingly.
 */
const commitSchemaExport = async (
	schemaRepo: string,
	source: string,
	message: string,
): Promise<void> => {
	await writeFixtureFile(schemaRepo, "src/app.schema.ts", source);
	const generate = await runCli(schemaRepo, ["generate", "--export"]);
	if (generate.exitCode !== 0) {
		throw new Error(
			`fixture setup: \`hejbro generate --export\` failed in the schema repository:\n${generate.stderr}`,
		);
	}
	runGit(schemaRepo, ["add", "-A"]);
	runGit(schemaRepo, ["commit", "-q", "-m", message]);
};

describe("two-repository witness (#602)", () => {
	const container = `hejbro-cli-two-repo-${process.pid}`;
	let hostPort = "";
	const hostUrl = (database: string): string =>
		`postgres://postgres@127.0.0.1:${hostPort}/${database}`;

	beforeAll(async () => {
		assertBuiltCli();
		if (!dockerAvailable()) {
			throw new Error(
				`packages/cli's two-repository witness needs a running Docker daemon (Docker Desktop, or colima: \`colima start\`) -- \`docker info\` failed. Next: start Docker and re-run \`pnpm --filter hejbro test:integration\`.`,
			);
		}
		execFileSync(
			"docker",
			[
				"run",
				"-d",
				"--name",
				container,
				"-e",
				"POSTGRES_PASSWORD=postgres",
				"-e",
				"POSTGRES_HOST_AUTH_METHOD=trust",
				"-p",
				"127.0.0.1::5432",
				IMAGE,
			],
			{ stdio: "ignore" },
		);
		await waitUntilReady(container, 60);
		hostPort = containerPort(container);
	}, 120_000);

	afterAll(() => {
		execFileSync("docker", ["rm", "-f", "-v", container], { stdio: "ignore" });
	});

	let schemaRepo: string;
	let consumerRepo: string;

	beforeEach(async () => {
		schemaRepo = await createCliFixtureDir();
		consumerRepo = await createCliFixtureDir();
		initGitRepo(schemaRepo);
	});

	afterEach(async () => {
		await removeCliFixtureDir(schemaRepo);
		await removeCliFixtureDir(consumerRepo);
	});

	it("9.1: a consumer repository vendors the schema it was given", async () => {
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await commitSchemaExport(schemaRepo, METRICS_SCHEMA_V1, "initial export");

		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const vendor = await runCli(consumerRepo, ["vendor"]);
		expect(vendor.exitCode).toBe(0);

		// "Vendoring pins what it read" (schema-vendoring spec): all three
		// files land, and the lock records the commit they came from.
		const contractSource = await readFile(
			vendorContractPath(consumerRepo),
			"utf8",
		);
		expect(contractSource).toContain("export interface Database");
		expect(contractSource).toContain("metrics");
		const sqlSource = await readFile(vendorSqlPath(consumerRepo), "utf8");
		expect(sqlSource.toLowerCase()).toContain("create table");
		expect(sqlSource.toLowerCase()).toContain("metrics");

		const lock = readLock(consumerRepo);
		expect(lock).not.toBeNull();
		expect(lock?.commit).toBeDefined();
	});

	/**
	 * [task 9.2] What a mocked driver cannot establish (proposal's own
	 * measurement protocol, inherited): row conversion off a **real**
	 * driver's wire format. `bigCount` beyond `Number.MAX_SAFE_INTEGER`
	 * proves the value survives as a genuine JS `bigint`, not a
	 * float-rounded approximation a mock could fake by construction;
	 * `amount` carries more significant digits than a JS `number` can
	 * hold exactly, proving Postgres's own numeric text arrives unparsed
	 * as a string, never coerced through a lossy float; `observedAt`
	 * round-trips a specific non-UTC offset through Postgres's own
	 * `timestamptz` storage (which normalizes to UTC) back to the exact
	 * same instant, proving the driver's real datetime decoding, not a
	 * hand-fed `Date`.
	 */
	it("9.2: the consumer raises its database from the vendored SQL and runs a typed query through the contract, decoding bigint/numeric/timestamptz off the real driver's wire format", async () => {
		const database = "two_repo_9_2";
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await commitSchemaExport(schemaRepo, METRICS_SCHEMA_V1, "initial export");
		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const vendor = await runCli(consumerRepo, ["vendor"]);
		expect(vendor.exitCode).toBe(0);

		psqlCommand(container, "postgres", `create database ${database};`);
		const raise = await runCli(consumerRepo, [
			"raise",
			"--file",
			".hejbro/vendor/snapshot.sql",
			"--url",
			hostUrl(database),
		]);
		expect(raise.exitCode).toBe(0);

		const bigCount = 9_007_199_254_740_993n; // 2^53 + 1 -- beyond float64 exact-integer range
		const amount = "12345678901234567890.123456789"; // more significant digits than a JS number holds exactly
		const observedAtInput = "2026-01-01T00:00:00+09:00";

		const driver = pgDriver(hostUrl(database));
		try {
			// Seeds the row via a raw, parameterized insert directly on the
			// driver -- the name-keyed client's own `insert()` never issues a
			// `RETURNING` clause (`@hejbro/query`'s own documented shape,
			// `chain.ts`'s `InsertChainFinal` doc comment: "resolves the same
			// way at runtime: an empty array, since neither issues a SQL
			// RETURNING clause"), so it cannot itself hand back what a real
			// driver decoded. The read half below (`select()`) is the
			// contract's own typed query this task asks for; what it reads
			// back is real Postgres storage, written moments earlier by the
			// same real driver this test uses throughout -- never a value
			// this test fabricated in JS.
			await driver.execute({
				sql: 'insert into "app"."metrics" ("big_count", "amount", "observed_at") values ($1, $2, $3)',
				params: [String(bigCount), amount, observedAtInput],
				kind: "sql",
			});

			const jiti = createJiti(consumerRepo);
			const contractModule = (await jiti.import(
				vendorContractPath(consumerRepo),
			)) as ContractModule;
			const client = contractModule.createDb(driver);

			const rows = await client.metrics.select();
			const [selected] = rows;
			if (selected === undefined) {
				throw new Error("expected select() to return the row just inserted");
			}
			expect(rows).toHaveLength(1);
			expect(typeof selected.bigCount).toBe("bigint");
			expect(selected.bigCount).toBe(bigCount);
			expect(selected.amount).toBe(amount);
			expect(selected.observedAt.getTime()).toBe(
				new Date(observedAtInput).getTime(),
			);
		} finally {
			await driver.client.end();
		}
	});

	/** [task 9.3] `outdated` is advisory (schema-vendoring spec, "Being behind is advice, not failure") and `vendor` pins the update as a diff a reviewer can see. */
	it("9.3: reports staleness as advice, then vendors the update as an observable diff", async () => {
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await commitSchemaExport(schemaRepo, METRICS_SCHEMA_V1, "initial export");
		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const firstVendor = await runCli(consumerRepo, ["vendor"]);
		expect(firstVendor.exitCode).toBe(0);
		const firstLock = readLock(consumerRepo);
		const firstSql = await readFile(vendorSqlPath(consumerRepo), "utf8");
		expect(firstSql).not.toContain("label");

		await commitSchemaExport(schemaRepo, METRICS_SCHEMA_V2, "add label column");

		const outdated = await runCli(consumerRepo, ["outdated"]);
		// Advisory: reports without failing (schema-vendoring spec).
		expect(outdated.exitCode).toBe(0);
		expect(outdated.stdout).toContain("a newer commit is available");

		const secondVendor = await runCli(consumerRepo, ["vendor"]);
		expect(secondVendor.exitCode).toBe(0);
		const secondLock = readLock(consumerRepo);
		const secondSql = await readFile(vendorSqlPath(consumerRepo), "utf8");

		expect(secondLock?.commit).not.toBe(firstLock?.commit);
		// The update is an observable diff, not a silent overwrite: the new
		// commit's own squashed SQL names the column the old one never had.
		expect(secondSql).toContain("label");
		expect(secondSql).not.toBe(firstSql);
	});

	/**
	 * [add-unmanaged-objects, 3.2] Hydrates `auth.users` **before**
	 * `raise` runs -- existing by definition, hejbro never creates it
	 * (`isExistingSide`'s DDL-blocking guard, group 1), so the platform
	 * that owns it has to exist first, the same "seed before migrations"
	 * slot `examples/postgres`'s own integration harness uses for
	 * `seed/roles.sql` (R1-04) -- here inlined via the same `psqlCommand`
	 * this file already uses for `create database` (9.2), rather than a
	 * new seed-file mechanism (R1-05: no new harness).
	 */
	const hydrateAuthUsers = (database: string): void => {
		psqlCommand(
			container,
			database,
			'create schema "auth"; create table "auth"."users" ("id" uuid primary key, "email" text);',
		);
	};

	/**
	 * [add-unmanaged-objects, 3.2] The delta's own narrowed requirement
	 * (D106/owner judgement, R1-09 — "expose it for reading like any
	 * other table"; following the relation from the client is out of
	 * scope, #653): the vendored file alone reads a declared existing
	 * table's real rows, and a managed table's FK onto it inserts
	 * successfully against the hydrated row -- the real-server question
	 * this witness uniquely answers (a mock driver can't prove a
	 * constraint actually holds against live data).
	 */
	it("3.2: the vendored client reads a declared existing table's real rows, and a managed FK onto it inserts successfully", async () => {
		const database = "two_repo_3_2";
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await commitSchemaExport(schemaRepo, AUTH_JOIN_SCHEMA, "initial export");
		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const vendor = await runCli(consumerRepo, ["vendor"]);
		expect(vendor.exitCode).toBe(0);

		psqlCommand(container, "postgres", `create database ${database};`);
		hydrateAuthUsers(database);
		const raise = await runCli(consumerRepo, [
			"raise",
			"--file",
			".hejbro/vendor/snapshot.sql",
			"--url",
			hostUrl(database),
		]);
		expect(raise.exitCode).toBe(0);

		const userId = "11111111-1111-1111-1111-111111111111";
		const userEmail = "user@example.com";

		const driver = pgDriver(hostUrl(database));
		try {
			await driver.execute({
				sql: 'insert into "auth"."users" ("id", "email") values ($1, $2)',
				params: [userId, userEmail],
				kind: "sql",
			});

			const jiti = createJiti(consumerRepo);
			const contractModule = (await jiti.import(
				vendorContractPath(consumerRepo),
			)) as AuthJoinContractModule;
			const client = contractModule.createDb(driver);

			// Read alone, plainly -- "the name-keyed client SHALL expose
			// it for reading like any other table."
			const users = await client.users.select();
			expect(users).toHaveLength(1);
			expect(users[0]?.id).toBe(userId);
			expect(users[0]?.email).toBe(userEmail);

			// A managed table's FK onto the existing one inserts
			// successfully against the real, hydrated row.
			await driver.execute({
				sql: 'insert into "app"."posts" ("author_id") values ($1)',
				params: [userId],
				kind: "sql",
			});
			const posts = await client.posts.select();
			expect(posts).toHaveLength(1);
			expect(posts[0]?.authorId).toBe(userId);
		} finally {
			await driver.client.end();
		}
	});

	/**
	 * [mutant, add-unmanaged-objects 3.2] The undeclared axis's own
	 * real-server half -- measured, not assumed, per R1-09's explicit
	 * instruction not to force a red that isn't there. The FK constraint
	 * lives on `posts`'s own managed declaration (`.references(() =>
	 * authUsers.id)`), independent of whether `authUsers` itself is
	 * separately exported, and Postgres enforces a constraint against
	 * whatever physically exists, not against what hejbro declared -- so
	 * the insert is measured to still succeed here. What genuinely
	 * differs on this axis is the *contract* (no relation, 3.1's own
	 * pin) and the *type* (`vendoredHandle.users` doesn't exist,
	 * `vendored-contract.test.ts`'s own pin) -- this test pins the
	 * real-server side's own, different answer: unchanged.
	 */
	it("3.2 mutant, real-server half: an undeclared authUsers still lets the FK insert succeed (measured, not the axis that changes here)", async () => {
		const database = "two_repo_3_2_undeclared";
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await commitSchemaExport(
			schemaRepo,
			AUTH_JOIN_SCHEMA_UNDECLARED,
			"initial export",
		);
		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const vendor = await runCli(consumerRepo, ["vendor"]);
		expect(vendor.exitCode).toBe(0);

		psqlCommand(container, "postgres", `create database ${database};`);
		hydrateAuthUsers(database);
		const raise = await runCli(consumerRepo, [
			"raise",
			"--file",
			".hejbro/vendor/snapshot.sql",
			"--url",
			hostUrl(database),
		]);
		expect(raise.exitCode).toBe(0);

		const userId = "22222222-2222-2222-2222-222222222222";
		const driver = pgDriver(hostUrl(database));
		try {
			await driver.execute({
				sql: 'insert into "auth"."users" ("id", "email") values ($1, $2)',
				params: [userId, "still-a-real-row@example.com"],
				kind: "sql",
			});
			await driver.execute({
				sql: 'insert into "app"."posts" ("author_id") values ($1)',
				params: [userId],
				kind: "sql",
			});
			const rows = await driver.execute({
				sql: 'select "author_id" from "app"."posts"',
				params: [],
				kind: "sql",
			});
			expect(rows).toHaveLength(1);
		} finally {
			await driver.client.end();
		}
	});
});

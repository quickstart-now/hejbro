import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pgDriver } from "@hejbro/pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

/**
 * The apply engine's own live witness (group 8, #614) -- every earlier
 * group fixed a *structure* against a fake driver; nothing until this
 * file has proven any of it means what it says against a real server.
 * Never runs under `pnpm test`/CI (Docker-gated, local-only:
 * `pnpm --filter hejbro test:integration`), mirroring `check-live.
 * integration.test.ts`'s own idiom.
 *
 * **Two images, not one**: the declared floor (PostgreSQL 15 -- measured
 * the hard way, task 8.2's own finding: the example chain's first file
 * failed on 14 with `22023 security_invoker`, a view option that arrived
 * in 15) and 17. A supported version with no witness is a promise about
 * a version nobody ran (proposal, measurement protocol). Both witness
 * forms live here, per file, for the same reason `check-live.
 * integration.test.ts` uses both: **in-process** (a real `pgDriver`
 * called directly) for facts a report's text is never obliged to expose
 * (how many rows the ledger actually holds, whether the schema is
 * genuinely untouched after a failure); **a spawned CLI** (`runCli`) for
 * the contract that exists only in a process (exit codes, argv actually
 * reaching the command).
 */
const EXAMPLE_DIR = resolve(import.meta.dirname, "../../../examples/postgres");

const PG_IMAGES = ["postgres:15-alpine", "postgres:17-alpine"] as const;

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

/**
 * Same two-occurrence wait `check-live.integration.test.ts` measured and
 * fixed (#361-class scar this file inherits rather than re-discovers):
 * the postgres image's entrypoint answers "ready" once for its own
 * temporary bootstrap server, then again for the real one -- waiting for
 * the first occurrence alone races the restart in between. Two images in
 * this file doubles the exposure the comparable change's own estimate
 * (9m planned, 35m spent, entirely on this) already warned about.
 */
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

const psqlFile = (container: string, database: string, sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			"-i",
			container,
			"psql",
			"-U",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-d",
			database,
		],
		{ input: sql, stdio: ["pipe", "ignore", "inherit"] },
	);
};

// `hejbro init` scaffolds `hejbro.config.ts` itself -- these fixtures
// only ever supply the declaration file `init`'s own template expects.
const SEED_SCHEMA_SOURCE = `import { schema, table, uuid } from "hejbro";

export const app = schema("app");
export const seed = table(app, "seed", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

/** [task 8.3] Two brand-new tables in one generate run -- a real,
 * two-statement migration file the fixture measures the statement order
 * of, rather than assumes. */
const TWO_TABLES_SCHEMA_SOURCE = `import { schema, table, uuid } from "hejbro";

export const app = schema("app");
export const seed = table(app, "seed", {
	id: uuid().primaryKey().defaultRandom(),
});
export const aWidgets = table(app, "a_widgets", {
	id: uuid().primaryKey().defaultRandom(),
});
export const zGadgets = table(app, "z_gadgets", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

const ENUM_V1_SOURCE = `import { pgEnum, schema } from "hejbro";

export const app = schema("app");
export const mood = pgEnum(app, "mood", ["ok"]);
`;

/** [task 8.4] Adds a value to an already-live enum -- the one statement (`alter type ... add value`) this project emits that a transaction block can refuse, and (per the proposal's own measurement protocol) never yet applied to a real server. */
const ENUM_V2_SOURCE = `import { pgEnum, schema } from "hejbro";

export const app = schema("app");
export const mood = pgEnum(app, "mood", ["ok", "great"]);
`;

/** [task 8.4] A further, unrelated change (a new table) -- what the two racing runners below actually contend to apply; the enum-value migration above is already settled by the time this test runs. */
const ENUM_V3_SOURCE = `import { pgEnum, schema, table, uuid } from "hejbro";

export const app = schema("app");
export const mood = pgEnum(app, "mood", ["ok", "great"]);
export const races = table(app, "races", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

/** [task 19.4, D106 M4] A table whose check constraint will, in the next version below, spell the enum value added alongside it -- via `sql.raw`, not a typed default, so it is the split rule's raw-text reach (task 19.2) that has to see it, not `isMatchingLiteral` (already proven live by 8.4 above). */
const SPLIT_RAW_TEXT_V1_SOURCE = `import { pgEnum, schema, table, text, uuid } from "hejbro";

export const app = schema("app");
export const mood = pgEnum(app, "mood", ["ok"]);
export const widgets = table(app, "widgets", {
	id: uuid().primaryKey().defaultRandom(),
	status: text(),
});
`;

/**
 * [task 19.4, D106 M4] Adds "great" to the enum AND, in the same
 * declaration change, a check constraint spelling it via `sql.raw` --
 * `expr/codec.ts`'s own `{ nodeKind: "raw-sql", sql }`, a shape
 * `isMatchingLiteral` never reaches. The report this task closes marked
 * this UNVERIFIED by execution: without task 19.2, `planSplit`'s walk
 * cannot see this reference, so `generate` writes one file carrying both
 * the new enum value and its own use, and the server refuses it exactly
 * the way the hand-written fixture above (`measurement protocol: the
 * 55P04 translation`) demonstrates. With 19.2, the walk reaches the
 * check constraint's raw text, `planSplit` reports a trigger, and
 * `generate` writes two files instead.
 */
const SPLIT_RAW_TEXT_V2_SOURCE = `import { check, pgEnum, schema, sql, table, text, uuid } from "hejbro";

export const app = schema("app");
export const mood = pgEnum(app, "mood", ["ok", "great"]);
export const widgets = table(
	app,
	"widgets",
	{
		id: uuid().primaryKey().defaultRandom(),
		status: text(),
	},
	() => ({
		checks: [check("widgets_status_check", sql.raw("status = 'great'"))],
	}),
);
`;

describe.each(PG_IMAGES)("apply engine live witness / %s", (image) => {
	const container = `hejbro-cli-apply-${process.pid}-${image.replace(/[^a-z0-9]/gi, "")}`;
	let hostPort = "";
	const hostUrl = (database: string): string =>
		`postgres://postgres@127.0.0.1:${hostPort}/${database}`;

	beforeAll(async () => {
		assertBuiltCli();
		if (!dockerAvailable()) {
			throw new Error(
				`packages/cli's apply-engine live-witness suite needs a running Docker daemon (Docker Desktop, or colima: \`colima start\`) -- \`docker info\` failed. Next: start Docker and re-run \`pnpm --filter hejbro test:integration\`.`,
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
				image,
			],
			{ stdio: "ignore" },
		);
		await waitUntilReady(container, 60);
		hostPort = containerPort(container);
	}, 120_000);

	afterAll(() => {
		execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
	});

	describe("8.1/8.2 the whole example chain", () => {
		const database = "chain";

		beforeAll(() => {
			psqlCommand(container, "postgres", `create database ${database};`);
			// The example's own grants target cluster-level roles that
			// hejbro's declarations never create (roles are outside its
			// declaration surface, seed/roles.sql's own comment) -- without
			// this, 0001's own first migration fails on a role that does not
			// exist yet, measured directly (`42704`).
			psqlFile(
				container,
				database,
				readFileSync(resolve(EXAMPLE_DIR, "seed/roles.sql"), "utf-8"),
			);
		});

		it("applies a migration against a real server on each supported major (8.1)", async () => {
			const result = await runCli(EXAMPLE_DIR, [
				"migrate",
				"--url",
				hostUrl(database),
			]);

			expect(result.exitCode).toBe(0);
		});

		it("applies every migration in the example chain (8.2)", async () => {
			const migrationsDir = resolve(EXAMPLE_DIR, "migrations");
			const fileCount = readdirSync(migrationsDir).filter((name) =>
				name.endsWith(".sql"),
			).length;

			// The 8.1 test already ran `migrate` once against this same
			// database; migrate is idempotent (nothing left pending), so this
			// second run's own report is the "nothing to apply" line, not a
			// second count of 9 -- the ledger (queried below, not the report)
			// is the fact this task actually asks for.
			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: 'select count(*) as count from "hejbro"."migration_ledger"',
					params: [],
					kind: "sql",
				});
				// The ledger holds one row per migration (8.2's own second
				// claim) -- a witness that only checked "no complaints" could
				// not tell 9 applied from 0.
				expect(Number(rows[0]?.count)).toBe(fileCount);
			} finally {
				await driver.client.end();
			}
		});
	});

	describe("8.3 a failed migration changes nothing", () => {
		const database = "partial";
		let cwd = "";
		let secondFileName = "";

		beforeAll(async () => {
			cwd = await createCliFixtureDir();
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/app.schema.ts", SEED_SCHEMA_SOURCE);
			await runCli(cwd, ["generate"]);

			psqlCommand(container, "postgres", `create database ${database};`);
			const first = await runCli(cwd, ["migrate", "--url", hostUrl(database)]);
			if (first.exitCode !== 0) {
				throw new Error(
					`fixture setup's own first migrate failed: ${first.stderr}`,
				);
			}

			// Two NEW tables in one generate run -- a real, two-statement
			// migration file, not a hand-assembled one (measurement protocol:
			// the fixture is built, not merely described in prose).
			await writeFixtureFile(
				cwd,
				"src/app.schema.ts",
				TWO_TABLES_SCHEMA_SOURCE,
			);
			await runCli(cwd, ["generate"]);
			const migrationsDir = resolve(cwd, "migrations");
			const fileNames = readdirSync(migrationsDir)
				.filter((name) => name.endsWith(".sql"))
				.sort();
			secondFileName = fileNames[1] ?? "";
			const secondFileText = readFileSync(
				resolve(migrationsDir, secondFileName),
				"utf-8",
			);
			// Measured, not assumed: confirms which table's own `create table`
			// is the file's SECOND statement, so the pre-collision below lands
			// on the statement this task asks to fail, not the first one.
			const aIndex = secondFileText.indexOf('"app"."a_widgets"');
			const zIndex = secondFileText.indexOf('"app"."z_gadgets"');
			if (aIndex === -1 || zIndex === -1 || !(aIndex < zIndex)) {
				throw new Error(
					`fixture assumption broke: expected a_widgets' own create before z_gadgets' own in ${secondFileName}, got:\n${secondFileText}`,
				);
			}

			// Pre-collide the SECOND statement's own object, live -- the first
			// statement (a_widgets) is left free to succeed.
			psqlCommand(
				container,
				database,
				'create table "app"."z_gadgets" (id uuid primary key);',
			);
		}, 60_000);

		afterAll(async () => {
			await removeCliFixtureDir(cwd);
		});

		it("a failed migration changes nothing", async () => {
			const result = await runCli(cwd, ["migrate", "--url", hostUrl(database)]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(secondFileName);
			expect(result.stderr).toContain("error[apply-failed]");
			// The report names the next command (proposal's own failure
			// contract).
			expect(result.stderr).toContain("hejbro migrate");
			expect(result.stderr).toMatch(/Next:/);

			const driver = pgDriver(hostUrl(database));
			try {
				// The schema is unchanged: a_widgets' own create was the first
				// statement in the SAME multi-statement query the second
				// statement failed inside -- proving it did not survive the
				// rollback is the whole point of this task, not an assumption
				// carried over from the fake-driver suite.
				const widgets = await driver.execute({
					sql: "select to_regclass('app.a_widgets') as reg",
					params: [],
					kind: "sql",
				});
				expect(widgets[0]?.reg).toBeNull();

				// The ledger is unchanged: only the first migration's own row,
				// never a row for the one that failed.
				const rows = await driver.execute({
					sql: 'select "filename" from "hejbro"."migration_ledger" order by "id"',
					params: [],
					kind: "sql",
				});
				expect(rows.map((row) => row.filename)).toHaveLength(1);
				expect(rows.some((row) => row.filename === secondFileName)).toBe(false);
			} finally {
				await driver.client.end();
			}
		});
	});

	describe("8.4 the enum value never applied to a real server before, and a race", () => {
		const database = "enumdb";
		let cwd = "";

		beforeAll(async () => {
			cwd = await createCliFixtureDir();
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/app.schema.ts", ENUM_V1_SOURCE);
			await runCli(cwd, ["generate"]);

			psqlCommand(container, "postgres", `create database ${database};`);
			const first = await runCli(cwd, ["migrate", "--url", hostUrl(database)]);
			if (first.exitCode !== 0) {
				throw new Error(
					`fixture setup's own first migrate failed: ${first.stderr}`,
				);
			}
		}, 60_000);

		afterAll(async () => {
			await removeCliFixtureDir(cwd);
		});

		it("applies a migration that adds an enum value", async () => {
			await writeFixtureFile(cwd, "src/app.schema.ts", ENUM_V2_SOURCE);
			const generated = await runCli(cwd, ["generate"]);
			expect(generated.exitCode).toBe(0);

			const result = await runCli(cwd, ["migrate", "--url", hostUrl(database)]);

			expect(result.exitCode).toBe(0);

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: "select unnest(enum_range(null::app.mood))::text as value",
					params: [],
					kind: "sql",
				});
				expect(rows.map((row) => row.value)).toEqual(["ok", "great"]);
			} finally {
				await driver.client.end();
			}
		});

		// The spec's own guarantee here (migration-apply, "A second runner
		// waits"): "one applies while the other waits; the one that waited
		// then applies only what the ledger does not record at the moment
		// it holds the lock, and neither run fails". This test's own first
		// draft asserted exactly that (`[0, 0]`) and was measured wrong at
		// the time -- the implementation computed each runner's `pending`
		// plan before the lock, so the loser re-attempted DDL the winner
		// had already committed and took the server's own already-exists
		// refusal. That gap is task 11.1's own fix (#620): `applyMigration`
		// now rechecks the ledger for this exact filename inside the same
		// lock and the same transaction it just acquired, before sending
		// anything -- so there is no window left in which the loser's plan
		// can still be stale by the time it acts. This test is the original
		// draft, restored now that the implementation can actually meet it.
		it("a second runner waits for the first; the one that waited applies only what the ledger does not yet record, and neither run fails", async () => {
			await writeFixtureFile(cwd, "src/app.schema.ts", ENUM_V3_SOURCE);
			const generated = await runCli(cwd, ["generate"]);
			expect(generated.exitCode).toBe(0);
			const migrationsDir = resolve(cwd, "migrations");
			const pendingFileName = readdirSync(migrationsDir)
				.filter((name) => name.endsWith(".sql"))
				.sort()
				.at(-1);

			const results = await Promise.all([
				runCli(cwd, ["migrate", "--url", hostUrl(database)]),
				runCli(cwd, ["migrate", "--url", hostUrl(database)]),
			]);

			// Neither run fails (task 11.1) -- the lock still serializes them,
			// but the one that waited now finds the file already recorded and
			// reports that instead of re-sending DDL.
			expect(results.every((result) => result.exitCode === 0)).toBe(true);

			// The report tells the two runs apart (task 11.2): exactly one of
			// them applied the file itself, and exactly one of them found it
			// already applied while it waited -- never both silent about it,
			// never both claiming to have applied it.
			const appliedCount = results.filter((result) =>
				result.stdout.includes("migrate: applied 1 migration(s):"),
			).length;
			const waitedCount = results.filter((result) =>
				result.stdout.includes(
					"migrate: 1 migration(s) another run already applied while this one waited:",
				),
			).length;
			expect(appliedCount).toBe(1);
			expect(waitedCount).toBe(1);

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: 'select "filename" from "hejbro"."migration_ledger" order by "id"',
					params: [],
					kind: "sql",
				});
				const fileNames = rows.map((row) => String(row.filename));
				// Never applies a migration the other has already applied
				// (the spec's own words): exactly one row for the file both
				// runners raced on, not zero (lost) and not two (duplicated).
				expect(
					fileNames.filter((name) => name === pendingFileName),
				).toHaveLength(1);
			} finally {
				await driver.client.end();
			}
		});
	});

	/**
	 * [task 12.3, #624] The requirement group 12 found unimplemented
	 * (migration-apply spec, "A baseline is registered rather than run"):
	 * a chain whose first migration carries the `-- baseline:` marker,
	 * applied to a database that already has the objects that migration
	 * would create -- exactly the brownfield-adoption shape
	 * `brownfield-adoption.md` describes. Before 12.1/12.2's own repair,
	 * this test failed for the right reason: `migrate` sent the baseline
	 * file's DDL like any other pending file, and the server refused it on
	 * the first statement (measured on this exact fixture, pre-repair:
	 * `error[apply-failed]: applying "..." failed (42P06): schema "app"
	 * already exists`) -- the opposite of the scenario ("no statement from
	 * that migration is sent"). Red, and its own contrast
	 * with task 1.4's red (tasks.md's own group 12 note): 1.4's red name
	 * claimed this behavior and its body proved only a function's shape;
	 * this one is the server itself refusing the wrong thing.
	 */
	describe("12.3 registering a baseline against a database that already has its objects", () => {
		const database = "baselinedb";
		let cwd = "";

		beforeAll(async () => {
			cwd = await createCliFixtureDir();
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/app.schema.ts", SEED_SCHEMA_SOURCE);
			const baselined = await runCli(cwd, ["baseline"]);
			if (baselined.exitCode !== 0) {
				throw new Error(
					`fixture setup's own \`hejbro baseline\` failed: ${baselined.stderr}`,
				);
			}

			// Simulates an already-adopted database: the object the baseline
			// migration would create already exists, set up directly rather
			// than through hejbro (mirroring how a real brownfield database
			// got its objects -- never through this tool).
			psqlCommand(container, "postgres", `create database ${database};`);
			psqlCommand(container, database, 'create schema "app";');
			psqlCommand(
				container,
				database,
				'create table "app"."seed" (id uuid primary key default gen_random_uuid());',
			);
		}, 60_000);

		afterAll(async () => {
			await removeCliFixtureDir(cwd);
		});

		it("registers a baseline against a database that already has its objects", async () => {
			const result = await runCli(cwd, ["migrate", "--url", hostUrl(database)]);

			// The repair's own proof: sending the baseline file's DDL against
			// objects that already exist would fail (42P07, measured above,
			// pre-repair) -- exit 0 here means it genuinely was not sent.
			expect(result.exitCode).toBe(0);

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: 'select "filename" from "hejbro"."migration_ledger" order by "id"',
					params: [],
					kind: "sql",
				});
				const fileNames = rows.map((row) => String(row.filename));
				expect(fileNames).toHaveLength(1);
				expect(fileNames[0]).toMatch(/\.sql$/);
			} finally {
				await driver.client.end();
			}
		});
	});

	/**
	 * [Measurement protocol] Two facts hejbro's own design decisions rest
	 * on, proven against a real server rather than assumed -- neither is a
	 * live witness of hejbro's OWN code path (its own guards already keep
	 * both from ever reaching the server in normal operation); both are
	 * live proof of the underlying Postgres behavior those guards exist to
	 * defend against. "Found by measurement rather than by reasoning"
	 * (proposal) -- bypasses `applyMigration`/`assertNoTransactionControl`
	 * on purpose, talking to the driver directly.
	 */
	describe("measurement protocol: the two silent breakages", () => {
		const database = "breakage";

		beforeAll(() => {
			psqlCommand(container, "postgres", `create database ${database};`);
			psqlCommand(container, database, 'create schema "app";');
		});

		it("a file carrying its own commit; splits the atomicity (the risk task 3.5's refusal exists to prevent)", async () => {
			const driver = pgDriver(hostUrl(database));
			try {
				await expect(
					driver.transaction((session) =>
						session.execute({
							sql: 'create table "app"."silent_break" (id integer); commit; select 1/0;',
							params: [],
							kind: "sql",
						}),
					),
				).rejects.toThrow();

				// The object the first statement created survives, even
				// though the overall call threw -- the inline `commit;`
				// already closed the transaction before the later statement
				// failed. This is exactly why hejbro's own generator never
				// emits one, and why a hand-edited file that does is refused
				// before anything is sent (`apply-transaction-control`,
				// proved with a fake driver in `apply-execute.test.ts`; this
				// is the live proof of the danger that refusal defends
				// against, not a repeat of that unit coverage).
				const rows = await driver.execute({
					sql: "select to_regclass('app.silent_break') as reg",
					params: [],
					kind: "sql",
				});
				expect(rows[0]?.reg).not.toBeNull();
			} finally {
				await driver.client.end();
			}
		});

		it("a parameterized multi-statement call is refused by the server (why applyMigration always sends params: [])", async () => {
			const driver = pgDriver(hostUrl(database));
			try {
				await expect(
					driver.execute({
						sql: 'create table "app"."should_not_exist" (id integer); select $1::int;',
						params: [1],
						kind: "sql",
					}),
				).rejects.toThrow();

				const rows = await driver.execute({
					sql: "select to_regclass('app.should_not_exist') as reg",
					params: [],
					kind: "sql",
				});
				expect(rows[0]?.reg).toBeNull();
			} finally {
				await driver.client.end();
			}
		});
	});

	/**
	 * [Measurement protocol] "Any server error text the diagnostics
	 * translate is measured on both versions" (proposal) -- the engine's
	 * one such translation is `55P04` (`apply-unsafe-new-enum-value`).
	 * Unreachable through `hejbro generate`'s own output (the split, group
	 * 4, exists specifically so a generated run never emits this
	 * combination) -- reached here the only way it can be: a hand-written
	 * file, the same way a pre-split-era file would have.
	 */
	describe("measurement protocol: the 55P04 translation", () => {
		const database = "unsafe55p04";

		beforeAll(() => {
			psqlCommand(container, "postgres", `create database ${database};`);
		});

		it("translates 55P04 against a real server", async () => {
			const cwd = await createCliFixtureDir();
			try {
				await runCli(cwd, ["init"]);
				await writeFixtureFile(cwd, "src/app.schema.ts", ENUM_V1_SOURCE);
				await runCli(cwd, ["generate"]);
				const first = await runCli(cwd, [
					"migrate",
					"--url",
					hostUrl(database),
				]);
				expect(first.exitCode).toBe(0);

				// Hand-written, not generated (generate refuses to produce
				// this as one file, task 4.3r) -- an enum value added and
				// used inside the same transaction, exactly what a
				// pre-split-era file looked like. Needs its own valid
				// parent-snapshot link (chained from 0001's own `snapshot:`
				// line) or `readChainEntries` silently skips it as
				// hash-less history, and `migrate` would never see it as
				// pending at all.
				const migrationsDir = resolve(cwd, "migrations");
				const firstFileName = readdirSync(migrationsDir).find((name) =>
					name.endsWith(".sql"),
				);
				if (firstFileName === undefined) {
					throw new Error("fixture setup's own first migration is missing");
				}
				const firstFileText = readFileSync(
					resolve(migrationsDir, firstFileName),
					"utf-8",
				);
				const parentHash = firstFileText.match(/^-- snapshot: (.+)$/m)?.[1];
				if (parentHash === undefined) {
					throw new Error(
						`could not read 0001's own "snapshot:" line from ${firstFileName}`,
					);
				}
				const banner = [
					"-- hejbro migration",
					`-- parent-snapshot: ${parentHash}`,
					"-- snapshot: sha256:0000000000000000000000000000000000000000000000000000000000000000",
				].join("\n");
				const statements = [
					'alter type "app"."mood" add value \'great\';',
					'create table "app"."moods" (id integer, value "app"."mood" default \'great\');',
				].join("\n\n");
				await writeFixtureFile(
					cwd,
					"migrations/99999999999999_unsafe.sql",
					`${banner}\n\n${statements}`,
				);

				const result = await runCli(cwd, [
					"migrate",
					"--url",
					hostUrl(database),
				]);

				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[apply-unsafe-new-enum-value]");
				expect(result.stderr).toMatch(/regenerate/i);
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});
	});

	/**
	 * [task 19.4, D106 M4] The live witness the D106 report marked
	 * UNVERIFIED by execution -- a *generated* run (never hand-written)
	 * that adds an enum value and, in the same change, a check constraint
	 * spelling it via `sql.raw`. Proves task 19.2's raw-text reach against
	 * a real server: `generate` itself must decide to split, not merely
	 * refuse a pre-split file the way `apply-unsafe-new-enum-value` above
	 * does.
	 */
	describe("19.4 (D106 M4) a generated run splits an enum value spelled in a raw-SQL check", () => {
		const database = "splitrawtext";

		beforeAll(() => {
			psqlCommand(container, "postgres", `create database ${database};`);
		});

		it("writes two migrations instead of one, and both apply", async () => {
			const cwd = await createCliFixtureDir();
			try {
				await runCli(cwd, ["init"]);
				await writeFixtureFile(
					cwd,
					"src/app.schema.ts",
					SPLIT_RAW_TEXT_V1_SOURCE,
				);
				const first = await runCli(cwd, ["generate"]);
				expect(first.exitCode).toBe(0);
				const firstMigrate = await runCli(cwd, [
					"migrate",
					"--url",
					hostUrl(database),
				]);
				expect(firstMigrate.exitCode).toBe(0);

				const migrationsDir = resolve(cwd, "migrations");
				const countSqlFiles = (): number =>
					readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))
						.length;
				const beforeCount = countSqlFiles();

				await writeFixtureFile(
					cwd,
					"src/app.schema.ts",
					SPLIT_RAW_TEXT_V2_SOURCE,
				);
				const generated = await runCli(cwd, ["generate"]);
				expect(generated.exitCode).toBe(0);

				// task 19.2's own proof, live: without the raw-text reach,
				// `planSplit` never sees the check constraint's own text, so
				// this run writes ONE file carrying both the new enum value
				// and its own use -- exactly the shape the server refuses
				// with 55P04 (the sibling test above shows this same
				// refusal on a hand-written file). With it, TWO files.
				expect(countSqlFiles() - beforeCount).toBe(2);

				const result = await runCli(cwd, [
					"migrate",
					"--url",
					hostUrl(database),
				]);

				// Both migrations apply cleanly -- the enum-adding one commits
				// (and its own transaction ends) before the check-constraint
				// one, in its own later transaction, ever uses the value.
				expect(result.exitCode).toBe(0);

				const driver = pgDriver(hostUrl(database));
				try {
					const rows = await driver.execute({
						sql: "select unnest(enum_range(null::app.mood))::text as value",
						params: [],
						kind: "sql",
					});
					expect(rows.map((row) => row.value)).toEqual(["ok", "great"]);
				} finally {
					await driver.client.end();
				}
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});
	});
});

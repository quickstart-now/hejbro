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
		// waits"): "one applies while the other waits, and neither applies
		// a migration the other has already applied" -- it does NOT promise
		// both processes exit 0. Measured, not assumed (first draft of this
		// test asserted `[0, 0]` and was wrong): the loser's own `pending`
		// plan is computed before the winner's commit lands, so by the time
		// it acquires the lock the migration is already there -- it
		// genuinely re-attempts already-applied DDL and gets the server's
		// own already-exists refusal (`apply-failed`), not a graceful
		// no-op. Reported to the planner (DD's own still-open question,
		// `ledger.ts`: no code minted for "a second runner waits", task 7.4
		// names a lock only as an exit-code candidate, not settled) --
		// asserted here as what the spec actually promises, not smoothed
		// over to what a nicer contract might have said.
		it("a second runner waits for the first, and neither applies a migration the other already has", async () => {
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

			// Exactly one runner actually applied it; the lock serialized
			// them rather than letting both through concurrently.
			expect(results.filter((r) => r.exitCode === 0)).toHaveLength(1);
			expect(results.filter((r) => r.exitCode !== 0)).toHaveLength(1);

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
});

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pgDriver } from "@hejbro/pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeContainer } from "./docker-volumes";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

/**
 * [task 1.5, #753] `reset`'s own live witness -- tasks 1.1-1.4 proved the
 * drop order and the coded failure against a fake driver; nothing until
 * this file proves either means what it says against a real server.
 * Mirrors `live-witness.integration.test.ts`'s own image selection
 * (`HEJBRO_PG_IMAGE`, default `postgres:17-alpine`) and
 * docker-availability gating -- that file's own single-image matrix, not
 * `apply-live.integration.test.ts`'s PG 15/17 pair: reset's own
 * drop-order fix is core, dialect-independent SQL (a `drop table`/`drop
 * schema` ordering, never a version-gated feature the way 8.2's own
 * `security_invoker` was), so one image is enough evidence here.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-apply-reset-${process.pid}`;

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

const readyLogLineCount = (): number => {
	const logs = execFileSync("sh", ["-c", `docker logs ${CONTAINER} 2>&1`], {
		encoding: "utf-8",
	});
	return (logs.match(/database system is ready to accept connections/g) ?? [])
		.length;
};

const waitUntilReady = async (attemptsLeft: number): Promise<void> => {
	if (readyLogLineCount() >= 2) {
		return;
	}
	if (attemptsLeft <= 0) {
		throw new Error(
			`postgres in container "${CONTAINER}" never became ready. Next: check \`docker logs ${CONTAINER}\`.`,
		);
	}
	await sleep(300);
	return waitUntilReady(attemptsLeft - 1);
};

const containerPort = (): string => {
	const output = execFileSync("docker", ["port", CONTAINER, "5432/tcp"], {
		encoding: "utf-8",
	});
	const firstLine = (output.trim().split("\n")[0] ?? "").trim();
	const port = firstLine.split(":").at(-1);
	if (port === undefined || port === "") {
		throw new Error(
			`could not parse the host port docker mapped for container "${CONTAINER}" from: ${JSON.stringify(output)}`,
		);
	}
	return port;
};

const psqlCommand = (database: string, sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			CONTAINER,
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

/**
 * [task 4.1, D106 R1, B1, #753 reopened] Applies `sql` the same way
 * `psql -f` would, over `docker exec -i` -- standing in for "the project's
 * migrations were applied without `hejbro migrate` ever running" (the
 * skill's own documented external-pipeline apply path), so
 * `hejbro.migration_ledger` never gets bootstrapped. `execFileSync`'s own
 * `input` option feeds `sql` over `psql`'s stdin -- no file needs to exist
 * inside the container.
 */
const psqlApplySql = (database: string, sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			"-i",
			CONTAINER,
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

let hostPort = "";
const hostUrl = (database: string): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${database}`;

beforeAll(async () => {
	assertBuiltCli();
	if (!dockerAvailable()) {
		throw new Error(
			"reset's own live witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
		);
	}
	execFileSync(
		"docker",
		[
			"run",
			"-d",
			"--name",
			CONTAINER,
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
	await waitUntilReady(60);
	hostPort = containerPort();
}, 120_000);

afterAll(() => {
	removeContainer(CONTAINER);
});

// [task 1.5, #753] the exact shape #753 itself reported: two tables in
// their own schema, one referencing the other via a composite foreign
// key -- lab.tasks (tenant_id, project_id) references lab.projects
// (tenant_id, id).
const LAB_SCHEMA_SOURCE = `import { schema, table, uuid } from "hejbro";

export const lab = schema("lab");

export const projects = table(lab, "projects", {
	tenantId: uuid().primaryKey(),
	id: uuid().primaryKey().defaultRandom(),
});

export const tasks = table(
	lab,
	"tasks",
	{ tenantId: uuid(), projectId: uuid() },
	(t) => ({
		foreignKeys: [
			{
				columns: [t.tenantId, t.projectId],
				references: {
					table: projects,
					columns: [projects.tenantId, projects.id],
				},
			},
		],
	}),
);
`;

// [task 3.10, #753] A genuine two-table cycle -- cyc.left_t and
// cyc.right_t each reference the other. `table()`'s `extras`-style
// `foreignKeys` resolves `references: { table }` eagerly, so a mutual
// pair can't be built that way (each table would need the other's
// object to already exist); the column-level `.references(() => ...)`
// sugar (add-relational-reads, D102) defers the thunk to first read
// instead ("import-order safety", `packages/core/src/dsl/table.ts`),
// which is exactly what a mutual pair needs regardless of which table's
// `table()` call runs first.
const CYCLE_SCHEMA_SOURCE = `import { schema, table, uuid } from "hejbro";

export const cyc = schema("cyc");

export const leftT = table(cyc, "left_t", {
	id: uuid().primaryKey().defaultRandom(),
	rightId: uuid().references(() => rightT.id),
});

export const rightT = table(cyc, "right_t", {
	id: uuid().primaryKey().defaultRandom(),
	leftId: uuid().references(() => leftT.id),
});
`;

const CONFIRM_DROP_PATTERN = /--confirm-drop (\S+) to confirm/;

/**
 * Extracts the exact `<database>:<count>` confirmation `reset`'s own
 * refusal names, from a first, unconfirmed run's stderr -- rather than
 * re-deriving `planReset`'s own count in the test. The real CLI, driven
 * against the real database, is the only source of truth this witness
 * trusts.
 */
const extractRequiredConfirmation = (stderr: string): string => {
	const match = CONFIRM_DROP_PATTERN.exec(stderr);
	if (match === null) {
		throw new Error(
			`could not find the required --confirm-drop value in: ${stderr}`,
		);
	}
	return match[1] as string;
};

describe("hejbro reset — live witness (#753, task 1.5)", () => {
	it("drops a referencing/referenced pair and their schema cleanly, exits 0, and status reports the chain pending from its start afterward", async () => {
		const database = "reset_clean";
		psqlCommand("postgres", `create database ${database};`);
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/lab.schema.ts", LAB_SCHEMA_SOURCE);
			await runCli(cwd, ["generate"]);
			const migrate = await runCli(cwd, [
				"migrate",
				"--url",
				hostUrl(database),
			]);
			expect(migrate.exitCode).toBe(0);

			const refused = await runCli(cwd, ["reset", "--url", hostUrl(database)]);
			expect(refused.exitCode).toBe(1);
			const confirmation = extractRequiredConfirmation(refused.stderr);

			const result = await runCli(cwd, [
				"reset",
				"--url",
				hostUrl(database),
				"--confirm-drop",
				confirmation,
			]);
			expect(result.exitCode).toBe(0);

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: "select to_regclass('lab.tasks') as tasks, to_regclass('lab.projects') as projects, (select nspname from pg_namespace where nspname = 'lab') as lab_schema",
					params: [],
					kind: "sql",
				});
				expect(rows[0]?.tasks).toBeNull();
				expect(rows[0]?.projects).toBeNull();
				expect(rows[0]?.lab_schema).toBeNull();
			} finally {
				await driver.client.end();
			}

			const status = await runCli(cwd, ["status", "--url", hostUrl(database)]);
			expect(status.exitCode).toBe(0);
			expect(status.stdout).toContain("migration(s) pending:");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);

	it("fails a second reset even under the corrected drop order when something outside the declarations still depends on what's being dropped, reports the coded error, and leaves status showing every migration applied", async () => {
		const database = "reset_blocked";
		psqlCommand("postgres", `create database ${database};`);
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/lab.schema.ts", LAB_SCHEMA_SOURCE);
			await runCli(cwd, ["generate"]);
			const migrate = await runCli(cwd, [
				"migrate",
				"--url",
				hostUrl(database),
			]);
			expect(migrate.exitCode).toBe(0);

			// Something hejbro does not manage still depends on what's being
			// dropped -- standing in for "something outside the declarations
			// still depends on the one being dropped" (task 1.5's own second
			// case). Even the corrected drop order (tasks before projects)
			// can't satisfy this: projects is still referenced from outside
			// the declaration set entirely.
			psqlCommand(
				database,
				'create table "lab"."external_refs" (tenant_id uuid not null, project_id uuid not null, foreign key (tenant_id, project_id) references "lab"."projects" (tenant_id, id));',
			);

			const refused = await runCli(cwd, ["reset", "--url", hostUrl(database)]);
			expect(refused.exitCode).toBe(1);
			const confirmation = extractRequiredConfirmation(refused.stderr);

			const result = await runCli(cwd, [
				"reset",
				"--url",
				hostUrl(database),
				"--confirm-drop",
				confirmation,
			]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[reset-drop-failed]");
			// [D106 R1, N2, #753 reopened] The server's own DETAIL line names
			// the dependent (`external_refs`) -- exactly the one fact N2 found
			// missing from this same scenario's message before this fix.
			expect(result.stderr).toContain("external_refs");

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: "select to_regclass('lab.tasks') as tasks, to_regclass('lab.projects') as projects",
					params: [],
					kind: "sql",
				});
				// Nothing dropped -- the whole transaction rolled back.
				expect(rows[0]?.tasks).not.toBeNull();
				expect(rows[0]?.projects).not.toBeNull();
			} finally {
				await driver.client.end();
			}

			const status = await runCli(cwd, ["status", "--url", hostUrl(database)]);
			expect(status.exitCode).toBe(0);
			expect(status.stdout).toContain("recorded as applied:");
			expect(status.stdout).toContain("nothing pending");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);

	// [task 3.10, #753] The delta's cycle sentence -- "no order satisfies
	// both, so they drop in their existing identity order, and a
	// resulting refusal is reported through the coded failure" -- has no
	// real-Postgres witness yet: the unit rows fake the driver, and the
	// two cases above are an ordered pair and an outside-the-declarations
	// dependent. A mutual pair's creation is legal (both `create table`
	// statements land before either `add constraint`, on the deferred
	// stage); its drop, in either identity order, is not -- whichever
	// table drops first, the other's still-standing foreign key refuses
	// it.
	it("fails to drop a genuine two-table cycle even though creating it was legal, reports the coded error, and leaves status showing every migration applied", async () => {
		const database = "reset_cycle";
		psqlCommand("postgres", `create database ${database};`);
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/cycle.schema.ts", CYCLE_SCHEMA_SOURCE);
			await runCli(cwd, ["generate"]);
			const migrate = await runCli(cwd, [
				"migrate",
				"--url",
				hostUrl(database),
			]);
			expect(migrate.exitCode).toBe(0);

			const refused = await runCli(cwd, ["reset", "--url", hostUrl(database)]);
			expect(refused.exitCode).toBe(1);
			const confirmation = extractRequiredConfirmation(refused.stderr);

			const result = await runCli(cwd, [
				"reset",
				"--url",
				hostUrl(database),
				"--confirm-drop",
				confirmation,
			]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[reset-drop-failed]");
			expect(result.stderr).toContain("(2BP01)");
			// [D106 R1, N3, C5, #753 reopened] `dropsContainCycle` only knows
			// the run's own plan contains a cycle, never that the cycle is
			// what the server actually refused over -- the advice states the
			// cycle fact and keeps the outside-declarations possibility too,
			// asserting neither as the one true cause.
			expect(result.stderr).toContain("your own declared objects");
			expect(result.stderr).toContain("an object outside your declarations");

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: "select to_regclass('cyc.left_t') as left_t, to_regclass('cyc.right_t') as right_t",
					params: [],
					kind: "sql",
				});
				// Nothing dropped -- the whole transaction rolled back.
				expect(rows[0]?.left_t).not.toBeNull();
				expect(rows[0]?.right_t).not.toBeNull();
			} finally {
				await driver.client.end();
			}

			const status = await runCli(cwd, ["status", "--url", hostUrl(database)]);
			expect(status.exitCode).toBe(0);
			expect(status.stdout).toContain("recorded as applied:");
			expect(status.stdout).toContain("nothing pending");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);

	// [task 4.1, D106 R1, B1, #753 reopened] evaluation.md's own
	// reproduction: every migration applied without `hejbro migrate` ever
	// running (`psql -f`, a valid apply path this project documents), so
	// `hejbro.migration_ledger` never exists. Before the fix, `reset`
	// reported success and dropped nothing -- a caught 42P01, reached from
	// inside the drop transaction, left it aborted with no error ever
	// surfaced.
	it("declared objects applied without hejbro (no hejbro.migration_ledger): reset still drops everything and never claims the ledger was cleared", async () => {
		const database = "reset_noledger";
		psqlCommand("postgres", `create database ${database};`);
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/lab.schema.ts", LAB_SCHEMA_SOURCE);
			await runCli(cwd, ["generate"]);

			// [lead-approved, R88] A single `generate` run can write more
			// than one migration file (engine/split.ts's own transaction-
			// boundary condition) -- every `.sql` file this run wrote is
			// applied, in sorted (chain) order, standing in for "the whole
			// chain applied without hejbro ever touching the ledger", not
			// only its first file.
			const migrationsDir = join(cwd, "migrations");
			const migrationFiles = readdirSync(migrationsDir)
				.filter((name) => name.endsWith(".sql"))
				.sort();
			if (migrationFiles.length === 0) {
				throw new Error(`expected at least one migration file in ${migrationsDir}`);
			}
			migrationFiles.map((migrationFile) =>
				psqlApplySql(
					database,
					readFileSync(join(migrationsDir, migrationFile), "utf-8"),
				),
			);

			const refused = await runCli(cwd, ["reset", "--url", hostUrl(database)]);
			expect(refused.exitCode).toBe(1);
			const confirmation = extractRequiredConfirmation(refused.stderr);

			const result = await runCli(cwd, [
				"reset",
				"--url",
				hostUrl(database),
				"--confirm-drop",
				confirmation,
			]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"dropped every object your declarations manage",
			);
			expect(result.stdout).not.toContain("cleared the ledger");

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: "select to_regclass('lab.tasks') as tasks, to_regclass('lab.projects') as projects, (select nspname from pg_namespace where nspname = 'lab') as lab_schema, to_regclass('hejbro.migration_ledger') as ledger",
					params: [],
					kind: "sql",
				});
				expect(rows[0]?.tasks).toBeNull();
				expect(rows[0]?.projects).toBeNull();
				expect(rows[0]?.lab_schema).toBeNull();
				// [C4] `reset` never bootstraps the ledger it found absent --
				// it doesn't get to "succeed" by creating the very bookkeeping
				// B1's own reproduction never had.
				expect(rows[0]?.ledger).toBeNull();
			} finally {
				await driver.client.end();
			}
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
 * [task 1.9, harden-ledger-diagnostics, #836/#823] Live witness for the
 * two new codes -- tasks 1.1-1.8 proved the tagging, the classification
 * and every command's own wiring against fake drivers; nothing until this
 * file proves any of it against a real server. Mirrors
 * `apply-reset.integration.test.ts`'s own image selection
 * (`HEJBRO_PG_IMAGE`, default `postgres:17-alpine`), docker-availability
 * gating (throws, never skips) and container lifecycle exactly.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-apply-ledger-diagnostics-${process.pid}`;

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

let hostPort = "";
/** Connects as `postgres` (superuser, trust auth) -- for setup/verification, never the scenario under test. */
const hostUrl = (database: string): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${database}`;
/** Connects as `role` -- the connecting role every scenario below actually exercises (trust auth: no password needed for any role). */
const roleUrl = (database: string, role: string): string =>
	`postgres://${role}@127.0.0.1:${hostPort}/${database}`;

/** A raw stack frame line -- `error[code]:` diagnostics never print one; a raw driver dump always does. */
const STACK_FRAME_PATTERN = /\bat .*\.(ts|js):\d+/;

beforeAll(async () => {
	assertBuiltCli();
	if (!dockerAvailable()) {
		throw new Error(
			"the ledger diagnostics live witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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

const SCHEMA_A_SOURCE = `import { schema, table, uuid } from "hejbro";

export const ax = schema("ax");

export const items = table(ax, "items", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

const SCHEMA_B_SOURCE = `import { schema, table, uuid } from "hejbro";

export const bx = schema("bx");

export const widgets = table(bx, "widgets", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

const SCHEMA_C_SOURCE = `import { schema, table, uuid } from "hejbro";

export const zz = schema("zz");

export const widgets = table(zz, "widgets", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

describe("hejbro ledger diagnostics — live witness (#836/#823, task 1.9)", () => {
	it("(a) a role that may connect but may not read the ledger -- status and raise --file each exit non-zero with apply-ledger-unreadable, naming the role and the SQLSTATE, no stack frame", async () => {
		const database = "ld_read";
		psqlCommand("postgres", `create database ${database};`);
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/a.schema.ts", SCHEMA_A_SOURCE);
			await runCli(cwd, ["generate"]);
			await writeFixtureFile(cwd, "src/b.schema.ts", SCHEMA_B_SOURCE);
			await runCli(cwd, ["generate"]);
			const migrate = await runCli(cwd, [
				"migrate",
				"--url",
				hostUrl(database),
			]);
			expect(migrate.exitCode).toBe(0);
			expect(migrate.stdout).toContain("applied 2 migration(s)");

			psqlCommand(
				database,
				`create role ld_read login; grant connect on database ${database} to ld_read; grant usage on schema "hejbro" to ld_read;`,
			);

			const status = await runCli(cwd, [
				"status",
				"--url",
				roleUrl(database, "ld_read"),
			]);
			expect(status.exitCode).not.toBe(0);
			expect(status.stderr).toContain("error[apply-ledger-unreadable]");
			expect(status.stderr).toContain("ld_read");
			expect(status.stderr).toContain("42501");
			expect(status.stderr).toMatch(/Next:/);
			expect(status.stderr).not.toMatch(STACK_FRAME_PATTERN);

			await writeFixtureFile(
				cwd,
				"vendor/snapshot.sql",
				'create table "zz"."probe_raise" ("x" integer not null);',
			);
			const raise = await runCli(cwd, [
				"raise",
				"--file",
				"vendor/snapshot.sql",
				"--url",
				roleUrl(database, "ld_read"),
			]);
			expect(raise.exitCode).not.toBe(0);
			expect(raise.stderr).toContain("error[apply-ledger-unreadable]");
			expect(raise.stderr).toContain("ld_read");
			expect(raise.stderr).toContain("42501");
			expect(raise.stderr).not.toMatch(STACK_FRAME_PATTERN);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);

	it("(a2) the same role shape running migrate against a fresh database -- refused at its own bootstrap (836/R2), apply-ledger-unwritable naming the bootstrap, no stack frame, the ledger never created", async () => {
		const database = "ld_bootstrap";
		psqlCommand("postgres", `create database ${database};`);
		psqlCommand(
			database,
			`create role ld_bootstrap login; revoke create on database ${database} from public; grant connect on database ${database} to ld_bootstrap;`,
		);
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/a.schema.ts", SCHEMA_A_SOURCE);
			await runCli(cwd, ["generate"]);

			const migrate = await runCli(cwd, [
				"migrate",
				"--url",
				roleUrl(database, "ld_bootstrap"),
			]);

			expect(migrate.exitCode).toBe(2);
			expect(migrate.stderr).toContain("error[apply-ledger-unwritable]");
			expect(migrate.stderr).toContain("bootstrap");
			expect(migrate.stderr).not.toMatch(STACK_FRAME_PATTERN);

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: "select nspname from pg_namespace where nspname = 'hejbro'",
					params: [],
					kind: "sql",
				});
				expect(rows).toHaveLength(0);
			} finally {
				await driver.client.end();
			}
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);

	it("(b) a ledger whose id carries neither identity nor default -- migrate exits 2 with apply-ledger-unwritable, the pending migration's filename absent from the header, its declared object does not exist afterward, and the ledger holds the same rows as before", async () => {
		const database = "ld_identity";
		psqlCommand("postgres", `create database ${database};`);
		psqlCommand(
			database,
			`create schema "hejbro"; create table "hejbro"."migration_ledger" ("id" bigint not null, "filename" text not null unique, "origin" text not null check ("origin" in ('applied','registered','raised')), "applied_at" timestamptz not null default now());`,
		);
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/c.schema.ts", SCHEMA_C_SOURCE);
			await runCli(cwd, ["generate"]);
			const migrationFileName = readdirSync(`${cwd}/migrations`)[0] as string;

			const beforeDriver = pgDriver(hostUrl(database));
			try {
				const before = await beforeDriver.execute({
					sql: 'select "filename" from "hejbro"."migration_ledger"',
					params: [],
					kind: "sql",
				});
				expect(before).toHaveLength(0);
			} finally {
				await beforeDriver.client.end();
			}

			const migrate = await runCli(cwd, [
				"migrate",
				"--url",
				hostUrl(database),
			]);

			expect(migrate.exitCode).toBe(2);
			expect(migrate.stderr).toContain("error[apply-ledger-unwritable]");
			const headerLine = migrate.stderr.split("\n")[0] ?? "";
			expect(headerLine).not.toContain(migrationFileName);

			const driver = pgDriver(hostUrl(database));
			try {
				const rows = await driver.execute({
					sql: "select to_regclass('zz.widgets') as widgets",
					params: [],
					kind: "sql",
				});
				expect(rows[0]?.widgets).toBeNull();
				const ledgerRows = await driver.execute({
					sql: 'select "filename" from "hejbro"."migration_ledger"',
					params: [],
					kind: "sql",
				});
				expect(ledgerRows).toHaveLength(0);
			} finally {
				await driver.client.end();
			}
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

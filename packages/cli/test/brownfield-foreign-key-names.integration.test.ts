import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

/**
 * D106 R3-B3 (#693): the brownfield-adoption flow the skill documents
 * (`import`, then `baseline` -- never `generate` first, since `baseline`
 * is by definition the *first* migration of an adopted database and
 * refuses `baseline-not-first` if one already exists -- then `migrate`,
 * then `check`) against a database hejbro did not itself create -- the
 * one case the round-trip witness
 * (`declare-emit-roundtrip.integration.test.ts`) can never see, since
 * that witness's own database is created by hejbro in the first place,
 * so its foreign keys are already named the way hejbro's own
 * `deriveForeignKeyName` would name them. This fixture's own schema is
 * applied with a bare `create table ... references ...` instead
 * (Postgres's own default naming, `<table>_<column>_fkey`), the exact
 * shape the reviewer's own repro measured.
 *
 * Not run under `pnpm test`'s own default pass without Docker -- gated
 * the same way every other `*.integration.test.ts` in this package is.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-brownfield-fk-${process.pid}`;
const DATABASE = "brownfield_fk_names";

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
 * Same two-occurrence wait every other live-witness file in this package
 * measured and fixed (#361-class scar): the image's own entrypoint
 * answers "ready" once for its own temporary bootstrap server, then
 * again for the real one.
 */
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

const psqlFile = (database: string, sql: string): void => {
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

/**
 * A bare `create table ... references ...` -- Postgres names this
 * foreign key itself (`<table>_<column>_fkey`, its own convention, never
 * hejbro's `<table>_<columns>_fk`). Two tables, one ordinary foreign
 * key, is already enough: the reviewer's own repro needed nothing more
 * exotic than "a database hejbro did not create."
 */
const BROWNFIELD_SCHEMA_SQL = `
create schema app;
create table app.posts (
	id uuid primary key default gen_random_uuid()
);
create table app.comments (
	id uuid primary key default gen_random_uuid(),
	post_id uuid not null references app.posts (id)
);
`;

let hostPort = "";

beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"the brownfield foreign-key-name witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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
	execFileSync("docker", [
		"exec",
		CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-c",
		`create database ${DATABASE};`,
	]);
	psqlFile(DATABASE, BROWNFIELD_SCHEMA_SQL);
	assertBuiltCli();
}, 120_000);

afterAll(() => {
	execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

const fixtureUrl = (): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${DATABASE}`;

describe("brownfield adoption / D106 R3-B3: a foreign key's own catalog name survives import -> baseline -> migrate -> check", () => {
	it("check reports the foreign key present, not missing, after the documented adoption flow", async () => {
		const cwd = await createCliFixtureDir();
		try {
			const init = await runCli(cwd, ["init"]);
			expect(init.exitCode).toBe(0);

			const importResult = await runCli(cwd, [
				"import",
				"--url",
				fixtureUrl(),
				"--schema",
				"app",
				"--out",
				"src/schema",
			]);
			expect(importResult.exitCode).toBe(0);
			// The loss report never names the foreign key as an
			// approximation -- its catalog name (`_fkey`) is a valid
			// hejbro SQL identifier on its own, so it is carried
			// explicitly, not derived.
			expect(importResult.stdout).not.toContain(
				"is declared under the derived name",
			);
			const schemaSource = readFileSync(
				resolve(cwd, "src/schema/app.schema.ts"),
				"utf8",
			);
			expect(schemaSource).toContain('name: "comments_post_id_fkey"');

			// The documented adoption flow (brownfield-adoption.md) runs
			// `baseline` alone here, never `generate` first -- `baseline` is
			// by definition the *first* migration of an adopted database
			// (it refuses a second run, `baseline-not-first`), and a `generate`
			// run beforehand would already have written one.
			const baselineResult = await runCli(cwd, ["baseline"]);
			expect(baselineResult.exitCode).toBe(0);

			const migrateResult = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(),
			]);
			expect(migrateResult.exitCode).toBe(0);

			const checkResult = await runCli(cwd, ["check", "--url", fixtureUrl()]);
			expect(checkResult.exitCode).toBe(0);
			expect(checkResult.stdout).not.toContain("foreign key");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});

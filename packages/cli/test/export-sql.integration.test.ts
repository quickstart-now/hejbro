import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schema, table, text, uuid } from "@hejbro/core";
import { pgDriver } from "@hejbro/pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AssertSchemaHandle } from "../src/assert-schema";
import { assertSchema } from "../src/assert-schema";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

/**
 * The live-DB half of the export's own "complete on its own" scenario
 * (schema-export spec): every other export test proves the SQL is
 * *written* correctly; this is the only place it is ever *applied* to a
 * real database. Docker harness mirrors
 * `assert-schema-live.integration.test.ts` (mirrored, not imported --
 * that file's own comment explains why no shared module exists for it).
 * Never runs under the default `pnpm test`/CI.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-export-sql-${process.pid}`;

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

let hostPort = "";

const dbUrl = (database: string): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${database}`;

const SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("export_sql_live");

export const widgets = table(app, "widgets", {
	id: uuid().primaryKey(),
	label: text().notNull(),
});
`;

/** Mirrors the fixture's own declaration, for \`assertSchema\` to compare against the applied SQL through a real driver. */
const liveSchema = schema("export_sql_live");
const widgets = table(liveSchema, "widgets", {
	id: uuid().primaryKey(),
	label: text().notNull(),
});

beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"packages/cli's export-sql live-witness suite needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
		);
	}
	assertBuiltCli();
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
	execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

const cwds: Array<string> = [];

afterEach(async () => {
	await Promise.all(cwds.splice(0).map((cwd) => removeCliFixtureDir(cwd)));
});

describe("the squashed SQL creates the declared schema (R2-G2, live witness)", () => {
	it("applies cleanly to an empty database and the schema it declares is there", async () => {
		const cwd = await createCliFixtureDir();
		cwds.push(cwd);
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
		const generated = await runCli(cwd, ["generate", "--export"]);
		expect(generated.exitCode).toBe(0);

		const squashedSql = await readFile(
			join(cwd, ".hejbro", "export", "snapshot.sql"),
			"utf8",
		);

		const database = `export_sql_live_${process.pid}`;
		psqlFile("postgres", `create database ${database};`);
		psqlFile(database, squashedSql);

		const driver = pgDriver(dbUrl(database));
		try {
			const handle: AssertSchemaHandle = { schema: { widgets }, driver };
			const report = await assertSchema(handle);
			expect(report.compared).toEqual([
				{ identity: "export_sql_live.widgets" },
			]);
			expect(report.notCompared).toEqual([]);
		} finally {
			await driver.client.end();
		}
	});
});

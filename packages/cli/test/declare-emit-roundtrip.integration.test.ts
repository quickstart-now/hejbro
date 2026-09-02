import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pgDriver } from "@hejbro/pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emitDeclarationFiles } from "../src/declare-emit/emit";
import { inferFromCatalog } from "../src/infer/compose";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

/**
 * 2.2: the same round trip 2.1's own live witness already proved
 * (inferred snapshot -> emitted source -> real built CLI `init`/
 * `generate` -> object-by-object equal), against `examples/postgres`'s
 * own real database instead of a purpose-built fixture -- the
 * production-shaped surface (enums-free but self-referencing FKs,
 * composite primary keys, partial/expression/GIN indexes, checks,
 * RLS/triggers/views/grants) a synthetic fixture doesn't exercise at
 * this scale. RLS/triggers/views/functions/grants are never part of
 * this comparison at all -- v1 doesn't infer them, so `result.snapshot`
 * never carries them either; this proves the round trip is faithful for
 * what inference *does* declare (tables, columns, indexes, checks,
 * foreign keys), not that nothing was lost (the loss report already
 * owns naming what wasn't inferred).
 *
 * Schema setup applies `examples/postgres`'s own committed migration
 * chain (`seed/roles.sql` then `migrations/*.sql`, in order) exactly the
 * way `examples/postgres/test/integration.test.ts` does -- the exact DDL
 * a real user's `hejbro generate` produced, never hand-written DDL that
 * could drift from it.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-declare-emit-roundtrip-${process.pid}`;
const DATABASE = "app_roundtrip";
const EXAMPLE_ROOT = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"examples",
	"postgres",
);

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

const applySql = (database: string, sql: string): void => {
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

beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"declare-emit's roundtrip witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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
	applySql(
		DATABASE,
		readFileSync(join(EXAMPLE_ROOT, "seed/roles.sql"), "utf8"),
	);
	const migrationFiles = readdirSync(join(EXAMPLE_ROOT, "migrations"))
		.filter((name) => name.endsWith(".sql"))
		.sort();
	migrationFiles.forEach((name) => {
		applySql(
			DATABASE,
			readFileSync(join(EXAMPLE_ROOT, "migrations", name), "utf8"),
		);
	});
	assertBuiltCli();
}, 120_000);

afterAll(() => {
	execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

const fixtureUrl = (): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${DATABASE}`;

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

describe("declare-emit / 2.2 round trip over examples/postgres's own database", () => {
	it("emits source that, loaded and generated against an empty snapshot, reproduces examples/postgres's own inferred snapshot object by object", async () => {
		const driver = pgDriver(fixtureUrl());
		const result = await inferFromCatalog({
			session: driver,
			schemas: ["app"],
			command: "import",
		});
		await driver.client.end();

		const files = emitDeclarationFiles(result);
		expect(files.length).toBeGreaterThan(0);

		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await Promise.all(
				files.map((file) =>
					writeFixtureFile(
						cwd,
						`src/${file.fileBaseName}.schema.ts`,
						file.source,
					),
				),
			);

			const initResult = await runCli(cwd, ["init"]);
			expect(initResult.exitCode).toBe(0);
			const generateResult = await runCli(cwd, ["generate"]);
			expect(generateResult.exitCode).toBe(0);

			const snapshotContent = await readFile(
				join(cwd, "hejbro.snapshot.json"),
				"utf8",
			);
			const writtenSnapshot = JSON.parse(snapshotContent) as {
				readonly objects: Record<string, unknown>;
			};
			expect(writtenSnapshot.objects).toEqual(result.snapshot.objects);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

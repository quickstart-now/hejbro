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
	execFileSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });
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

	/**
	 * The comparison scope, stated as its own assertion (not left implicit
	 * in what `toEqual` above happens to compare): `examples/postgres`'s
	 * own `app.schema.ts` declares functions, triggers, a view, RLS
	 * policies, and grants -- v1 infers none of them, so the object-by-
	 * object comparison above never touches those kinds at all (both
	 * sides simply lack them). This is not a claim that nothing was lost;
	 * it is the claim that the excluded set is *exactly* what the loss
	 * report itself names as not inferred, checked against the real
	 * counts this database is known to have (2 functions --
	 * `comments_enforce_single_depth`, `audit_task_status_change`; 2
	 * triggers of the same names; 1 view -- `open_tasks`; policies and
	 * grants beyond role names, present on every RLS-enabled table).
	 */
	it("declares only the object kinds inference actually infers, and names everything else in the loss report (schema, tables, indexes, checks, foreign keys, enums, identity/serial sequences vs. functions/triggers/views/policies/grants)", async () => {
		const driver = pgDriver(fixtureUrl());
		const result = await inferFromCatalog({
			session: driver,
			schemas: ["app"],
			command: "import",
		});
		await driver.client.end();

		const inferredKinds = new Set(
			Object.keys(result.snapshot.objects).map(
				(key) => key.split(":")[0] ?? "",
			),
		);
		// only ever schema/table/enum/sequence -- never a view, trigger,
		// function, policy, rls, or grant kind, all of which this database
		// does declare (that's exactly the loss report's own job to name).
		const AllowedKinds = new Set(["schema", "table", "enum", "sequence"]);
		expect([...inferredKinds].every((kind) => AllowedKinds.has(kind))).toBe(
			true,
		);
		// this database's own real shape: no enum types, no serial/identity
		// columns -- tables are the only object kind besides the schema
		// itself. If a future example database gains one of the other
		// allowed kinds, this line (not the loop above) is what should grow.
		expect(inferredKinds).toEqual(new Set(["schema", "table"]));

		expect(
			result.lossReport.some((line) =>
				line.includes("2 function(s) not inferred"),
			),
		).toBe(true);
		expect(
			result.lossReport.some((line) =>
				line.includes("2 trigger(s) not inferred"),
			),
		).toBe(true);
		expect(
			result.lossReport.some((line) => line.includes("1 view(s) not inferred")),
		).toBe(true);
		expect(
			result.lossReport.some((line) =>
				line.includes("policy expression(s) not inferred"),
			),
		).toBe(true);
		expect(
			result.lossReport.some((line) =>
				line.includes("grants beyond their role name"),
			),
		).toBe(true);
	});
});

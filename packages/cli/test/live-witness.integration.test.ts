import type { ExecException } from "node:child_process";
import { execFile, execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pgDriver } from "@hejbro/pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inferFromCatalog } from "../src/infer/compose";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

/**
 * 5.1 (#650): the one place neither `import` nor `pull` has its own
 * dependency seam injected -- `ImportDeps`/`PullDeps` are never passed,
 * so the real wiring (`inferFromCatalog` -> `emitDeclarationFiles`/
 * `exportPayloadFromCatalog` -> `emitContract`) runs end to end, driven
 * through the real, built `hejbro` subprocess exactly the way a user
 * would invoke it -- group 3's and group 4's own suites all inject one
 * or the other seam by design (proving each command's own orchestration
 * without a live database), so this is the only place that gap closes.
 *
 * Schema setup applies `examples/postgres`'s own committed migration
 * chain, the same way `declare-emit-roundtrip.integration.test.ts`
 * (2.2) and `examples/postgres/test/integration.test.ts` do.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-live-witness-${process.pid}`;
const DATABASE = "app_live_witness";
const EXAMPLE_ROOT = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"examples",
	"postgres",
);
const CLI_PACKAGE_ROOT = join(import.meta.dirname, "..");
const PG_PACKAGE_ROOT = join(CLI_PACKAGE_ROOT, "..", "pg");
const TSC_PATH = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"node_modules",
	".bin",
	"tsc",
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
			"the live witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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

describe("import / 5.1 live witness (no seam: the real command, end to end)", () => {
	it("hejbro import, loaded and generated for real, reproduces the database's own inferred snapshot object by object", async () => {
		const cwd = await createCliFixtureDir();
		try {
			const init = await runCli(cwd, ["init"]);
			expect(init.exitCode).toBe(0);

			const importRun = await runCli(cwd, [
				"import",
				"--url",
				fixtureUrl(),
				"--schema",
				"app",
				"--out",
				"src/schema",
			]);
			expect(importRun.exitCode).toBe(0);
			expect(importRun.stderr).toBe("");

			const generate = await runCli(cwd, ["generate"]);
			expect(generate.exitCode).toBe(0);

			const snapshotContent = await readFile(
				join(cwd, "hejbro.snapshot.json"),
				"utf8",
			);
			const writtenSnapshot = JSON.parse(snapshotContent) as {
				readonly objects: Record<string, unknown>;
			};

			// The comparison oracle: an in-process inferFromCatalog call, over
			// the SAME database -- never the command under test (that's the
			// real `hejbro import` subprocess above), only the independent
			// source of truth `writtenSnapshot` is checked against.
			const driver = pgDriver(fixtureUrl());
			const oracle = await inferFromCatalog({
				session: driver,
				schemas: ["app"],
				command: "import",
			});
			await driver.client.end();

			expect(writtenSnapshot.objects).toEqual(oracle.snapshot.objects);
			// same comparison-scope pin 2.2 established: only what inference
			// actually declares ever reaches either side of this comparison.
			const inferredKinds = new Set(
				Object.keys(oracle.snapshot.objects).map(
					(key) => key.split(":")[0] ?? "",
				),
			);
			const allowedKinds = new Set(["schema", "table", "enum", "sequence"]);
			expect([...inferredKinds].every((kind) => allowedKinds.has(kind))).toBe(
				true,
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

const run = (
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
): Promise<{ readonly exitCode: number; readonly stdout: string }> =>
	new Promise((resolve) => {
		execFile(command, args, { cwd }, (error, stdout) => {
			if (error === null) {
				resolve({ exitCode: 0, stdout });
				return;
			}
			resolve({ exitCode: exitCodeFrom(error), stdout });
		});
	});

describe("pull / 5.1 live witness (no seam: the real command, end to end)", () => {
	it("hejbro pull writes a contract a real tsc accepts, and it reads one table for real", async () => {
		const cwd = await createCliFixtureDir();
		try {
			// `@hejbro/pg` is not one of createCliFixtureDir's own symlinks
			// (only `hejbro`/`@hejbro/supabase` are, for the DSL fixtures it
			// was built for) -- the runner script below needs it to open its
			// own connection through the vendored contract's `createDb`.
			await symlink(
				PG_PACKAGE_ROOT,
				join(cwd, "node_modules", "@hejbro", "pg"),
				"dir",
			);

			const pull = await runCli(cwd, [
				"pull",
				"--db-url",
				fixtureUrl(),
				"--schema",
				"app",
			]);
			expect(pull.exitCode).toBe(0);
			expect(pull.stderr).toBe("");
			// catalog-inference delta, "The report names the way out": the
			// *command's own output*, not just the header text a string
			// assertion on the written file could satisfy -- this is the one
			// scenario whose subject is "pull --db-url completes -> its
			// output", so only a real run's stdout proves it.
			expect(pull.stdout).toContain(
				"Guessed: TypeScript keys from SQL names, the default numeric mode, and unknown array-element nullability (read as nullable).",
			);
			expect(pull.stdout).toContain(
				"The loss ends when you link the schema repository.",
			);

			const contractPath = join(cwd, ".hejbro", "vendor", "contract.ts");
			const contractSource = await readFile(contractPath, "utf8");
			expect(contractSource).toContain("inferred from a database");
			expect(contractSource).toContain("export interface Database");
			expect(contractSource).toContain("createNameKeyedDb<Database>");

			// The real proof a string assertion can't give (2.1's own lesson,
			// CI-G4-R1-03): a real `tsc`, resolving `hejbro`/`@hejbro/pg`
			// through this fixture's own real symlinks, accepts the file
			// outright.
			const typeCheck = await run(
				TSC_PATH,
				[
					"--noEmit",
					"--strict",
					"--moduleResolution",
					"bundler",
					"--module",
					"esnext",
					"--target",
					"es2022",
					contractPath,
				],
				cwd,
			);
			expect(typeCheck.stdout).toBe("");
			expect(typeCheck.exitCode).toBe(0);

			// Reads one table through the vendored contract for real -- a
			// small runner script, run as its own process (never imported
			// in-process into this test's own module graph, the same reason
			// `cli-runner.ts`'s own `runCli` spawns the built CLI rather than
			// calling it in-process: a jiti/native import here could resolve
			// a different @hejbro/core instance than this test file's own).
			const runnerPath = join(cwd, "read-one-table.ts");
			await writeFile(
				runnerPath,
				`import { pgDriver } from "@hejbro/pg";
import { createDb } from "./.hejbro/vendor/contract.ts";

const driver = pgDriver(${JSON.stringify(fixtureUrl())});
const db = createDb(driver);
const rows = await db.projects.select();
console.log(JSON.stringify({ tableRead: "projects", rowCount: rows.length }));
await driver.client.end();
`,
			);
			const read = await run(process.execPath, [runnerPath], cwd);
			expect(read.exitCode).toBe(0);
			const readResult = JSON.parse(read.stdout.trim()) as {
				readonly tableRead: string;
				readonly rowCount: number;
			};
			expect(readResult.tableRead).toBe("projects");
			expect(typeof readResult.rowCount).toBe("number");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

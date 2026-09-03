import type { ExecException } from "node:child_process";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeContainer } from "./docker-volumes";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

/**
 * D106 R6-B1 (#719): a foreign key whose target's own schema was simply
 * never named on `--schema` -- not omitted for a bad name, just unread
 * -- must survive the reading: declared against an unexported
 * `existingTable` handle in the starter file, carried into the pulled
 * contract's own metadata, and left out of the loss report entirely
 * (nothing here was lost). `ext` is exactly the shape a hosted
 * Postgres's own platform schemas (`auth`, `storage`, …) have: an
 * ordinary lower snake_case schema and table `--schema` simply never
 * named. Deliberately a new file, not an extension of
 * `infer-omitted-names.integration.test.ts`: that fixture names every
 * schema it creates on `--schema`, so an unnamed one there would change
 * what its own existing assertions mean.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-unnamed-schema-ref-${process.pid}`;
const DATABASE = "unnamed_schema_ref";
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
 * `app` is the only schema named on `--schema` below; `ext` is created
 * but never named -- the exact input shape R6-B1 needs. Both schema and
 * table names on both sides are ordinary lower snake_case, so nothing
 * in this fixture is omitted for its own name either: any `Omitted:`
 * line this run produced would only be explainable by the defect this
 * witness exists to catch.
 */
const SCHEMA_SQL = `
create schema app;
create schema ext;
create table ext.users (
	id uuid primary key
);
create table app.orders (
	id uuid primary key,
	owner_id uuid not null references ext.users(id)
);
`;

let hostPort = "";

beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"the unnamed-schema-reference witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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
	psqlFile(DATABASE, SCHEMA_SQL);
	assertBuiltCli();
}, 120_000);

afterAll(() => {
	removeContainer(CONTAINER);
});

const fixtureUrl = (): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${DATABASE}`;

// Mirrors `live-witness.integration.test.ts`'s own `run`/`exitCodeFrom`
// -- neither is exported from `support/cli-runner.ts` (that file's own
// `runCli` only ever spawns the built `hejbro` CLI, never an arbitrary
// executable like `tsc` or a plain `node` script), so this is a copy of
// that same shape rather than a new one.
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

describe("import / D106 R6-B1: a foreign key into a schema the run did not name", () => {
	it("keeps the foreign key through an existingTable handle, with no loss-report line, and generates DDL that references the unread schema's own table", async () => {
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
			// Scoped, not a blanket habit: `app`/`orders`/`id`/`owner_id` are
			// all ordinary lower snake_case (nothing undeclarable), `app` is
			// the only requested schema and its own name is fine (nothing
			// omitted for a schema name), and `ext`/`users` were never read
			// at all -- they are unread, not omitted, so no branch of
			// `buildLossReport` has anything to name here. No code path in
			// this fixture can produce an `Omitted:` line of any kind, not
			// only not a foreign-key one.
			expect(importRun.stdout).not.toContain("Omitted:");
			// The positive half: a report that printed nothing at all would
			// also pass the negative check above -- assert the report was
			// actually produced, not merely silent.
			expect(importRun.stdout).toContain("Guessed:");
			expect(importRun.stdout).toContain(
				"The loss ends when you hand-edit the starter declarations.",
			);

			// The scope rule itself, pinned rather than assumed: `ext` was
			// never read, so no file exists for it, and `app.schema.ts`
			// never declares `schema("ext")` -- checked as the declaration
			// form specifically (not the raw string "ext", which legitimately
			// appears inside the existingTable(...) handle below).
			expect(existsSync(join(cwd, "src/schema/ext.schema.ts"))).toBe(false);

			const schemaSource = await readFile(
				join(cwd, "src/schema/app.schema.ts"),
				"utf8",
			);
			expect(schemaSource).not.toContain('schema("ext")');
			expect(schemaSource).not.toContain('from "./ext.schema"');

			// Same block-isolation shape as the committed unit red
			// (`declare-emit-emit.test.ts`'s "declares a foreign key into a
			// table this run never read..."): the handle's own preamble line
			// has no "export const" of its own, so it sits just before
			// `orders`'s own call.
			const preambleStart = schemaSource.indexOf("\nconst ");
			const callStart = schemaSource.indexOf("export const orders = table(");
			if (callStart === -1) {
				throw new Error(
					`expected "export const orders = table(" in the written starter file:\n${schemaSource}`,
				);
			}
			const candidateStarts = [preambleStart, callStart].filter(
				(index) => index !== -1,
			);
			const ordersBlock = schemaSource.slice(Math.min(...candidateStarts));

			const handleMatch = ordersBlock.match(
				/const (\w+) = existingTable\("ext", "users", \{[^}]*\}\);/,
			);
			if (handleMatch === null) {
				throw new Error(
					`expected an existingTable("ext", "users", ...) handle in orders's own block:\n${ordersBlock}`,
				);
			}
			const [, handleIdentifier] = handleMatch;
			expect(ordersBlock).toContain(
				`references: { table: ${handleIdentifier}, columns: [${handleIdentifier}.id] }`,
			);

			// The assertion the finding rests on: the *emitted DDL*, loaded
			// and generated for real through the built CLI (never a second,
			// independent SQL string this test writes by hand) -- string-
			// matching the TypeScript above proves the declaration compiles
			// to the right shape, not that hejbro's own compiler turns it
			// into the right SQL.
			const generateRun = await runCli(cwd, ["generate"]);
			expect(generateRun.exitCode).toBe(0);

			const migrationFileNames = (
				await readdir(join(cwd, "migrations"))
			).filter((name) => name.endsWith(".sql"));
			const [migrationFileName] = migrationFileNames;
			if (migrationFileName === undefined) {
				throw new Error(
					`expected one migration file under migrations/, found: ${JSON.stringify(migrationFileNames)}`,
				);
			}
			const migrationSql = await readFile(
				join(cwd, "migrations", migrationFileName),
				"utf8",
			);
			expect(migrationSql).toContain(
				'alter table "app"."orders" add constraint "orders_owner_id_fkey" foreign key ("owner_id") references "ext"."users" ("id");',
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

describe("pull / D106 R6-B1: a foreign key into a schema the run did not name", () => {
	it("carries the reference in the contract's own metadata, and the contract still type-checks", async () => {
		const cwd = await createCliFixtureDir();
		try {
			const pull = await runCli(cwd, [
				"pull",
				"--db-url",
				fixtureUrl(),
				"--schema",
				"app",
			]);
			expect(pull.exitCode).toBe(0);
			expect(pull.stderr).toBe("");
			// Same reasoning as the import side above: nothing in this
			// fixture is omitted, for a name or otherwise.
			expect(pull.stdout).not.toContain("Omitted:");
			// The positive half, pull's own way-out sentence: the negative
			// check above would also pass a silent run that printed nothing.
			expect(pull.stdout).toContain("Guessed:");
			expect(pull.stdout).toContain(
				"The loss ends when you link the schema repository.",
			);

			const contractPath = join(cwd, ".hejbro", "vendor", "contract.ts");
			const contractSource = await readFile(contractPath, "utf8");
			// The emitted source, string-matched -- `renderTableClientMetaEntry`
			// (contract/emit.ts) renders one such literal line per foreign key,
			// with no membership filter against the contract's own table set.
			expect(contractSource).toContain(
				'{ name: "orders_owner_id_fkey", columns: ["owner_id"], referencesSchema: "ext", referencesTable: "users", referencedColumns: ["id"] }',
			);

			// The real proof a string assertion can't give (live-witness's own
			// lesson): a real `tsc`, resolving `hejbro` through this fixture's
			// own real symlink, accepts the file outright.
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

			// Closes CI-719-R6-01's own "could not check" on
			// `buildTableClientMeta`: the actual *runtime* shape of
			// `contractMetadata.tables.orders.foreignKeys`, read by importing
			// the real emitted module as its own process (never in-process,
			// the same reason `live-witness.integration.test.ts`'s own
			// `read-one-table.ts` runner is a separate process too) -- not
			// only a string match on the source text above.
			const runnerPath = join(cwd, "read-orders-foreign-keys.ts");
			await writeFile(
				runnerPath,
				`import { contractMetadata } from "./.hejbro/vendor/contract.ts";

console.log(JSON.stringify(contractMetadata.tables.orders.foreignKeys));
`,
			);
			const read = await run(process.execPath, [runnerPath], cwd);
			expect(read.exitCode).toBe(0);
			const foreignKeys = JSON.parse(read.stdout.trim()) as ReadonlyArray<{
				readonly name: string;
				readonly columns: ReadonlyArray<string>;
				readonly referencesSchema: string;
				readonly referencesTable: string;
				readonly referencedColumns: ReadonlyArray<string>;
			}>;
			expect(foreignKeys).toEqual([
				{
					name: "orders_owner_id_fkey",
					columns: ["owner_id"],
					referencesSchema: "ext",
					referencesTable: "users",
					referencedColumns: ["id"],
				},
			]);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

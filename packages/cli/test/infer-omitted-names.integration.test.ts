import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CliRun } from "./support/cli-runner";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

/** Mirrors `brownfield-foreign-key-names.integration.test.ts`'s own helper -- stderr on every assertion so a future failure diagnoses itself. */
const expectExitCode = (label: string, run: CliRun, exitCode: number): void => {
	expect(
		run.exitCode,
		`${label} exited ${run.exitCode} -- stderr:\n${run.stderr}`,
	).toBe(exitCode);
};

/**
 * D106 R4-B1 (#706): the reviewer's own four inputs -- a schema, a
 * table, a check and an index, each named the way an ORM-created
 * database (or any database hejbro did not create) commonly does, none
 * of them lower snake_case (D36) -- read together with an ordinary
 * sibling of each kind, through both `import` and `pull --db-url`. Each
 * bad name SHALL cost only the one object it names (and, for the schema
 * and the table, whatever that object holds) -- never the whole
 * reading: the ordinary siblings still come out, and the loss report
 * names every omission.
 *
 * Not run under `pnpm test`'s own default pass without Docker -- gated
 * the same way every other `*.integration.test.ts` in this package is.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-omitted-names-${process.pid}`;
const DATABASE = "omitted_names";

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
 * `"App"` (a schema) holds `orders` -- a valid table name under an
 * invalid schema, proving a schema omission takes what it holds with
 * it even when the table's own name would otherwise be fine. `app`
 * holds the ordinary sibling of each kind (`widgets`, its check and its
 * index) beside the one bad name of that kind (`"Widgets"`,
 * `"CK_Widgets"`, `"IX_Widgets"`).
 */
const SCHEMA_SQL = `
create schema "App";
create table "App".orders (
	id uuid primary key default gen_random_uuid()
);

create schema app;
create table app.widgets (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	constraint widgets_name_not_blank check (length(name) > 0),
	constraint "CK_Widgets" check (true)
);
create index widgets_name_idx on app.widgets (name);
create index "IX_Widgets" on app.widgets (name);

create table app."Widgets" (
	id uuid primary key default gen_random_uuid()
);
`;

let hostPort = "";

beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"the omitted-names witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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
	execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

const fixtureUrl = (): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${DATABASE}`;

describe("catalog-inference / D106 R4-B1: a bad name costs the object, not the reading", () => {
	it("import: writes app.schema.ts for the ordinary sibling table, writes nothing for the invalid schema, and names all four omissions -- deterministically", async () => {
		const cwd = await createCliFixtureDir();
		try {
			const init = await runCli(cwd, ["init"]);
			expectExitCode("init", init, 0);

			const first = await runCli(cwd, [
				"import",
				"--url",
				fixtureUrl(),
				"--schema",
				"App",
				"--schema",
				"app",
				"--out",
				"src/schema",
			]);
			expectExitCode("import", first, 0);

			expect(first.stdout).toContain('Omitted: schema "App"');
			expect(first.stdout).toContain('Omitted: table "app.Widgets"');
			expect(first.stdout).toContain('Omitted: index "app.widgets.IX_Widgets"');
			expect(first.stdout).toContain(
				'Omitted: check constraint "app.widgets.CK_Widgets"',
			);
			// D106 R4-B3/#707: three distinct consequence sentences, not one
			// generic "check will not report this" line reused three times --
			// "Widgets"'s own schema ("app") still declares "widgets", so
			// `check`'s inventory keeps naming it, unlike the whole-schema and
			// index/check omissions, which `check` never surfaces again.
			expect(first.stdout).toContain(
				"`check` will not list them, since nothing in that schema is declared",
			);
			expect(first.stdout).toContain("unmanaged-table inventory");
			expect(first.stdout).toContain("hejbro will not mention it again");

			const schemaSource = readFileSync(
				resolve(cwd, "src/schema/app.schema.ts"),
				"utf8",
			);
			// The header's own loss-report prose legitimately names every
			// omitted object (asserted on `first.stdout` above, and the file
			// carries the same report in its header, R2-N3) -- what must be
			// absent is a *declared* object of that name, so this checks only
			// the declaration code itself, not the whole file (a whole-file
			// substring check would false-fail on the header's own prose).
			const declarationCode = schemaSource.slice(
				schemaSource.indexOf("import {"),
			);
			expect(schemaSource).toContain('Omitted: table "app.Widgets"');
			expect(declarationCode).toContain("widgets");
			expect(declarationCode).toContain("widgets_name_not_blank");
			expect(declarationCode).toContain("widgets_name_idx");
			expect(declarationCode).not.toContain('"Widgets"');
			expect(declarationCode).not.toContain("CK_Widgets");
			expect(declarationCode).not.toContain("IX_Widgets");

			expect(
				execFileSync("ls", [resolve(cwd, "src/schema")], {
					encoding: "utf8",
				}),
			).not.toContain("App");

			// Determinism (the delta's own "second import writes the same
			// bytes" rule, D106 R2/R3): a second reading of the same
			// database into a second empty directory produces byte-identical
			// output, omissions included.
			const second = await runCli(cwd, [
				"import",
				"--url",
				fixtureUrl(),
				"--schema",
				"App",
				"--schema",
				"app",
				"--out",
				"src/schema2",
			]);
			expectExitCode("import (second)", second, 0);
			const secondSource = readFileSync(
				resolve(cwd, "src/schema2/app.schema.ts"),
				"utf8",
			);
			expect(secondSource).toBe(schemaSource);
			expect(second.stdout).toBe(first.stdout);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("pull: writes a contract carrying the ordinary sibling table, and names all four omissions -- deterministically", async () => {
		const cwd = await createCliFixtureDir();
		const secondCwd = await createCliFixtureDir();
		try {
			const first = await runCli(cwd, [
				"pull",
				"--db-url",
				fixtureUrl(),
				"--schema",
				"App",
				"--schema",
				"app",
			]);
			expectExitCode("pull", first, 0);

			expect(first.stdout).toContain('Omitted: schema "App"');
			expect(first.stdout).toContain('Omitted: table "app.Widgets"');
			expect(first.stdout).toContain('Omitted: index "app.widgets.IX_Widgets"');
			expect(first.stdout).toContain(
				'Omitted: check constraint "app.widgets.CK_Widgets"',
			);

			const contractPath = resolve(cwd, ".hejbro/vendor/contract.ts");
			const contractSource = readFileSync(contractPath, "utf8");
			expect(contractSource).toContain("widgets");
			expect(contractSource).not.toContain('Widgets"');

			// Determinism: a second, independent `pull` of the same database
			// writes the same contract bytes, omissions included.
			const second = await runCli(secondCwd, [
				"pull",
				"--db-url",
				fixtureUrl(),
				"--schema",
				"App",
				"--schema",
				"app",
			]);
			expectExitCode("pull (second)", second, 0);
			const secondContractSource = readFileSync(
				resolve(secondCwd, ".hejbro/vendor/contract.ts"),
				"utf8",
			);
			expect(secondContractSource).toBe(contractSource);
			expect(second.stdout).toBe(first.stdout);
		} finally {
			await removeCliFixtureDir(cwd);
			await removeCliFixtureDir(secondCwd);
		}
	});
});

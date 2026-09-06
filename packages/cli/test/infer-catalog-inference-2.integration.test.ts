import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeContainer } from "./docker-volumes";
import type { CliRun } from "./support/cli-runner";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

/** Mirrors `infer-omitted-names.integration.test.ts`'s own helper -- stderr on every assertion so a future failure diagnoses itself. */
const expectExitCode = (label: string, run: CliRun, exitCode: number): void => {
	expect(
		run.exitCode,
		`${label} exited ${run.exitCode} -- stderr:\n${run.stderr}`,
	).toBe(exitCode);
};

/**
 * harden-catalog-inference-2's own live witness: a single database
 * carrying, on one table (`app.orders`), the cross-cutting shape task
 * 1.2's own E7 already proved in isolation -- an enum-typed column's
 * foreign key, a name-omitted column's foreign key, a non-derived
 * primary key, a surviving ordinary column and enum -- plus 1.1's own
 * role-from-policy case, all against a real Postgres server. `roles`
 * (1.1) is this file's own reason to exist: no unit test can observe
 * `pg_policies.roles`'s real `json_agg` wire shape, only a live server
 * can.
 *
 * Docker container name `cf-pg`, host port 55630-55639 (team cf's own
 * range) -- never the shared `hejbro-cli-*` naming convention, so this
 * witness never collides with a concurrently running team's own
 * container.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = "cf-pg";
const DATABASE = "catalog_inference_2";
const PORT_RANGE_START = 55630;
const PORT_RANGE_END = 55639;

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

/** `true` when nothing is listening on `port` on the loopback interface -- checked before `docker run` claims it, since two concurrent teams sharing this Docker host must never race for the same port. */
const isPortFree = (port: number): Promise<boolean> =>
	new Promise((resolveFree) => {
		const server = createServer();
		server.once("error", () => {
			resolveFree(false);
		});
		server.once("listening", () => {
			server.close(() => resolveFree(true));
		});
		server.listen(port, "127.0.0.1");
	});

const PORT_CANDIDATES = Array.from(
	{ length: PORT_RANGE_END - PORT_RANGE_START + 1 },
	(_unused, index) => PORT_RANGE_START + index,
);

/** The first free port among `candidates`, checked one at a time (never `Promise.all`, which would race every candidate's own bind against the others) -- `undefined` when none of them are free right now. */
const firstFreePort = async (
	candidates: ReadonlyArray<number>,
): Promise<number | undefined> => {
	const [candidate, ...rest] = candidates;
	if (candidate === undefined) {
		return undefined;
	}
	if (await isPortFree(candidate)) {
		return candidate;
	}
	return firstFreePort(rest);
};

const findFreePort = async (attemptsLeft: number): Promise<number> => {
	const found = await firstFreePort(PORT_CANDIDATES);
	if (found !== undefined) {
		return found;
	}
	if (attemptsLeft <= 0) {
		throw new Error(
			`no free port in ${PORT_RANGE_START}-${PORT_RANGE_END} -- Next: check what else is bound there (\`lsof -i :${PORT_RANGE_START}-${PORT_RANGE_END}\`).`,
		);
	}
	await sleep(300);
	return findFreePort(attemptsLeft - 1);
};

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
 * `app.orders` carries, at once: `status` (typed by the omitted enum
 * `"Status"`, with its own foreign key into `app.status_catalog`,
 * enum-to-enum so Postgres itself accepts the constraint, and its own
 * index -- B#1), `"UserId"` (omitted for its own name, with its own
 * foreign key into `app.users`, and its own check constraint -- B#1),
 * `state` (typed by the ordinary, surviving enum `app.status`), and a
 * primary key named `pk_orders` (not the derived `orders_pkey`). A
 * policy on `orders` names `app_reader` in its own `TO` clause and
 * nowhere else (#678); a plain grant names `app_writer`; a second
 * policy is `TO public`, which must never be read as a role name
 * (712/R1's own `{public}` rule).
 */
const SCHEMA_SQL = `
create schema app;
create role app_reader;
create role app_writer;

create type app."Status" as enum ('open', 'closed');
create type app.status as enum ('open', 'closed');

create table app.users (
	id uuid primary key default gen_random_uuid()
);

create table app.status_catalog (
	value app."Status" not null unique
);

create table app.orders (
	id uuid not null default gen_random_uuid(),
	status app."Status" not null,
	"UserId" uuid not null,
	state app.status not null,
	constraint pk_orders primary key (id)
);

alter table app.orders
	add constraint orders_status_fkey foreign key (status) references app.status_catalog (value);
alter table app.orders
	add constraint orders_userid_fkey foreign key ("UserId") references app.users (id);

-- B#1 (live review): an index on the enum-omitted column and a check
-- constraint on the name-omitted column -- both must be left out of the
-- declaration, and neither may reach the migration SQL baseline
-- writes, or replaying it against an empty database fails exactly the
-- way the review's own db2-enum.sql / out-db2-replay.txt did.
create index orders_status_idx on app.orders (status);
alter table app.orders
	add constraint orders_userid_chk check ("UserId" is not null);

-- Review round 2 LL2 (live review): a partial index's own predicate can
-- name an omitted column even when its own key does not -- this index
-- is keyed on the surviving "id", but its predicate reads the
-- enum-omitted "status", so it must be excluded the same way
-- orders_status_idx is.
create index orders_id_partial_status_idx on app.orders (id) where status = 'open';

-- Review round 2 NN2/OO2 (live review): an index carrying both an
-- expression key and a predicate at once -- pg_depend never tags which
-- of the two clauses names a given referenced column, so when the
-- omitted "UserId" is named only through the expression (the predicate
-- names the surviving "state"), the line must name both clauses.
create index orders_lower_userid_active_idx on app.orders (lower("UserId"::text)) where state = 'open';

grant select on app.orders to app_writer;

create policy orders_read_own on app.orders for select to app_reader using (true);
create policy orders_read_all on app.orders for select to public using (true);

-- Review round 2 PP6 (N#7, 712/R10 execution, live review): a composite
-- primary key with one name-omitted member stayed in the declarations
-- as a partial key -- a different constraint than the catalog's own --
-- so baseline's SQL replayed the wrong primary key, silently. Omitted
-- whole instead: line_no survives as an ordinary column, and the
-- table is declared with no primary key at all.
create table app.line_items (
	line_no uuid not null default gen_random_uuid(),
	"Weird" uuid not null default gen_random_uuid(),
	constraint pk_line_items primary key (line_no, "Weird")
);
`;

let hostPort = "";
let cwd = "";
let pullCwd = "";
let importRun: CliRun;
let checkRun: CliRun;
let declarationCode = "";
let contractSource = "";
let schemaPath = "";

const fixtureUrl = (): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${DATABASE}`;

/**
 * EE3 (cf-planner): a single `beforeAll` boots the container, applies
 * {@link SCHEMA_SQL}, and drives `import`/`pull`/`check` exactly once,
 * capturing every output this file's own `it`s read. Splitting the six
 * settled claims into independent `it`s (rather than one long sequential
 * test) gives each of DD4's mutations its own cell: a sequential test
 * stops at its first failing `expect`, hiding every claim after it, so a
 * mutation that breaks two unrelated claims would only ever show one.
 * Docker still starts exactly once.
 */
beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"the catalog-inference-2 witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
		);
	}
	const port = await findFreePort(5);
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
			`127.0.0.1:${port}:5432`,
			IMAGE,
		],
		{ stdio: "ignore" },
	);
	hostPort = String(port);
	await waitUntilReady(60);
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

	cwd = await createCliFixtureDir();
	const init = await runCli(cwd, ["init"]);
	expectExitCode("init", init, 0);

	importRun = await runCli(cwd, [
		"import",
		"--url",
		fixtureUrl(),
		"--schema",
		"app",
		"--out",
		"src/schema",
	]);
	expectExitCode("import", importRun, 0);

	schemaPath = resolve(cwd, "src/schema/app.schema.ts");
	const schemaSource = readFileSync(schemaPath, "utf8");
	declarationCode = schemaSource.slice(schemaSource.indexOf("import {"));

	pullCwd = await createCliFixtureDir();
	const pullRun = await runCli(pullCwd, [
		"pull",
		"--db-url",
		fixtureUrl(),
		"--schema",
		"app",
	]);
	expectExitCode("pull", pullRun, 0);
	contractSource = readFileSync(
		resolve(pullCwd, ".hejbro/vendor/contract.ts"),
		"utf8",
	);

	checkRun = await runCli(cwd, ["check", "--url", fixtureUrl()]);

	// eslint-disable-next-line no-console
	console.log(
		`[infer-catalog-inference-2] import loss report:\n${importRun.stdout}`,
	);
}, 120_000);

afterAll(async () => {
	removeContainer(CONTAINER);
	await removeCliFixtureDir(cwd);
	await removeCliFixtureDir(pullCwd);
});

describe("catalog-inference-2 / live witness: 1.1's roles-from-policies, 1.2's enum-held-to-D36, 1.3's foreign-key/primary-key omissions", () => {
	it("712/R3: the enum's own line names both columns typed by the omitted enum, and the ordinary sibling enum survives", () => {
		expect(importRun.stdout).toContain(
			'Omitted: enum type "app.Status" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it, and every column typed by it is left out with it: "app.orders.status", "app.status_catalog.value".',
		);
		expect(declarationCode).not.toContain('"Status"');
		expect(declarationCode).toContain("pgEnum");
		expect(declarationCode).toContain("status");

		// The enum-caused foreign key's own line text is not asserted here
		// (its reason/way-out clauses are under lead review, 712/R3
		// follow-up) -- only that the relation itself is gone from the
		// declaration, a direct consequence of the enum's own omission
		// rather than of the foreign key's own name (kept out of the
		// 712/R5 `it` below so V2 (enum filter disabled) turns only this
		// `it` red on this axis, not that one).
		expect(declarationCode).not.toContain("ordersStatusFkey");
		expect(declarationCode).not.toContain("orders_status_fkey");
	});

	it("#678: roles reach both the import description and the pull contract, from the policy's TO clause and the grant, never from public", () => {
		expect(importRun.stdout).toContain("Guessed role names:");
		const guessedLine = importRun.stdout
			.split("\n")
			.find((line) => line.includes("Guessed role names:"));
		if (guessedLine === undefined) {
			throw new Error(
				`expected a "Guessed role names:" line:\n${importRun.stdout}`,
			);
		}
		expect(guessedLine).toContain("app_reader");
		expect(guessedLine).toContain("app_writer");
		expect(guessedLine).not.toContain("public");

		expect(contractSource).toContain('"app_reader"');
		expect(contractSource).toContain('"app_writer"');
		expect(contractSource).not.toContain('"public"');
	});

	it("712/R7: the dropped, non-derived primary-key name is announced as an approximation", () => {
		expect(importRun.stdout).toContain(
			'Approximated: the primary key "app.orders.pk_orders" is declared under the derived name "orders_pkey" instead',
		);
	});

	it("712/R5: the name-caused foreign key's omission line is exact", () => {
		expect(importRun.stdout).toContain(
			'Omitted: foreign key "app.orders.orders_userid_fkey" -- it is declared on column "app.orders.UserId", which this reading left out because no declaration can carry its name, so the key cannot be declared either. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("the starter written by import loads through the production loader's own jiti", async () => {
		const jiti = createJiti(schemaPath, { fsCache: false });
		await expect(jiti.import(schemaPath)).resolves.toBeDefined();
	});

	it("712/R2, 712/R7: check afterward names the omitted columns as unmanaged, never the enum type itself, and reports both of the primary key's own two signals", () => {
		expectExitCode("check", checkRun, 1);
		expect(checkRun.stdout).toContain("app.orders.status");
		expect(checkRun.stdout).not.toContain("app.Status");
		expect(checkRun.stdout).toContain("pk_orders");
		// The missing declared primary key is its own finding, on stderr
		// (`hejbro`'s own diagnostic channel, per `cli-runner.ts`'s own
		// `isHejbroDiagnostic` split) -- never stdout's plain inventory.
		expect(checkRun.stderr).toContain("app.orders.orders_pkey");
		expect(checkRun.stderr).toContain("was not found in the database");
	});

	it("712/R8: the enum-caused foreign key's own line matches the enum-cause wording exactly", () => {
		expect(importRun.stdout).toContain(
			'Omitted: foreign key "app.orders.orders_status_fkey" -- it is declared on column "app.orders.status", which this reading left out with the enum type "app.Status" that types it, so the key cannot be declared either. Next: rename the type in the database, then re-run `hejbro import`.',
		);
	});

	it("712/R9: orders_status_fkey is named on exactly one omitted-foreign-key line, even though the omitted enum took both of its columns at once", () => {
		const fkLines = importRun.stdout
			.split("\n")
			.filter(
				(line) =>
					line.startsWith("Omitted: foreign key") &&
					line.includes('"app.orders.orders_status_fkey"'),
			);
		expect(fkLines).toHaveLength(1);
	});

	it("KK5 (712/R10 B#1): the omitted index and check constraint each match the approved wording exactly, and neither gets an approximation line", () => {
		expect(importRun.stdout).toContain(
			'Omitted: index "app.orders.orders_status_idx" -- it is declared on column "app.orders.status", which this reading left out with the enum type "app.Status" that types it, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the type in the database, then re-run `hejbro import`.',
		);
		expect(importRun.stdout).toContain(
			'Omitted: check constraint "app.orders.orders_userid_chk" -- its expression names column "app.orders.UserId", which this reading left out because no declaration can carry its name, so the check constraint cannot be declared either. `check` keeps listing the check constraint as unmanaged until that column and the check constraint are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
		const approximationLines = importRun.stdout
			.split("\n")
			.filter((line) => line.startsWith("Approximated:"));
		expect(
			approximationLines.some(
				(line) =>
					line.includes("orders_status_idx") ||
					line.includes("orders_userid_chk"),
			),
		).toBe(false);
	});

	// MM3 (712/R10 B#1, lead-approved wording): a partial index caught
	// only through its own predicate never reaches the starter
	// declaration, and its own line reads "its predicate names column
	// …", not "it is declared on column …" -- the index's own key
	// ("id") survives; only the predicate names the omitted "status".
	it("MM3: a partial index caught only through its own predicate never reaches the starter declaration, and its own line says so", () => {
		expect(declarationCode).not.toContain("orders_id_partial_status_idx");
		expect(importRun.stdout).toContain(
			'Omitted: index "app.orders.orders_id_partial_status_idx" -- its predicate names column "app.orders.status", which this reading left out with the enum type "app.Status" that types it, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the type in the database, then re-run `hejbro import`.',
		);
	});

	// OO2 (712/R10 B#1, NN2 lead-approved wording): an index carrying
	// both an expression key and a predicate at once -- pg_depend never
	// tags which clause names the omitted "UserId" (the predicate reads
	// only the surviving "state"), so the line must name both clauses.
	it("OO2: an index with both an expression and a predicate never reaches the starter declaration, and its own line names both clauses", () => {
		expect(declarationCode).not.toContain("orders_lower_userid_active_idx");
		expect(importRun.stdout).toContain(
			'Omitted: index "app.orders.orders_lower_userid_active_idx" -- its expression or predicate names column "app.orders.UserId", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	// PP6 (N#7, 712/R10 execution): a composite primary key with one
	// name-omitted member is omitted whole -- the surviving "line_no"
	// stays an ordinary column, and no primary key at all is declared.
	it("PP6: a composite primary key with one omitted member is omitted whole, and its own line names it", () => {
		expect(declarationCode).toContain("lineNo");
		expect(declarationCode).not.toContain("pk_line_items");
		expect(importRun.stdout).toContain(
			'Omitted: primary key "app.line_items.pk_line_items" -- it names column "app.line_items.Weird", which this reading left out because no declaration can carry its name, so the key cannot be declared either; the table is declared without a primary key. `check` keeps listing the index that backs it as unmanaged, naming "app.line_items.pk_line_items", until that column and the key are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("B#1: baseline's own migration SQL replays cleanly against an empty database, even with an index and a check on omitted columns", async () => {
		const baselineRun = await runCli(cwd, ["baseline"]);
		expectExitCode("baseline", baselineRun, 0);

		const migrationFileNames = readdirSync(resolve(cwd, "migrations")).filter(
			(name) => name.endsWith(".sql"),
		);
		if (migrationFileNames.length !== 1) {
			throw new Error(
				`expected exactly one baseline migration file, found: ${migrationFileNames.join(", ")}`,
			);
		}
		const [migrationFileName] = migrationFileNames;
		const migrationSql = readFileSync(
			resolve(cwd, "migrations", migrationFileName as string),
			"utf8",
		);
		// Neither the enum-omitted nor the name-omitted column's own name
		// may reach the SQL this file actually replays -- the same fact
		// J7's own unit test pins, witnessed live.
		expect(migrationSql).not.toContain("orders_status_idx");
		expect(migrationSql).not.toContain("orders_userid_chk");
		// LL2: a partial index caught only through its own predicate (its
		// key is the surviving "id") must be excluded exactly the same way.
		expect(migrationSql).not.toContain("orders_id_partial_status_idx");
		// OO2: the expression-and-predicate index must be excluded the
		// same way, whichever clause the omitted column actually names.
		expect(migrationSql).not.toContain("orders_lower_userid_active_idx");
		// PP6: the composite primary key naming an omitted member never
		// reaches the SQL a following baseline actually replays -- not as
		// a partial key under the catalog's own name, not at all.
		expect(migrationSql).not.toContain("pk_line_items");

		const replayDatabase = "catalog_inference_2_replay";
		execFileSync("docker", [
			"exec",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-c",
			`create database ${replayDatabase};`,
		]);
		// The review's own reproduction, reversed: `db2-enum.sql`'s replay
		// against an empty database failed with `column "..." does not
		// exist` -- `psqlFile`'s own `ON_ERROR_STOP=1` makes the same
		// failure here throw, which is this assertion in its entirety.
		psqlFile(replayDatabase, migrationSql);
	});
});

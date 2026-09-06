import { execFileSync } from "node:child_process";
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
 * Task 1.4's own live witnesses, against a real `postgres:17-alpine`
 * (671/R7): the delta's round-trip sentence only holds for a declaration
 * whose sole managed object is a sequence (C-1); a declaration that also
 * carries children re-adopts as `adoption-creates`, not a clean apply,
 * and the general round trip (a handover snapshot that remembers its
 * children) is #1009, not this piece. C-2 is the piece's other witness:
 * a table that was never hejbro's, made by hand, adopted whole. Docker-
 * gated the same way `live-witness.integration.test.ts`/
 * `check-live.integration.test.ts` are (own container, own database, own
 * cleanup) -- never runs under the default `pnpm test`, only
 * `pnpm --filter hejbro test:integration`.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `ha-pg-${process.pid}`;
// One database per independent `hejbro init` project, not one shared:
// hejbro's own migration ledger lives inside the target database, so two
// unrelated projects' migration directories would otherwise collide on
// the same ledger rows.
const DATABASE_C1 = "app_adoption_witness_c1";
const DATABASE_C2 = "app_adoption_witness_c2";
// 671/R8, review round 1: p7/p9/p6, the three live witnesses for the
// missing-column risk `adoption-creates` now names.
const DATABASE_P7 = "app_adoption_witness_p7";
const DATABASE_P9 = "app_adoption_witness_p9";
const DATABASE_P6 = "app_adoption_witness_p6";

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
			"the adoption live witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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
	// `CREATE DATABASE` cannot run inside a transaction block, and `psql -c`
	// with more than one statement wraps them in one -- two separate `-c`
	// invocations, not a semicolon-joined string.
	execFileSync("docker", [
		"exec",
		CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-c",
		`create database ${DATABASE_C1};`,
	]);
	execFileSync("docker", [
		"exec",
		CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-c",
		`create database ${DATABASE_C2};`,
	]);
	execFileSync("docker", [
		"exec",
		CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-c",
		`create database ${DATABASE_P7};`,
	]);
	execFileSync("docker", [
		"exec",
		CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-c",
		`create database ${DATABASE_P9};`,
	]);
	execFileSync("docker", [
		"exec",
		CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-c",
		`create database ${DATABASE_P6};`,
	]);
	assertBuiltCli();
}, 120_000);

afterAll(() => {
	removeContainer(CONTAINER);
});

const fixtureUrl = (database: string): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${database}`;

const SCHEMA_PATH = "src/app.schema.ts";

// C-1 (671/R7): the round trip the delta's own scenario still promises --
// a declaration whose only managed object is the sequence itself, no
// primary key, no index, no rls, no policy.
const SEQUENCE_ONLY_MANAGED_SOURCE = `import { schema, serial, table } from "hejbro";

export const c1 = schema("c1");

export const widgets = table(c1, "widgets", { id: serial() });
`;

const SEQUENCE_ONLY_EXISTING_SOURCE = `import { existingTable, integer, schema } from "hejbro";

export const c1 = schema("c1");

export const widgets = existingTable("c1", "widgets", { id: integer() });
`;

describe("adoption round trip / live witness -- sequence-only declaration (671/task 1.4, C-1)", () => {
	it("managed -> handover (sequence kept) -> re-adoption applies cleanly, and check reports no differences", async () => {
		const cwd = await createCliFixtureDir();
		const driver = pgDriver(fixtureUrl(DATABASE_C1));
		try {
			const init = await runCli(cwd, ["init"]);
			expect(init.exitCode).toBe(0);

			// Step 1: managed -- a serial column, nothing else.
			await writeFixtureFile(cwd, SCHEMA_PATH, SEQUENCE_ONLY_MANAGED_SOURCE);
			const firstGenerate = await runCli(cwd, ["generate"]);
			expect(firstGenerate.exitCode).toBe(0);
			const firstMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_C1),
			]);
			expect(firstMigrate.exitCode).toBe(0);
			expect(firstMigrate.stdout).toContain("migrate: applied");

			// Step 2: handover -- existingTable(), silent, sequence stays.
			await writeFixtureFile(cwd, SCHEMA_PATH, SEQUENCE_ONLY_EXISTING_SOURCE);
			const handoverGenerate = await runCli(cwd, ["generate"]);
			expect(handoverGenerate.exitCode).toBe(0);
			const handoverMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_C1),
			]);
			expect(handoverMigrate.exitCode).toBe(0);

			const sequenceAfterHandover = await driver.client.query(
				"select sequencename from pg_sequences where schemaname = $1 and sequencename = $2",
				["c1", "widgets_id_seq"],
			);
			expect(sequenceAfterHandover.rowCount).toBe(1);

			// Step 3: re-adopt -- the exact #694 reproduction point (a plain
			// `create sequence` here, pre-fix, would have failed `42P07`).
			await writeFixtureFile(cwd, SCHEMA_PATH, SEQUENCE_ONLY_MANAGED_SOURCE);
			const adoptGenerate = await runCli(cwd, ["generate"]);
			expect(adoptGenerate.exitCode).toBe(0);
			expect(adoptGenerate.stderr).toContain(
				"warning[adoption-creates]: c1.widgets",
			);
			const adoptMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_C1),
			]);
			expect(adoptMigrate.exitCode).toBe(0);
			expect(adoptMigrate.stdout).toContain("migrate: applied");
			expect(adoptMigrate.stderr).not.toContain("42P07");

			// The sequence exists, typed as declared.
			const sequenceRows = await driver.client.query(
				"select data_type from pg_sequences where schemaname = $1 and sequencename = $2",
				["c1", "widgets_id_seq"],
			);
			expect(sequenceRows.rowCount).toBe(1);
			expect(sequenceRows.rows[0]?.data_type).toBe("integer");

			// The sequence is owned by the declared column (`alter sequence …
			// owned by …`, not left ownerless).
			const ownedByRows = await driver.client.query(
				`select a.attname
				 from pg_depend d
				 join pg_class seq on seq.oid = d.objid and seq.relkind = 'S'
				 join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
				 where d.deptype = 'a' and seq.relname = $1`,
				["widgets_id_seq"],
			);
			expect(ownedByRows.rows.map((row) => row.attname)).toEqual(["id"]);

			// hejbro check reports no differences.
			const check = await runCli(cwd, [
				"check",
				"--url",
				fixtureUrl(DATABASE_C1),
			]);
			expect(check.exitCode).toBe(0);
			expect(check.stdout).toContain("check: no differences.");
		} finally {
			await driver.client.end();
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

// C-2 (671/R7): a genuine brownfield table -- one `psql` creates by hand,
// hejbro never having written a byte of it -- handed over to
// `existingTable()` and then adopted as a managed `table()` declaring an
// index, a check, a foreign key and a primary key together (J10's actual
// path: adopting an object hejbro did not create).
const SCHEMA_ONLY_SOURCE = `import { schema } from "hejbro";

export const c2 = schema("c2");
`;

const BARE_EXISTING_SOURCE = `import { existingTable, integer, schema, text, uuid } from "hejbro";

export const c2 = schema("c2");

export const widgets = existingTable("c2", "widgets", {
	id: uuid().notNull(),
	ownerId: uuid(),
	email: text(),
	qty: integer(),
});
`;

const BARE_ADOPT_SOURCE = `import { check, gt, index, integer, schema, table, text, uuid } from "hejbro";

export const c2 = schema("c2");

export const owners = table(c2, "owners", { id: uuid().primaryKey() });

export const widgets = table(
	c2,
	"widgets",
	{
		id: uuid().primaryKey(),
		ownerId: uuid(),
		email: text(),
		qty: integer(),
	},
	(t) => ({
		indexes: [index("widgets_email_idx").on(t.email)],
		checks: [check("widgets_qty_positive", gt(t.qty, 0))],
		foreignKeys: [
			{
				name: "widgets_owner_fk",
				columns: [t.ownerId],
				references: { table: owners, columns: [owners.id] },
			},
		],
	}),
);
`;

describe("brownfield adoption / live witness -- a table hejbro never created (671/task 1.4, C-2)", () => {
	it("a bare psql-made table adopts with its four declared children, and check reports no differences", async () => {
		const cwd = await createCliFixtureDir();
		const driver = pgDriver(fixtureUrl(DATABASE_C2));
		try {
			const init = await runCli(cwd, ["init"]);
			expect(init.exitCode).toBe(0);

			// Step 1: hejbro manages the schema itself first (a real, prior
			// migration) -- only the table is ever foreign to hejbro.
			await writeFixtureFile(cwd, SCHEMA_PATH, SCHEMA_ONLY_SOURCE);
			const schemaGenerate = await runCli(cwd, ["generate"]);
			expect(schemaGenerate.exitCode).toBe(0);
			const schemaMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_C2),
			]);
			expect(schemaMigrate.exitCode).toBe(0);
			expect(schemaMigrate.stdout).toContain("migrate: applied");

			// Step 2: a bare table appears inside that schema by hand -- hejbro
			// never wrote a byte of it.
			applySql(
				DATABASE_C2,
				`
				create table c2.widgets (
					id uuid not null,
					owner_id uuid,
					email text,
					qty integer
				);
			`,
			);

			// Step 3: existingTable() over the bare table -- the migration
			// carries no statements at all, the table stays fully untouched.
			await writeFixtureFile(cwd, SCHEMA_PATH, BARE_EXISTING_SOURCE);
			const firstGenerate = await runCli(cwd, ["generate"]);
			expect(firstGenerate.exitCode).toBe(0);
			expect(firstGenerate.stdout).toContain("carries no statements.");
			const firstMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_C2),
			]);
			expect(firstMigrate.exitCode).toBe(0);

			// Step 4: adopt -- index, check, foreign key and primary key all
			// declared together, `owners` created fresh as the FK's target.
			await writeFixtureFile(cwd, SCHEMA_PATH, BARE_ADOPT_SOURCE);
			const adoptGenerate = await runCli(cwd, ["generate"]);
			expect(adoptGenerate.exitCode).toBe(0);
			expect(adoptGenerate.stderr).toContain(
				"warning[adoption-creates]: c2.widgets",
			);
			const adoptMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_C2),
			]);
			expect(adoptMigrate.exitCode).toBe(0);
			expect(adoptMigrate.stdout).toContain("migrate: applied");

			// Catalog assertions: all four children exist.
			const indexRows = await driver.client.query(
				"select indexname from pg_indexes where schemaname = $1 and tablename = $2 and indexname = $3",
				["c2", "widgets", "widgets_email_idx"],
			);
			expect(indexRows.rowCount).toBe(1);

			const constraintRows = await driver.client.query(
				`select conname, contype
				 from pg_constraint
				 where conrelid = 'c2.widgets'::regclass
				 order by conname`,
			);
			expect(
				constraintRows.rows.map((row) => `${row.conname}:${row.contype}`),
			).toEqual([
				"widgets_owner_fk:f",
				"widgets_pkey:p",
				"widgets_qty_positive:c",
			]);

			// hejbro check reports no differences.
			const check = await runCli(cwd, [
				"check",
				"--url",
				fixtureUrl(DATABASE_C2),
			]);
			expect(check.exitCode).toBe(0);
			expect(check.stdout).toContain("check: no differences.");
		} finally {
			await driver.client.end();
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

// 671/R8, review round 1: p7 -- a column the database has, but the
// existing declaration never listed. No child ever touches that column,
// so nothing about B1's missing-column risk applies -- this is the
// ordinary partial-claim shape `existingTable()` is designed to allow,
// witnessed live so it isn't a claim resting on offline reasoning alone.

const P7_SCHEMA_ONLY_SOURCE = `import { schema } from "hejbro";

export const p7 = schema("p7");
`;

const P7_EXISTING_SOURCE = `import { existingTable, schema, text, uuid } from "hejbro";

export const p7 = schema("p7");

export const widgets = existingTable("p7", "widgets", {
	id: uuid().notNull(),
	email: text(),
});
`;

const P7_ADOPT_SOURCE = `import { index, schema, table, text, uuid } from "hejbro";

export const p7 = schema("p7");

export const widgets = table(
	p7,
	"widgets",
	{ id: uuid().primaryKey(), email: text() },
	(t) => ({
		indexes: [index("widgets_email_idx").on(t.email)],
	}),
);
`;

describe("brownfield adoption / live witness -- a column present but unlisted (671/task 1.3a, p7)", () => {
	it("adopts cleanly when the database holds a column the existing declaration never listed, as long as nothing declares a child on it", async () => {
		const cwd = await createCliFixtureDir();
		const driver = pgDriver(fixtureUrl(DATABASE_P7));
		try {
			const init = await runCli(cwd, ["init"]);
			expect(init.exitCode).toBe(0);

			await writeFixtureFile(cwd, SCHEMA_PATH, P7_SCHEMA_ONLY_SOURCE);
			await runCli(cwd, ["generate"]);
			const schemaMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P7),
			]);
			expect(schemaMigrate.exitCode).toBe(0);

			// The database holds `extra`; the existing declaration never
			// lists it -- exactly p7's own shape.
			applySql(
				DATABASE_P7,
				`
				create table p7.widgets (
					id uuid not null,
					email text,
					extra text
				);
			`,
			);

			await writeFixtureFile(cwd, SCHEMA_PATH, P7_EXISTING_SOURCE);
			const existingGenerate = await runCli(cwd, ["generate"]);
			expect(existingGenerate.exitCode).toBe(0);
			const existingMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P7),
			]);
			expect(existingMigrate.exitCode).toBe(0);

			await writeFixtureFile(cwd, SCHEMA_PATH, P7_ADOPT_SOURCE);
			const adoptGenerate = await runCli(cwd, ["generate"]);
			expect(adoptGenerate.exitCode).toBe(0);
			expect(adoptGenerate.stderr).toContain(
				"warning[adoption-creates]: p7.widgets",
			);
			const adoptMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P7),
			]);
			expect(adoptMigrate.exitCode).toBe(0);
			expect(adoptMigrate.stdout).toContain("migrate: applied");

			const indexRows = await driver.client.query(
				"select indexname from pg_indexes where schemaname = $1 and tablename = $2 and indexname = $3",
				["p7", "widgets", "widgets_email_idx"],
			);
			expect(indexRows.rowCount).toBe(1);

			const check = await runCli(cwd, [
				"check",
				"--url",
				fixtureUrl(DATABASE_P7),
			]);
			expect(check.exitCode).toBe(0);
			expect(check.stdout).toContain("check: no differences.");
		} finally {
			await driver.client.end();
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

// 671/R8, review round 1: p9 -- adopt with only the columns the database
// has, then a *following edit* (an ordinary managed-table alter, no
// longer an adoption) adds the column and its objects together. Both
// steps apply, and `check` reports no differences -- the way through
// `adoption-creates`'s own `Next:` names.

const P9_SCHEMA_ONLY_SOURCE = `import { schema } from "hejbro";

export const p9 = schema("p9");
`;

const P9_EXISTING_SOURCE = `import { existingTable, schema, text, uuid } from "hejbro";

export const p9 = schema("p9");

export const widgets = existingTable("p9", "widgets", {
	id: uuid().notNull(),
	email: text(),
});
`;

const P9_ADOPT_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const p9 = schema("p9");

export const widgets = table(p9, "widgets", { id: uuid().primaryKey(), email: text() });
`;

const P9_FOLLOWING_EDIT_SOURCE = `import { index, schema, table, text, uuid } from "hejbro";

export const p9 = schema("p9");

export const widgets = table(
	p9,
	"widgets",
	{ id: uuid().primaryKey(), email: text(), status: text() },
	(t) => ({
		indexes: [index("widgets_status_idx").on(t.status)],
	}),
);
`;

describe("brownfield adoption / live witness -- adopt with what the database has, add the rest later (671/task 1.3a, p9)", () => {
	it("adopts with the database's own columns, then a following managed edit adds the missing column and its index, and check reports no differences", async () => {
		const cwd = await createCliFixtureDir();
		const driver = pgDriver(fixtureUrl(DATABASE_P9));
		try {
			const init = await runCli(cwd, ["init"]);
			expect(init.exitCode).toBe(0);

			await writeFixtureFile(cwd, SCHEMA_PATH, P9_SCHEMA_ONLY_SOURCE);
			await runCli(cwd, ["generate"]);
			const schemaMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P9),
			]);
			expect(schemaMigrate.exitCode).toBe(0);

			applySql(
				DATABASE_P9,
				`
				create table p9.widgets (
					id uuid not null,
					email text
				);
			`,
			);

			await writeFixtureFile(cwd, SCHEMA_PATH, P9_EXISTING_SOURCE);
			await runCli(cwd, ["generate"]);
			const existingMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P9),
			]);
			expect(existingMigrate.exitCode).toBe(0);

			// Adopt with only the columns the database has -- a primary key
			// on `id`, nothing on any column the existing declaration didn't
			// carry (there is none here).
			await writeFixtureFile(cwd, SCHEMA_PATH, P9_ADOPT_SOURCE);
			const adoptGenerate = await runCli(cwd, ["generate"]);
			expect(adoptGenerate.exitCode).toBe(0);
			expect(adoptGenerate.stderr).toContain(
				"warning[adoption-creates]: p9.widgets",
			);
			const adoptMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P9),
			]);
			expect(adoptMigrate.exitCode).toBe(0);
			expect(adoptMigrate.stdout).toContain("migrate: applied");

			// A following edit: the table is managed now, so adding `status`
			// and its index together is an ordinary alter, not an adoption --
			// `generate` never mentions `adoption-creates` for it.
			await writeFixtureFile(cwd, SCHEMA_PATH, P9_FOLLOWING_EDIT_SOURCE);
			const followUpGenerate = await runCli(cwd, ["generate"]);
			expect(followUpGenerate.exitCode).toBe(0);
			expect(followUpGenerate.stderr).not.toContain("adoption-creates");
			const followUpMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P9),
			]);
			expect(followUpMigrate.exitCode).toBe(0);
			expect(followUpMigrate.stdout).toContain("migrate: applied");

			const indexRows = await driver.client.query(
				"select indexname from pg_indexes where schemaname = $1 and tablename = $2 and indexname = $3",
				["p9", "widgets", "widgets_status_idx"],
			);
			expect(indexRows.rowCount).toBe(1);

			const check = await runCli(cwd, [
				"check",
				"--url",
				fixtureUrl(DATABASE_P9),
			]);
			expect(check.exitCode).toBe(0);
			expect(check.stdout).toContain("check: no differences.");
		} finally {
			await driver.client.end();
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

// 671/R8, review round 1: p6 -- a child on a column the database
// genuinely lacks. `hejbro check --url` names the column beforehand
// (`error[check-object-missing]`, computed straight from declarations
// against the live catalog, no `generate` run needed first), and
// `hejbro migrate` fails loudly (`42703`) rather than being refused
// earlier -- the `Next:` line's own promise, witnessed live.

const P6_SCHEMA_ONLY_SOURCE = `import { schema } from "hejbro";

export const p6 = schema("p6");
`;

const P6_EXISTING_SOURCE = `import { existingTable, schema, text, uuid } from "hejbro";

export const p6 = schema("p6");

export const widgets = existingTable("p6", "widgets", {
	id: uuid().notNull(),
	email: text(),
});
`;

const P6_ADOPT_SOURCE = `import { index, schema, table, text, uuid } from "hejbro";

export const p6 = schema("p6");

export const widgets = table(
	p6,
	"widgets",
	{ id: uuid().primaryKey(), email: text(), status: text() },
	(t) => ({
		indexes: [index("widgets_status_idx").on(t.status)],
	}),
);
`;

describe("brownfield adoption / live witness -- a child on a column the database lacks (671/task 1.3a, p6)", () => {
	it("hejbro check names the missing column before migrate fails on it with 42703", async () => {
		const cwd = await createCliFixtureDir();
		const driver = pgDriver(fixtureUrl(DATABASE_P6));
		try {
			const init = await runCli(cwd, ["init"]);
			expect(init.exitCode).toBe(0);

			await writeFixtureFile(cwd, SCHEMA_PATH, P6_SCHEMA_ONLY_SOURCE);
			await runCli(cwd, ["generate"]);
			const schemaMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P6),
			]);
			expect(schemaMigrate.exitCode).toBe(0);

			applySql(
				DATABASE_P6,
				`
				create table p6.widgets (
					id uuid not null,
					email text
				);
			`,
			);

			await writeFixtureFile(cwd, SCHEMA_PATH, P6_EXISTING_SOURCE);
			await runCli(cwd, ["generate"]);
			const existingMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P6),
			]);
			expect(existingMigrate.exitCode).toBe(0);

			// The declaration now names `status`, a column the database
			// genuinely does not have -- `check` reads declarations straight
			// (`generateMigration` against the on-disk snapshot), so it
			// catches this before any `generate`/`migrate` for it ever runs.
			await writeFixtureFile(cwd, SCHEMA_PATH, P6_ADOPT_SOURCE);
			const checkBeforeGenerate = await runCli(cwd, [
				"check",
				"--url",
				fixtureUrl(DATABASE_P6),
			]);
			expect(checkBeforeGenerate.exitCode).toBe(1);
			expect(checkBeforeGenerate.stderr).toContain(
				"error[check-object-missing]: p6.widgets.status",
			);

			const adoptGenerate = await runCli(cwd, ["generate"]);
			expect(adoptGenerate.exitCode).toBe(0);
			expect(adoptGenerate.stderr).toContain(
				"warning[adoption-creates]: p6.widgets",
			);
			const adoptMigrate = await runCli(cwd, [
				"migrate",
				"--url",
				fixtureUrl(DATABASE_P6),
			]);
			expect(adoptMigrate.exitCode).toBe(1);
			expect(adoptMigrate.stderr).toContain("42703");
		} finally {
			await driver.client.end();
			await removeCliFixtureDir(cwd);
		}
	}, 60_000);
});

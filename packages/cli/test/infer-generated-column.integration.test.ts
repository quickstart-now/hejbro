import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** Mirrors `infer-catalog-inference-2.integration.test.ts`'s own helper -- stderr on every assertion so a future failure diagnoses itself. */
const expectExitCode = (label: string, run: CliRun, exitCode: number): void => {
	expect(
		run.exitCode,
		`${label} exited ${run.exitCode} -- stderr:\n${run.stderr}`,
	).toBe(exitCode);
};

/**
 * 712/R11 (B1, #1022) live witness: the reviewer's own `gen1` shape
 * (`/private/tmp/d106-cf/sql/gen1.sql`, `app2.t`) -- `total`/`label` round-
 * trip through `import` -> `baseline` -> a real replay database, and
 * `pg_dump --schema-only` agrees byte-for-byte with the source database on
 * both stored generated columns. Container `cfr1-pg`, fixed host port
 * 55770 (cfr1's own range, team-brief.md) -- never the shared
 * `hejbro-cli-*`/`cf-pg` naming, so this witness never collides with a
 * concurrently running team's own container.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = "cfr1-pg";
const HOST_PORT = 55770;
const DATABASE = "gen1_live";
const REPLAY_DATABASE = "gen1_live_replay";

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

const schemaDump = (database: string, schemaName = "app2"): string =>
	execFileSync(
		"docker",
		[
			"exec",
			CONTAINER,
			"pg_dump",
			"-U",
			"postgres",
			"--schema-only",
			"-n",
			schemaName,
			database,
		],
		{ encoding: "utf-8" },
	);

/**
 * The reviewer's own `app2.t` (`/private/tmp/d106-cf/sql/gen1.sql`),
 * trimmed to `total`/`label` and the columns their own expressions name --
 * everything else `gen1.sql` carries is a different B/N finding's own
 * input, out of this task's scope (2.1). `xcell` is 712/R12's own two
 * mandatory cross-cutting cells, live: cell 1 (a generated column's
 * expression names a column this reading already omits, for its own
 * name and for an omitted enum's own name) and cell 2 (a generated
 * column typed by something no column builder expresses at all).
 */
const SCHEMA_SQL = `
create schema app2;
create table app2.t (
	id integer primary key,
	a integer not null,
	b integer not null,
	total integer generated always as (a + b) stored,
	label text generated always as (upper(a::text)) stored
);
insert into app2.t (id, a, b) values (1, 3, 4);

create schema xcell;
create type xcell."Status" as enum ('open', 'closed');

create table xcell.name_cause (
	id integer primary key,
	"Bad Name" integer not null,
	total integer generated always as ("Bad Name" + 1) stored
);

-- st::text is not immutable (an enum's own cast to text depends on a
-- label set ALTER TYPE ... ADD VALUE can change, measured,
-- postgres:17-alpine: "generation expression is not immutable") -- a
-- CASE over the enum value's own equality is, and pg_depend still
-- records the same normal dependency on "st" either way.
create table xcell.enum_cause (
	id integer primary key,
	st xcell."Status" not null,
	label2 text generated always as (
		case when st = 'open' then 'O' else 'C' end
	) stored
);

-- money's own numeric/money cast is not immutable (postgres:17-alpine:
-- "generation expression is not immutable"), so int4range's own
-- constructor stands in as the unsupported-type witness -- still a type
-- no column builder expresses (evaluation.md's own not-inferred list).
create table xcell.type_cause (
	id integer primary key,
	a integer not null,
	rng int4range generated always as (int4range(a, a + 1)) stored
);

-- cfr1-planner's own measurement 2 (second-order cascade): an index, a
-- check constraint, a unique constraint and a foreign key from another
-- table, all naming the same generated column an omitted column already
-- costs -- every one of them has to be excluded too, or the starter
-- declares an index/check/unique on a column that does not exist and a
-- foreign key whose own target column evaluates to undefined.
create schema cascade_test;
create table cascade_test.t (
	id integer primary key,
	"Bad Name" integer not null,
	total integer generated always as ("Bad Name" + 1) stored,
	constraint t_total_uq unique (total)
);
create index t_total_idx on cascade_test.t (total);
alter table cascade_test.t add constraint t_total_chk check (total > 0);

create table cascade_test.ref (
	id integer primary key,
	total_ref integer not null,
	constraint ref_total_fkey foreign key (total_ref) references cascade_test.t (total)
);
`;

let cwd = "";
let importRun: CliRun;
let baselineRun: CliRun;
let checkRun: CliRun;
let starterSource = "";
let xcellStarterSource = "";
let cascadeStarterSource = "";
let migrationSql = "";

const fixtureUrl = (): string =>
	`postgres://postgres@127.0.0.1:${HOST_PORT}/${DATABASE}`;

beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"the generated-column witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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
			`127.0.0.1:${HOST_PORT}:5432`,
			IMAGE,
		],
		{ stdio: "ignore" },
	);
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
		"app2",
		"--schema",
		"xcell",
		"--schema",
		"cascade_test",
		"--out",
		"src/schema",
	]);
	expectExitCode("import", importRun, 0);
	starterSource = readFileSync(
		resolve(cwd, "src/schema/app2.schema.ts"),
		"utf8",
	);
	xcellStarterSource = readFileSync(
		resolve(cwd, "src/schema/xcell.schema.ts"),
		"utf8",
	);
	cascadeStarterSource = readFileSync(
		resolve(cwd, "src/schema/cascade_test.schema.ts"),
		"utf8",
	);

	baselineRun = await runCli(cwd, ["baseline"]);
	expectExitCode("baseline", baselineRun, 0);
	const migrationDir = resolve(cwd, "migrations");
	const migrationFileNames = readdirSync(migrationDir).filter((name) =>
		name.endsWith(".sql"),
	);
	if (migrationFileNames.length !== 1) {
		throw new Error(
			`expected exactly one baseline migration file, found: ${migrationFileNames.join(", ")}`,
		);
	}
	const [migrationFileName] = migrationFileNames;
	migrationSql = readFileSync(
		resolve(migrationDir, migrationFileName as string),
		"utf8",
	);

	execFileSync("docker", [
		"exec",
		CONTAINER,
		"psql",
		"-U",
		"postgres",
		"-c",
		`create database ${REPLAY_DATABASE};`,
	]);
	psqlFile(REPLAY_DATABASE, migrationSql);

	checkRun = await runCli(cwd, ["check", "--url", fixtureUrl()]);
}, 120_000);

afterAll(async () => {
	removeContainer(CONTAINER);
	await removeCliFixtureDir(cwd);
});

describe("712/R11 (B1, #1022) live witness: total/label round-trip through import -> baseline -> a real replay database", () => {
	it("the starter carries generatedAlwaysAs with the catalog's own expression text, never a plain column", () => {
		expect(starterSource).toContain('.generatedAlwaysAs(sql.raw("(a + b)"))');
		expect(starterSource).toContain(
			'.generatedAlwaysAs(sql.raw("upper((a)::text)"))',
		);
		expect(starterSource).not.toContain("total: integer(),");
		expect(starterSource).not.toContain("label: text(),");
	});

	it("no band of the loss report names total or label -- a correctly carried column is never also announced as a loss", () => {
		expect(importRun.stdout).not.toContain("app2.t.total");
		expect(importRun.stdout).not.toContain("app2.t.label");
	});

	it("baseline's own migration SQL carries GENERATED ALWAYS AS ... STORED for both columns", () => {
		expect(migrationSql).toContain("generated always as ((a + b)) stored");
		expect(migrationSql).toContain(
			"generated always as (upper((a)::text)) stored",
		);
	});

	it("the replay database's own pg_dump agrees with the source database, on both stored generated columns", () => {
		const sourceDump = schemaDump(DATABASE);
		const replayDump = schemaDump(REPLAY_DATABASE);
		expect(sourceDump).toContain(
			"total integer GENERATED ALWAYS AS ((a + b)) STORED",
		);
		expect(sourceDump).toContain(
			"label text GENERATED ALWAYS AS (upper((a)::text)) STORED",
		);
		expect(replayDump).toContain(
			"total integer GENERATED ALWAYS AS ((a + b)) STORED",
		);
		expect(replayDump).toContain(
			"label text GENERATED ALWAYS AS (upper((a)::text)) STORED",
		);
	});

	it("`hejbro check --url` against the very database that was imported reports no differences", () => {
		expectExitCode("check", checkRun, 0);
		expect(checkRun.stdout).not.toContain("app2.t.total");
		expect(checkRun.stdout).not.toContain("app2.t.label");
		expect(checkRun.stdout).toContain("check: no differences.");
	});
});

/** The `create table "xcell"."<name>"` block alone, up to the next top-level `create` -- scoped so a bare `total`/`label`/`rng` match never false-positives on `app2.t`'s own legitimate `total`/`label` columns in the same migration file. */
const xcellTableBlock = (
	migrationSqlText: string,
	tableName: string,
): string => {
	const start = migrationSqlText.indexOf(`create table "xcell"."${tableName}"`);
	if (start === -1) {
		throw new Error(
			`expected a create table block for "xcell"."${tableName}":\n${migrationSqlText}`,
		);
	}
	const end = migrationSqlText.indexOf("\ncreate ", start + 1);
	if (end === -1) {
		return migrationSqlText.slice(start);
	}
	return migrationSqlText.slice(start, end);
};

/**
 * 712/R12's own two mandatory cross-cutting cells, live (planner
 * request, not satisfied by the fake-`DriverSession` unit tests alone):
 * whether this fix opens a new failure mode when a generated column's
 * expression names a column this reading already omits, measured
 * through the real CLI (`import` -> `baseline` -> the migration SQL
 * actually applied to an empty database with `ON_ERROR_STOP=1`, the
 * live equivalent of `psql -1`) rather than a hand-matched SQL string.
 */
describe("712/R11/R12 cross-cutting cell 1 (name cause, enum cause) and cell 2 (unsupported type), live", () => {
	it("cell 1, name cause: the starter never declares `total`, and the loss report names it as an omitted generated column", () => {
		// Scoped to a declared property key (`total:`), never a bare
		// substring match -- the header comment's own "Omitted: generated
		// column ... total ..." line legitimately names it in prose, which
		// is the whole point of this fix (never silence).
		expect(xcellStarterSource).not.toMatch(/\btotal:/);
		expect(xcellStarterSource).not.toContain('"Bad Name"');
		expect(importRun.stdout).toContain(
			'Omitted: generated column "xcell.name_cause.total" -- its expression names column "xcell.name_cause.Bad Name", which this reading left out because no declaration can carry its name, so the generated column cannot be declared either.',
		);
	});

	it("cell 1, enum cause: the starter never declares `label2`, and the loss report names it as an omitted generated column with the enum cause", () => {
		expect(xcellStarterSource).not.toMatch(/label2:/);
		expect(importRun.stdout).toContain(
			'Omitted: generated column "xcell.enum_cause.label2" -- its expression names column "xcell.enum_cause.st", which this reading left out with the enum type "xcell.Status" that types it, so the generated column cannot be declared either.',
		);
	});

	it("cell 2: `rng` (int4range, no column builder) is named only by the existing Not-inferred type line, never silently", () => {
		expect(xcellStarterSource).not.toMatch(/\brng:/);
		expect(importRun.stdout).toContain(
			'Not inferred: column "xcell.type_cause.rng" (type "int4range") -- no column builder expresses it.',
		);
		expect(
			importRun.stdout
				.split("\n")
				.some(
					(line) => line.startsWith("Approximated:") && line.includes("rng"),
				),
		).toBe(false);
	});

	it("baseline's own migration SQL, applied to an empty database with ON_ERROR_STOP=1, never fails on a generated column naming a column this reading omitted", () => {
		// The regression this cross-cutting cell exists to catch: neither
		// omitted generated column's own name, nor the column its
		// expression named, ever reaches the SQL a following `baseline`
		// actually replays (already proved live by REPLAY_DATABASE's own
		// successful `psqlFile` call in `beforeAll` -- ON_ERROR_STOP=1
		// would have thrown there if this failed, the same way the review's
		// own db2-enum.sql replay failure did). Each block is `xcell`'s own
		// alone, never `app2.t`'s legitimate `total`/`label`.
		expect(migrationSql).not.toContain('"Bad Name"');
		expect(xcellTableBlock(migrationSql, "name_cause")).not.toContain(
			'"total"',
		);
		expect(xcellTableBlock(migrationSql, "enum_cause")).not.toContain(
			'"label2"',
		);
		expect(xcellTableBlock(migrationSql, "type_cause")).not.toContain('"rng"');
	});

	it("`hejbro check --url` lists every left-out column and generated column as unmanaged, never fails the run for them", () => {
		expectExitCode("check", checkRun, 0);
		expect(checkRun.stdout).toContain("unmanaged column");
		expect(checkRun.stdout).toContain("xcell.name_cause.Bad Name");
		expect(checkRun.stdout).toContain("xcell.name_cause.total");
		expect(checkRun.stdout).toContain("xcell.enum_cause.st");
		expect(checkRun.stdout).toContain("xcell.enum_cause.label2");
		expect(checkRun.stdout).toContain("xcell.type_cause.rng");
		expect(checkRun.stdout).toContain("check: no differences.");
	});

	/**
	 * cfr1-planner's own measurement ①: the omitted-generated-column
	 * lines' shared `check` promise ("keeps listing the generated column
	 * as unmanaged until that column and the generated column are both
	 * declared") is `buildInventory`'s own mechanism (`check/
	 * inventory.ts`'s `unmanagedColumns` -- any catalog column absent
	 * from a managed table's snapshot node, regardless of why), never
	 * assumed true just because index/check-at-an-omitted-column already
	 * measured true for it -- pinned here by actually renaming the
	 * database column and hand-declaring both, live.
	 */
	it("measurement 1: renaming the omitted column and hand-declaring both ends the inventory listing for the generated column too", async () => {
		execFileSync("docker", [
			"exec",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-d",
			DATABASE,
			"-v",
			"ON_ERROR_STOP=1",
			"-c",
			'alter table xcell.name_cause rename column "Bad Name" to bad_name;',
		]);

		const schemaPath = resolve(cwd, "src/schema/xcell.schema.ts");
		const handDeclared = xcellStarterSource.replace(
			'export const nameCause = table(\n\txcell,\n\t"name_cause",\n\t{\n\t\tid: integer().notNull().primaryKey(),\n\t},\n);',
			[
				"export const nameCause = table(",
				"\txcell,",
				'\t"name_cause",',
				"\t{",
				"\t\tid: integer().notNull().primaryKey(),",
				"\t\tbadName: integer().notNull(),",
				'\t\ttotal: integer().generatedAlwaysAs(sql.raw("(bad_name + 1)")),',
				"\t},",
				");",
			].join("\n"),
		);
		if (handDeclared === xcellStarterSource) {
			throw new Error(
				`expected nameCause's own table() block to match and replace, got:\n${xcellStarterSource}`,
			);
		}
		writeFileSync(
			schemaPath,
			handDeclared.replace(
				'import { integer, schema, table } from "hejbro";',
				'import { integer, schema, sql, table } from "hejbro";',
			),
			"utf8",
		);

		const renamedCheckRun = await runCli(cwd, ["check", "--url", fixtureUrl()]);
		expectExitCode("check (after rename + hand-declare)", renamedCheckRun, 0);
		expect(renamedCheckRun.stdout).not.toContain("xcell.name_cause.total");
		expect(renamedCheckRun.stdout).not.toContain("xcell.name_cause.Bad Name");
		expect(renamedCheckRun.stdout).not.toContain("xcell.name_cause.bad_name");
	});
});

/**
 * cfr1-planner's own measurement 2 (second-order cascade), lead pre-
 * ruling (a): a generated column that is itself omitted (cell 1) can
 * still be named by an index, a check constraint, a unique constraint
 * or a foreign key -- every one of those has to be excluded too, the
 * same "no declaration a starter loads may reference an object this
 * reading omitted" rule B#1 already gives every other omitted object.
 * Measured broken before this section's own fix (`ColumnOmissionCause`
 * widened to a third `"generatedExpression"` variant, threaded through
 * `partitionForeignKeys`/`excludePrimaryKeysReferencingOmittedColumns`/
 * `excludeMembersReferencingOmittedColumns` via one shared map, computed
 * ahead of all three): `baseline` failed live with
 * `error[foreign-key-empty-references]: ref` (the FK's own target
 * column, `t2.total`, evaluated to `undefined`), never even reaching a
 * `psql -1` replay.
 */
describe("712/R11/R12 cross-cutting cell 1, second-order cascade: an index, check, unique constraint and foreign key naming an omitted generated column", () => {
	it("the starter never declares any of them, and the loss report names each with the generated-expression cause", () => {
		// Scoped to a declared property key or an index/check/FK call site,
		// never a bare substring -- the header comment's own "Omitted: ..."
		// lines legitimately name every one of these in prose (the whole
		// point of this fix, never silence).
		expect(cascadeStarterSource).not.toMatch(/\btotal:/);
		expect(cascadeStarterSource).not.toContain('index("t_total_idx")');
		expect(cascadeStarterSource).not.toContain('check("t_total_chk"');
		expect(cascadeStarterSource).not.toContain("unique().on(");
		expect(cascadeStarterSource).not.toContain("foreignKeys:");

		// 712/R12 (B, lead ruling): the root cause is named, not anonymous --
		// "Bad Name" is this cascade's own root, and its own cause is
		// "name", so the compressed name-root clause applies.
		const causeClause =
			'which this reading left out because its expression names column "cascade_test.t.Bad Name", whose own name no declaration can carry';
		expect(importRun.stdout).toContain(
			`Omitted: index "cascade_test.t.t_total_idx" -- it is declared on column "cascade_test.t.total", ${causeClause}, so the index cannot be declared either.`,
		);
		expect(importRun.stdout).toContain(
			`Omitted: check constraint "cascade_test.t.t_total_chk" -- its expression names column "cascade_test.t.total", ${causeClause}, so the check constraint cannot be declared either.`,
		);
		expect(importRun.stdout).toContain(
			`Omitted: unique constraint "cascade_test.t.t_total_uq" -- it is declared on column "cascade_test.t.total", ${causeClause}, so the unique constraint cannot be declared either.`,
		);
		expect(importRun.stdout).toContain(
			`Omitted: foreign key "cascade_test.ref.ref_total_fkey" -- it references column "cascade_test.t.total", ${causeClause}, so the key cannot be declared either.`,
		);
	});

	it("the starter loads through the production loader's own jiti, and baseline already succeeded", async () => {
		const schemaPath = resolve(cwd, "src/schema/cascade_test.schema.ts");
		const jiti = createJiti(schemaPath, { fsCache: false });
		await expect(jiti.import(schemaPath)).resolves.toBeDefined();
		// `baseline` already ran once in `beforeAll`, against every imported
		// schema at once (including this one) -- exit 0 there is this
		// measurement's own central claim: cfr1-planner's own reproduction
		// against the unfixed code failed exactly here, live,
		// `error[foreign-key-empty-references]: ref`.
		expectExitCode("baseline", baselineRun, 0);
	});

	it("baseline's own migration SQL for cascade_test.t and cascade_test.ref never names total or any member bound to it", () => {
		const tBlockStart = migrationSql.indexOf('create table "cascade_test"."t"');
		const refBlockStart = migrationSql.indexOf(
			'create table "cascade_test"."ref"',
		);
		expect(tBlockStart).toBeGreaterThan(-1);
		expect(refBlockStart).toBeGreaterThan(-1);
		const tBlockEnd = migrationSql.indexOf("\ncreate ", tBlockStart + 1);
		const refBlockEnd = migrationSql.indexOf("\ncreate ", refBlockStart + 1);
		const tBlock = migrationSql.slice(tBlockStart, tBlockEnd);
		const refBlock = migrationSql.slice(refBlockStart, refBlockEnd);
		expect(tBlock).not.toContain('"total"');
		expect(refBlock).not.toContain("foreign key");
		expect(refBlock).not.toContain("ref_total_fkey");
	});

	it("`hejbro check --url` lists every left-out object as unmanaged, and still exits 0", () => {
		expectExitCode("check", checkRun, 0);
		expect(checkRun.stdout).toContain("cascade_test.t.Bad Name");
		expect(checkRun.stdout).toContain("cascade_test.t.total");
		expect(checkRun.stdout).toContain(
			"unmanaged index (not covered by any declaration): cascade_test.t.t_total_idx",
		);
		expect(checkRun.stdout).toContain(
			"unmanaged check constraint (not covered by any declaration): cascade_test.t.t_total_chk",
		);
		expect(checkRun.stdout).toContain("check: no differences.");
	});
});

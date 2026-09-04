import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Snapshot } from "@hejbro/core";
import {
	emptySnapshot,
	generateMigration,
	grant,
	parseSnapshot,
	requiredKeysByKind,
	roleName,
	schema,
	serial,
	table,
	uuid,
} from "@hejbro/core";
import { pgDriver } from "@hejbro/pg";
import type { CompileResult, Driver } from "@hejbro/query";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_CATALOG_QUERIES, readCatalog } from "../src/check/catalog";
import { compareCatalog } from "../src/check/compare";
import {
	compareCheckAgainstCatalog,
	declaredCheckConstraints,
} from "../src/commands/check";
import { requireConfigFields } from "../src/config-required";
import { loadConfig, loadDeclarations } from "../src/loader";
import { buildRegistry } from "../src/presets";
import { readSnapshotFileText } from "../src/snapshot-file";
import { removeContainer } from "./docker-volumes";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

/**
 * The other half of the fixture pins group 1-5 wrote (owner decision ⑤,
 * group 6 header): unit tests fixed the *shape* of every query and every
 * probe; this file is the only place any of them runs against a real
 * server. Never runs under the default `pnpm test`/CI (wired via
 * `vitest.integration.config.ts` + `vitest.config.ts`'s own exclude
 * patterns, mirroring packages/pg's split) -- local-only,
 * `pnpm --filter hejbro test:integration`. Docker-gated: `beforeAll`
 * fails loudly (never a silent skip) when no daemon answers, the same
 * idiom packages/pg's own integration suite uses -- a skip reads as a
 * pass this suite exists specifically to never allow.
 *
 * Both witness forms live here, deliberately (tasks.md 6.1's own note),
 * because each proves something the other cannot. **In-process**
 * (`readCatalog`/`compareCatalog`/`declaredCheckConstraints` called
 * directly against a real `pgDriver`) for facts that live *inside* a run
 * and a report's text is never obliged to expose: how many check
 * constraints were actually compared, that the pinned catalog queries
 * went out verbatim, that a limited role produced identical findings.
 * **A spawned CLI** (`runCli`, same helper generate-command.test.ts and
 * check-command.test.ts's own `--url=` regression guard use) for the
 * contract that exists only in a process: the three-way exit code (4.5),
 * and argv actually reaching the command, which is precisely what
 * `--url=`'s own defect (task 4.1) slipped through -- every earlier
 * in-process test was structurally blind to it. Spawning needs
 * `@hejbro/pg` resolvable from *this package's own location* (measured:
 * a spawned CLI in this monorepo fails with `check-driver-missing`
 * without it, because `import("@hejbro/pg")` resolves from `dist/
 * cli.js`'s own directory, not the invoking project's) -- added as a
 * devDependency (task 6.1) rather than worked around with a symlink.
 */
const EXAMPLE_DIR = resolve(import.meta.dirname, "../../../examples/postgres");
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-check-${process.pid}`;

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
 * Neither `pg_isready` nor a probing `psql` call is enough on its own:
 * the official postgres image's entrypoint runs `initdb`, briefly starts
 * a *temporary* bootstrap server to seed it, shuts that down, then
 * starts the real one -- both can succeed against that bootstrap window
 * (measured: an intermittent "connection to server on socket ... failed:
 * No such file or directory" from the very next `psql` call, because the
 * bootstrap server had already answered "ready" and then shut down for
 * the restart before that next call ran, roughly 1 run in 5). The
 * postgres entrypoint itself logs "database system is ready to accept
 * connections" once for the bootstrap server and once more for the final
 * one -- waiting for the *second* occurrence is what actually closes
 * this race, rather than narrowing its window. Stress-tested at 9/9
 * clean runs after this fix, versus intermittent failures before it.
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

/** `docker port` prints one line per bound address family -- the first line's trailing `host:port` is enough, matching scripts/roundtrip.sh's own parsing. */
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

const psqlCommand = (database: string, sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-d",
			database,
			"-c",
			sql,
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
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

const hostUrl = (role: string, database: string): string =>
	`postgres://${role}@127.0.0.1:${hostPort}/${database}`;

beforeAll(async () => {
	assertBuiltCli();
	if (!dockerAvailable()) {
		throw new Error(
			"packages/cli's live-witness suite needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
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
			// 6.4's own pin-vs-reality check reads this back from the
			// container's own logs -- there is no other way to observe what
			// was actually sent to the server, in-process or not.
			"-c",
			"log_statement=all",
		],
		{ stdio: "ignore" },
	);
	await waitUntilReady(60);
	hostPort = containerPort();

	psqlCommand("postgres", "create database chain;");
	psqlFile(
		"chain",
		readFileSync(resolve(EXAMPLE_DIR, "seed/roles.sql"), "utf-8"),
	);
	const migrationsDir = resolve(EXAMPLE_DIR, "migrations");
	const migrationFiles = readdirSync(migrationsDir)
		.filter((name) => name.endsWith(".sql"))
		.sort();
	migrationFiles.map((name) =>
		psqlFile("chain", readFileSync(resolve(migrationsDir, name), "utf-8")),
	);
}, 120_000);

afterAll(() => {
	removeContainer(CONTAINER);
});

const chainUrl = (): string => hostUrl("postgres", "chain");

/** Rebuilds the declared snapshot the same way `runCheck` does (its own construction isn't separately exported) -- needed here only for the in-process witnesses below, which inspect facts (`declaredCheckConstraints`'s count, `compareCatalog`'s own findings) a spawned process's report text never exposes. */
const buildExampleSnapshot = async (): Promise<Snapshot> => {
	const { config, configPath } = await loadConfig(EXAMPLE_DIR, undefined);
	requireConfigFields(config, "check", ["snapshotPath"]);
	const declarations = await loadDeclarations(configPath, config);
	const registry = buildRegistry(config);
	const diskSnapshot = parseSnapshot(
		readSnapshotFileText(EXAMPLE_DIR, config, "check"),
		requiredKeysByKind(registry),
	);
	return generateMigration({
		declarations,
		previousSnapshot: diskSnapshot,
		registry,
	}).snapshot;
};

describe("hejbro check / live witness (group 6)", () => {
	it("connects to a real postgres and reads its catalog (6.1)", async () => {
		const result = await runCli(EXAMPLE_DIR, ["check", "--url", chainUrl()]);

		// A connection or catalog-read failure would exit 1 with a
		// precondition diagnostic and no coverage-boundary statement
		// (check.ts's own `preconditionErrorReport`) -- reaching the full
		// render path (this line only ever prints there) is itself proof
		// the connection opened and the catalog was read.
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("check does not compare view bodies.");
	});

	it("reports no differences for the example's own declarations (6.2)", async () => {
		const result = await runCli(EXAMPLE_DIR, ["check", "--url", chainUrl()]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("check: no differences.");
		expect(result.stderr).toBe("");
	});

	it("compares every check constraint the example declares (6.2)", async () => {
		// In-process (tasks.md 6.1's own note): "how many check constraints
		// were actually compared" is a fact a report's text never promises
		// to expose, so it is asserted directly against the functions that
		// do the comparing, not inferred from a process's exit code.
		const snapshot = await buildExampleSnapshot();
		const constraints = declaredCheckConstraints(snapshot);

		// The example declares exactly 8 check constraints (members: 1,
		// projects: 1, tasks: 4, task_schedules: 1, comments: 1) -- zero
		// compared would still pass a bare "no differences" assertion, which
		// is exactly the silent-pass failure mode this command exists to
		// end.
		expect(constraints).toHaveLength(8);

		const driver = pgDriver(chainUrl());
		try {
			const catalog = await readCatalog(driver);
			const findings = await compareCheckAgainstCatalog(
				snapshot,
				catalog,
				driver,
			);
			expect(findings).toEqual([]);
		} finally {
			await driver.client.end();
		}
	});

	it("reports the altered column, and only it, against a real server (6.3)", async () => {
		// Control first (owner criterion): the unaltered column must pass,
		// so a later failure is provably caused by the alteration below, not
		// by some pre-existing fixture defect.
		const before = await runCli(EXAMPLE_DIR, ["check", "--url", chainUrl()]);
		expect(before.exitCode).toBe(0);

		// projects.name (text, notNull, no default) -- unlike every tasks
		// column (open_tasks is `select(tasks)`, so *any* tasks column's
		// type change breaks that view's dependency, measured directly:
		// altering tasks.closed_at failed with "rule _RETURN on view
		// app.open_tasks depends on column"), no view, check, or RLS policy
		// references this one, so the diff this produces is isolated to
		// this one column.
		psqlCommand(
			"chain",
			"alter table app.projects alter column name type varchar(100)",
		);

		try {
			const after = await runCli(EXAMPLE_DIR, ["check", "--url", chainUrl()]);

			expect(after.exitCode).toBe(1);
			expect(after.stderr).toContain("app.projects.name");
			const differsCount = (after.stderr.match(/check-object-differs/g) ?? [])
				.length;
			expect(differsCount).toBe(1);
		} finally {
			psqlCommand(
				"chain",
				"alter table app.projects alter column name type text",
			);
		}
	});

	it("exits 2 against a real server when a check constraint cannot be compared", async () => {
		// The process-only half of the 3-way contract (4.5): 0 and 1 are
		// already covered above via the CLI itself (6.2's "no differences",
		// 6.3's altered column) -- this is 2's own live witness, and the
		// reviewer's own validated negative control: revoking SELECT on one
		// table leaves that table's own structural comparison untouched
		// (readCatalog's reads are all over pg_catalog, role-independent by
		// 1.4) but fails the EXPLAIN probe every one of its check
		// constraints' expression comparison depends on, so all four of
		// tasks's own check constraints (tasks_title_length,
		// tasks_status_valid, tasks_priority_range,
		// tasks_estimate_hours_non_negative) report as not-compared -- and
		// nothing else in the fixture disagrees, so the exit code is 2, not
		// 1.
		psqlCommand(
			"chain",
			"create role check_live_limited login; grant usage on schema app to check_live_limited; grant select on all tables in schema app to check_live_limited; revoke select on app.tasks from check_live_limited;",
		);
		try {
			const result = await runCli(EXAMPLE_DIR, [
				"check",
				"--url",
				hostUrl("check_live_limited", "chain"),
			]);

			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("check-not-compared");
			expect(result.stderr).toContain("could not be compared");
			expect(result.stderr).not.toContain("check-object-differs");
			expect(result.stderr).not.toContain("check-object-missing");
		} finally {
			// `drop role` alone fails while any grant to it still exists
			// (measured: "cannot be dropped because some objects depend on
			// it", naming every table/schema privilege granted above) --
			// `drop owned by` revokes them all first.
			psqlCommand(
				"chain",
				"drop owned by check_live_limited; drop role check_live_limited;",
			);
		}
	});
});

describe("hejbro check / role independence (group 6, task 6.4)", () => {
	const RoleDb = "role_check";
	const UppercaseRole = '"Reader"';
	const LimitedRole = "limited_reader";

	// Built once in `beforeAll`, read by the `it`s below -- `check:bans`
	// only walks `packages/*/src` (AGENTS.md), so `let` is available here,
	// but this is still the one piece of state this describe block needs
	// to thread from setup to assertion.
	let snapshot: Snapshot | undefined;

	beforeAll(() => {
		psqlCommand("postgres", `create database ${RoleDb};`);
		psqlCommand(
			RoleDb,
			`create role ${UppercaseRole} login; create role ${LimitedRole} login;`,
		);

		// The declared schema itself (owner = the connecting "postgres"
		// role): one table, one grant to the *owner* role (1.4's own trap --
		// redundant with the owner's already-implicit privileges, so
		// Postgres is expected to leave `relacl` NULL for it), one grant to
		// a mixed-case role (C2's `pg_get_userbyid` fix, live). `all-tables-
		// privileges` covers only this schema's one declared table (C1's
		// own scoping).
		const roleSchema = schema(RoleDb);
		const ownerRole = roleName("postgres");
		const readerRole = roleName("Reader");
		const widgets = table(roleSchema, "widgets", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const ownerGrant = grant(roleSchema).tables("select").to(ownerRole);
		const readerGrant = grant(roleSchema).tables("select").to(readerRole);
		const migration = generateMigration({
			declarations: [roleSchema, widgets, ownerGrant, readerGrant],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.errors).toEqual([]);
		psqlFile(RoleDb, migration.sql);
		snapshot = migration.snapshot;
	}, 60_000);

	const roleDbUrl = (role: string): string => hostUrl(role, RoleDb);

	it("reports the same findings as a limited role as it does as the owner", async () => {
		if (snapshot === undefined) {
			throw new Error("beforeAll did not build the fixture snapshot");
		}
		const ownerDriver = pgDriver(roleDbUrl("postgres"));
		const limitedDriver = pgDriver(roleDbUrl(LimitedRole));
		try {
			const ownerCatalog = await readCatalog(ownerDriver);
			const limitedCatalog = await readCatalog(limitedDriver);
			const ownerFindings = compareCatalog(snapshot, ownerCatalog);
			const limitedFindings = compareCatalog(snapshot, limitedCatalog);

			// The trap this fixture exists for: an owner-implicit grant
			// (`relacl` left NULL by Postgres) or the mixed-case role's grant
			// read back wrong would surface here as a non-empty findings
			// list, for *either* role -- "both roles agree on 'no grants'"
			// would still pass a bare equality check, which is why both are
			// asserted empty, not just equal to each other.
			expect(ownerFindings).toEqual([]);
			expect(limitedFindings).toEqual([]);
			expect(limitedFindings).toEqual(ownerFindings);
		} finally {
			await ownerDriver.client.end();
			await limitedDriver.client.end();
		}
	});

	it("runs the catalog queries 1.4 pinned, verbatim", async () => {
		// Wraps an already-open driver so every statement it executes is
		// also recorded -- the only way this check can compare "what 1.4
		// pinned" against "what was actually sent" without modifying
		// `readCatalog` itself for a test-only concern. `driver.client`
		// (needed for teardown) survives the spread since `pgDriver()`
		// returns a plain object literal, never a class instance.
		const rawDriver = pgDriver(roleDbUrl("postgres"));
		const sentSql: string[] = [];
		const capturingDriver: Driver & {
			readonly client: { end(): Promise<void> };
		} = {
			...rawDriver,
			execute: async (compiled: CompileResult) => {
				sentSql.push(compiled.sql);
				return rawDriver.execute(compiled);
			},
		};
		try {
			await readCatalog(capturingDriver);

			expect(sentSql).toContain(CHECK_CATALOG_QUERIES.tableGrants);
			expect(sentSql).toContain(CHECK_CATALOG_QUERIES.schemaUsageGrants);
			expect(sentSql).toContain(CHECK_CATALOG_QUERIES.defaultTableGrants);
		} finally {
			await rawDriver.client.end();
		}
	});
});

/**
 * #716: `check` used to report every `serial()` column as missing its
 * default, because the catalog's `nextval(...)` text is `search_path`-
 * sensitive (`pg_get_expr` qualifies the sequence only when its schema
 * isn't on the reading role's `search_path`) while `compareColumnDefault`
 * never resolved that against the snapshot's own owning sequence.
 * Both ends of that axis get their own database object here, so a
 * genuinely unqualified `nextval('..._seq'::regclass)` and a genuinely
 * qualified one are each read from a real server, not asserted from a
 * hand-written `ColumnRow` (unit coverage: `check-compare.test.ts`).
 */
describe("hejbro check / a serial column's owned-sequence default (group 6, #716)", () => {
	const SerialDb = "serial_check";

	// Same `let`-at-describe-level idiom the role-independence block above
	// uses (this file's own `check:bans` note, line ~384): one `beforeAll`
	// per axis's fixture, read by that axis's own `it`.
	let publicSnapshot: Snapshot | undefined;
	let qualifiedSnapshot: Snapshot | undefined;

	beforeAll(() => {
		psqlCommand("postgres", `create database ${SerialDb};`);

		// Unqualified axis: `schema("public")` supplies `table()` only the
		// schemaName it needs (`core/src/dsl/table.ts`'s `table()` takes a
		// plain `SchemaDeclaration` value, never requiring it be part of
		// the `declarations` set) -- kept out of `declarations` so no
		// `create schema "public"` is ever emitted against a schema this
		// fresh database already has.
		const publicSchema = schema("public");
		const publicTable = table(publicSchema, "t", {
			id: serial().primaryKey(),
		});
		const publicMigration = generateMigration({
			declarations: [publicTable],
			previousSnapshot: emptySnapshot,
		});
		expect(publicMigration.errors).toEqual([]);
		psqlFile(SerialDb, publicMigration.sql);
		publicSnapshot = publicMigration.snapshot;

		// Qualified axis: a brand-new, non-public schema, declared and
		// created like `role independence`'s own `roleSchema` above.
		const qualifiedSchema = schema(SerialDb);
		const qualifiedTable = table(qualifiedSchema, "t", {
			id: serial().primaryKey(),
		});
		const qualifiedMigration = generateMigration({
			declarations: [qualifiedSchema, qualifiedTable],
			previousSnapshot: emptySnapshot,
		});
		expect(qualifiedMigration.errors).toEqual([]);
		psqlFile(SerialDb, qualifiedMigration.sql);
		qualifiedSnapshot = qualifiedMigration.snapshot;
	}, 60_000);

	const serialDbUrl = (): string => hostUrl("postgres", SerialDb);

	it("reports no differences for a public-schema serial column (unqualified nextval)", async () => {
		if (publicSnapshot === undefined) {
			throw new Error(
				"beforeAll did not build the public-schema fixture snapshot",
			);
		}
		const driver = pgDriver(serialDbUrl());
		try {
			const catalog = await readCatalog(driver);
			const findings = compareCatalog(publicSnapshot, catalog);
			expect(findings).toEqual([]);
		} finally {
			await driver.client.end();
		}
	});

	it("reports no differences for a schema-qualified serial column (qualified nextval)", async () => {
		if (qualifiedSnapshot === undefined) {
			throw new Error(
				"beforeAll did not build the qualified-schema fixture snapshot",
			);
		}
		const driver = pgDriver(serialDbUrl());
		try {
			const catalog = await readCatalog(driver);
			const findings = compareCatalog(qualifiedSnapshot, catalog);
			expect(findings).toEqual([]);
		} finally {
			await driver.client.end();
		}
	});
});

describe("hejbro check / the exit code contract (group 6, task 4.5 live)", () => {
	let projectDir = "";

	beforeAll(async () => {
		projectDir = await createCliFixtureDir();
		await runCli(projectDir, ["init"]);
	});

	afterAll(async () => {
		await removeCliFixtureDir(projectDir);
	});

	it("exits 2 against a real server when the declaration set is empty", async () => {
		// init's own onboarding example already declares real objects
		// (loader.ts's ONBOARDING_EXAMPLE) -- overwritten here with a file
		// that exports nothing, so `generate` produces a snapshot with 0
		// declared objects.
		await writeFixtureFile(projectDir, "src/app.schema.ts", "export {};\n");
		const generated = await runCli(projectDir, ["generate"]);
		expect(generated.exitCode).toBe(0);

		const result = await runCli(projectDir, ["check", "--url", chainUrl()]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("check-declarations-empty");
	});
});

/**
 * fix-nile-findings, #755, task 2.4: the Docker witness for the seam 2.1-
 * 2.3's own tests cannot reach -- every unit test either calls
 * `checkComparisonMode` directly (proving the derivation alone) or calls
 * `compareCheckAgainstCatalog`/`renderCheckReport` with the mode passed as
 * a literal (proving the threading alone), so `runCheck`'s own
 * `checkComparisonMode(config.presets)` call site (`commands/check.ts`)
 * is unexercised by anything short of the real, assembled path: a
 * `hejbro.config.ts` registering a preset that declares
 * `explainUnavailable`, generated and applied against a real server, then
 * checked through the spawned CLI. A bare preset-literal fixture (not
 * `@hejbro/nile`'s own) keeps this witness scoped to the mode-selection
 * wiring, not Nile's own validators (already 2.1's job).
 */
describe("hejbro check / text-comparison live witness (fix-nile-findings, #755, task 2.4)", () => {
	const WitnessDb = "nile_witness";
	let projectDir = "";

	const witnessConfigSource = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [
		{
			name: "explain-unavailable-witness",
			kinds: [],
			validators: [],
			explainUnavailable: true,
		},
	],
});
`;

	// `widgets_name_not_blank`: declared two-part
	// (\`length(btrim("widgets"."name")) > 0\`), and Postgres's own
	// pg_get_expr for this exact shape agrees after normalization alone
	// (design.md's own scenario, task 2.2). `widgets_role_valid`: Postgres
	// rewrites \`in (...)\` to \`= ANY (ARRAY[...])\` when it stores the
	// constraint -- the fixed five-step normalization cannot and must not
	// reconcile that (R64), so this one names the "not compared" half of
	// the witness.
	const witnessSchemaSource = `import { check, inArray, schema, sql, table, text, uuid } from "hejbro";

export const app = schema("app");

export const widgets = table(
	app,
	"widgets",
	{
		id: uuid().primaryKey().defaultRandom(),
		name: text().notNull(),
		role: text().notNull(),
	},
	(t) => ({
		checks: [
			check("widgets_name_not_blank", sql\`length(btrim(\${t.name})) > 0\`),
			check("widgets_role_valid", inArray(t.role, ["owner", "admin"])),
		],
	}),
);
`;

	beforeAll(async () => {
		psqlCommand("postgres", `create database ${WitnessDb};`);
		projectDir = await createCliFixtureDir();
		// `init` scaffolds the empty snapshot and migrations directory
		// `generate` requires on a project's very first run (matches
		// generate-command.test.ts's own fixtures) -- its own onboarding
		// config and schema are overwritten right after with this witness's.
		await runCli(projectDir, ["init"]);
		await writeFixtureFile(projectDir, "hejbro.config.ts", witnessConfigSource);
		await writeFixtureFile(
			projectDir,
			"src/app.schema.ts",
			witnessSchemaSource,
		);
		const generated = await runCli(projectDir, ["generate"]);
		expect(generated.exitCode).toBe(0);
		const migrationsDir = resolve(projectDir, "migrations");
		const [migrationFile] = readdirSync(migrationsDir).filter((name) =>
			name.endsWith(".sql"),
		);
		if (migrationFile === undefined) {
			throw new Error("generate did not write a migration file");
		}
		psqlFile(
			WitnessDb,
			readFileSync(resolve(migrationsDir, migrationFile), "utf-8"),
		);
	}, 60_000);

	afterAll(async () => {
		await removeCliFixtureDir(projectDir);
	});

	const witnessUrl = (): string => hostUrl("postgres", WitnessDb);

	it("compares by normalized text, agreeing on one constraint and reporting the other not-compared, never issuing explain", async () => {
		const before = execFileSync("docker", ["logs", CONTAINER], {
			encoding: "utf-8",
		});

		const result = await runCli(projectDir, ["check", "--url", witnessUrl()]);

		const after = execFileSync("docker", ["logs", CONTAINER], {
			encoding: "utf-8",
		});
		const logDelta = after.slice(before.length);

		// Scenario 1 (design.md): the declared and catalog texts equal after
		// normalization -- no finding for widgets_name_not_blank, and the
		// coverage boundary states the run compared by normalized text.
		expect(result.stdout).toContain("compared by normalized text");
		expect(result.stderr).not.toContain("widgets_name_not_blank");

		// Scenario 2 (design.md): the in(...) rewrite is not compared, never
		// reported as differing, carries both texts and a restatement Next:,
		// and never mentions EXPLAIN.
		expect(result.stderr).toContain("check-not-compared");
		expect(result.stderr).toContain("widgets_role_valid");
		expect(result.stderr).not.toContain("check-object-differs");
		expect(result.stderr).toContain("Next:");
		expect(result.stderr.toLowerCase()).not.toContain("explain");

		// Not compared, alone, is exit 2 -- never 0 (spec: "the run does not
		// exit zero").
		expect(result.exitCode).toBe(2);

		// The seam itself: no `explain` statement reached the server for
		// this run -- if runCheck ever stopped threading `mode` through to
		// compareCheckAgainstCatalog, this is what would catch it.
		expect(logDelta.toLowerCase()).not.toContain("explain");
	});
});

/**
 * #778/#781, task 1.7: the live witness for the three surfaces group 3-5
 * added -- a partial index, an expression index and a generated column,
 * each declared and applied for real, then each altered underneath by
 * `psql` so the report can only be right by actually asking the server.
 * Two project directories share the identical schema (`generate`'s own
 * emitted SQL is presets-independent for a declaration set no validator
 * refuses): one plain (server mode), one registering a local
 * `explainUnavailable` preset (text mode) -- the same split the
 * text-comparison witness above uses, generalized to every surface this
 * change added.
 */
describe("hejbro check / expression surfaces live witness (#778/#781, task 1.7)", () => {
	const ServerDb = "expr_surfaces_server";
	const TextDb = "expr_surfaces_text";
	let serverProjectDir = "";
	let textProjectDir = "";

	const surfacesSchemaSource = `import { index, integer, ne, numeric, schema, sql, table, text, uuid } from "hejbro";

export const app = schema("app");

export const widgets = table(
	app,
	"widgets",
	{
		id: uuid().primaryKey().defaultRandom(),
		email: text().notNull(),
		status: text().notNull(),
		price: numeric().notNull(),
		// A mismatched sibling type (integer, not numeric) is deliberate: it is
		// what makes Postgres append the "::numeric" cast this fixture's
		// text-mode witness needs (measured, task 1.7) -- two numeric()
		// columns produce no cast at all, and the generated column agrees
		// even under text mode, which this fixture is not testing.
		qty: integer().notNull(),
		total: numeric().generatedAlwaysAs(sql\`price * qty\`),
	},
	(t) => ({
		indexes: [
			index("widgets_active_idx").on(t.id).where(ne(t.status, "archived")),
			index("widgets_email_idx").on(sql\`lower(\${t.email})\`),
			// Review round 1 B3: Postgres stores each of these as a *plain*
			// key (indexprs null), never as an expression -- the round-trip
			// witness for the fix that stopped comparing expression-column
			// *count* and started comparing the ordered key list instead.
			index("widgets_bare_idx").on(sql\`\${t.email}\`),
			index("widgets_paren_idx").on(sql\`(\${t.email})\`),
			index("widgets_collate_idx").on(sql\`\${t.email} collate "C"\`),
			// Review round 1 B1/B2: genuinely plain declared indexes, each
			// recreated by the database as something the declaration never
			// had -- the reverse-direction witness for the declared-side
			// filter that used to skip a plain index outright.
			index("widgets_status_plain_idx").on(t.status),
			index("widgets_id_plain_idx").on(t.id),
		],
	}),
);
`;

	const plainConfigSource = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [],
});
`;

	const explainUnavailableConfigSource = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [
		{
			name: "explain-unavailable-witness",
			kinds: [],
			validators: [],
			explainUnavailable: true,
		},
	],
});
`;

	/** `generate` under `projectDir` (already `init`-ed), applying the resulting migration to `database` -- shared by both project dirs below, since the emitted SQL never depends on which preset a config registers for a declaration set no validator refuses. */
	const buildAndApply = async (
		projectDir: string,
		configSource: string,
		database: string,
	): Promise<void> => {
		await runCli(projectDir, ["init"]);
		await writeFixtureFile(projectDir, "hejbro.config.ts", configSource);
		await writeFixtureFile(
			projectDir,
			"src/app.schema.ts",
			surfacesSchemaSource,
		);
		const generated = await runCli(projectDir, ["generate"]);
		expect(generated.exitCode).toBe(0);
		const migrationsDir = resolve(projectDir, "migrations");
		const [migrationFile] = readdirSync(migrationsDir).filter((name) =>
			name.endsWith(".sql"),
		);
		if (migrationFile === undefined) {
			throw new Error("generate did not write a migration file");
		}
		psqlFile(
			database,
			readFileSync(resolve(migrationsDir, migrationFile), "utf-8"),
		);
	};

	beforeAll(async () => {
		psqlCommand("postgres", `create database ${ServerDb};`);
		psqlCommand("postgres", `create database ${TextDb};`);
		serverProjectDir = await createCliFixtureDir();
		textProjectDir = await createCliFixtureDir();
		await buildAndApply(serverProjectDir, plainConfigSource, ServerDb);
		await buildAndApply(textProjectDir, explainUnavailableConfigSource, TextDb);
	}, 120_000);

	afterAll(async () => {
		await removeCliFixtureDir(serverProjectDir);
		await removeCliFixtureDir(textProjectDir);
	});

	const serverUrl = (): string => hostUrl("postgres", ServerDb);
	const textUrl = (): string => hostUrl("postgres", TextDb);

	it("exits 0 for the fixture's own unaltered declarations (control)", async () => {
		const result = await runCli(serverProjectDir, [
			"check",
			"--url",
			serverUrl(),
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("check: no differences.");
	});

	// Review round 1 B3: a bare column reference, a parenthesized column
	// and a collated column, all declared as index keys via `sql`, are
	// stored by Postgres as *plain* keys (never `indexprs`) -- the exact
	// migration hejbro generated for them applies and re-reads as no
	// difference, live, not only through the unit-level fake session.
	it("round-trips a bare column reference, a parenthesized column and a collated column declared as index keys, with no finding", async () => {
		const result = await runCli(serverProjectDir, [
			"check",
			"--url",
			serverUrl(),
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("widgets_bare_idx");
		expect(result.stderr).not.toContain("widgets_paren_idx");
		expect(result.stderr).not.toContain("widgets_collate_idx");
	});

	it("reports exactly the altered predicate, expression index and generated column, never as not-compared", async () => {
		psqlCommand(
			ServerDb,
			"drop index app.widgets_active_idx; create index widgets_active_idx on app.widgets (id) where status <> 'done';",
		);
		psqlCommand(
			ServerDb,
			"drop index app.widgets_email_idx; create index widgets_email_idx on app.widgets (upper(email));",
		);
		psqlCommand(
			ServerDb,
			"alter table app.widgets drop column total; alter table app.widgets add column total numeric generated always as (price + qty) stored;",
		);

		const result = await runCli(serverProjectDir, [
			"check",
			"--url",
			serverUrl(),
		]);

		expect(result.exitCode).toBe(1);
		const differsCount = (result.stderr.match(/check-object-differs/g) ?? [])
			.length;
		expect(differsCount).toBe(3);
		expect(result.stderr).not.toContain("check-not-compared");
		expect(result.stderr).toContain("widgets_active_idx");
		expect(result.stderr).toContain("widgets_email_idx");
		expect(result.stderr).toContain("app.widgets.total");
	});

	// Review round 1 B1/B2: the database gaining a key expression or a
	// predicate the declaration never had used to pass as "no
	// differences" -- `declaredIndexExpressions` skipped a plain declared
	// index outright, so `compareIndexKeys` was never even called for it.
	// Cumulative with the mutation test above (this same database, same
	// container): 3 there, 2 more here.
	it("reports a database-only expression key and a database-only partial predicate, against plain declarations (review B1/B2)", async () => {
		psqlCommand(
			ServerDb,
			"drop index app.widgets_status_plain_idx; create index widgets_status_plain_idx on app.widgets (lower(status));",
		);
		psqlCommand(
			ServerDb,
			"drop index app.widgets_id_plain_idx; create index widgets_id_plain_idx on app.widgets (id) where id is not null;",
		);

		const result = await runCli(serverProjectDir, [
			"check",
			"--url",
			serverUrl(),
		]);

		expect(result.exitCode).toBe(1);
		const differsCount = (result.stderr.match(/check-object-differs/g) ?? [])
			.length;
		expect(differsCount).toBe(5);
		expect(result.stderr).not.toContain("check-not-compared");
		expect(result.stderr).toContain("widgets_status_plain_idx");
		expect(result.stderr).toContain("widgets_id_plain_idx");
	});

	it("under an explainUnavailable preset, agrees on both indexes and reports the generated column not-compared, exit 2, issuing zero explain", async () => {
		const before = execFileSync("docker", ["logs", CONTAINER], {
			encoding: "utf-8",
		});

		const result = await runCli(textProjectDir, ["check", "--url", textUrl()]);

		const after = execFileSync("docker", ["logs", CONTAINER], {
			encoding: "utf-8",
		});
		const logDelta = after.slice(before.length);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).not.toContain("widgets_active_idx");
		expect(result.stderr).not.toContain("widgets_email_idx");
		expect(result.stderr).toContain("check-not-compared");
		expect(result.stderr).toContain("app.widgets.total");
		expect(result.stderr).not.toContain("check-object-differs");
		expect(logDelta.toLowerCase()).not.toContain("explain");
	});
});

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
	execFileSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });
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

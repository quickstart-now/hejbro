import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeContainer } from "./docker-volumes";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

/**
 * The standing witness #714 asks for: `import` -> `baseline` -> `check`
 * against `seed/brownfield.sql`, a database hejbro did not create. Never
 * runs under `pnpm test`/CI (Docker-gated, local-only, D49) --
 * `pnpm --filter example-brownfield test:integration`.
 *
 * One container, one database, applied once per PG image. Every case
 * shares it, so at most ONE case may `baseline` + `migrate` (that writes
 * the ledger into the shared database; a second such case would find a
 * foreign chain already applied and fail on the ledger, not on the
 * corpus -- measured, 2026-09-03). The others only ever `import`.
 */
const PG_IMAGES = ["postgres:15-alpine", "postgres:17-alpine"] as const;
const DATABASE = "brownfield";
const DUMP_SQL = readFileSync(
	resolve(import.meta.dirname, "..", "seed", "brownfield.sql"),
	"utf8",
);

const CLEAN_SCHEMAS = [
	"app",
	"audit",
	"billing",
	"catalog",
	"Marketing",
] as const;
const R5_SCHEMAS = ["shop", "people", "inventory"] as const;
const ALL_SCHEMAS = [...CLEAN_SCHEMAS, ...R5_SCHEMAS] as const;

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

/** Same two-occurrence wait every other live-witness file in this repo measured and fixed (#361-class scar): the image's own entrypoint answers "ready" once for its own temporary bootstrap server, then again for the real one. */
const readyLogLineCount = (container: string): number => {
	const logs = execFileSync("sh", ["-c", `docker logs ${container} 2>&1`], {
		encoding: "utf-8",
	});
	return (logs.match(/database system is ready to accept connections/g) ?? [])
		.length;
};

const waitUntilReady = async (
	container: string,
	attemptsLeft: number,
): Promise<void> => {
	if (readyLogLineCount(container) >= 2) {
		return;
	}
	if (attemptsLeft <= 0) {
		throw new Error(
			`postgres in container "${container}" never became ready. Next: check \`docker logs ${container}\`.`,
		);
	}
	await sleep(300);
	return waitUntilReady(container, attemptsLeft - 1);
};

const containerPort = (container: string): string => {
	const output = execFileSync("docker", ["port", container, "5432/tcp"], {
		encoding: "utf-8",
	});
	const firstLine = (output.trim().split("\n")[0] ?? "").trim();
	const port = firstLine.split(":").at(-1);
	if (port === undefined || port === "") {
		throw new Error(
			`could not parse the host port docker mapped for container "${container}" from: ${JSON.stringify(output)}`,
		);
	}
	return port;
};

/** `ExecException.code` is `string | number | undefined` -- `1` for anything but a real numeric exit code (matches `packages/cli/test/support/cli-runner.ts`'s own `exitCodeFrom`). */
const exitCodeFromExecError = (error: {
	readonly code?: string | number;
}): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

const psqlFile = (container: string, database: string, sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			"-i",
			container,
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

/** `--schema <name>` flags, repeated in the order given -- `hejbro import`'s own contract (`packages/cli/src/commands/import.ts`'s `IMPORT_ARGS`, repeatable, no default). */
const schemaFlags = (schemas: ReadonlyArray<string>): ReadonlyArray<string> =>
	schemas.flatMap((schema) => ["--schema", schema]);

const importArgs = (
	url: string,
	schemas: ReadonlyArray<string>,
	out: string,
): ReadonlyArray<string> => [
	"import",
	"--url",
	url,
	...schemaFlags(schemas),
	"--out",
	out,
];

type ProbeResult = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

/**
 * Runs `loader-probe.mjs` as its own fresh OS process, rooted at
 * `rootPath` and importing `targetPath` as its sole entry point --
 * mirrors the production loader's own jiti path
 * (`packages/cli/src/loader.ts:119`/`:272`: `createJiti(configPath, {
 * fsCache: false })` then `.import(filePath)`). See that script's own
 * doc comment for why a fresh process per file, not a loop of
 * `jiti.import()` calls inside one, is the point.
 */
const probeLoaderEntryPoint = (
	rootPath: string,
	targetPath: string,
): Promise<ProbeResult> =>
	new Promise((doResolve) => {
		execFile(
			process.execPath,
			[
				resolve(import.meta.dirname, "support/loader-probe.mjs"),
				rootPath,
				targetPath,
			],
			(error, stdout, stderr) => {
				if (error === null) {
					doResolve({ exitCode: 0, stdout, stderr });
					return;
				}
				doResolve({ exitCode: exitCodeFromExecError(error), stdout, stderr });
			},
		);
	});

/** Asserts every file in `paths` loads cleanly when jiti-imported as the sole entry point, one fresh process each (`probeLoaderEntryPoint`). */
const assertEveryEntryPointLoads = async (
	configPath: string,
	paths: ReadonlyArray<string>,
): Promise<void> => {
	const results = await Promise.all(
		paths.map(async (file) => ({
			file,
			probe: await probeLoaderEntryPoint(configPath, file),
		})),
	);
	results.map(({ file, probe }) =>
		expect(probe.exitCode, `loader-probe on ${file}: ${probe.stderr}`).toBe(0),
	);
};

type LossReportRow = {
	readonly prefix: string;
	readonly identifier: string | null;
	readonly derived: boolean;
	readonly dumpEvidence: string | null;
};

/**
 * D110: the full population of `Omitted:`/`Approximated:` lines the full
 * corpus's own loss report produces, in the order it emits them -- not one
 * example. `prefix` stops right after the quoted identifier (or, for the
 * one line with none, at a stable leading clause), so a later wording
 * change to a sentence's tail never breaks this table. `derived` rows name
 * an object Postgres itself named (an unnamed inline `unique`/
 * `references`) -- `dumpEvidence` for those is the clause that produced
 * the name, never the name itself, since the name is never written down.
 */
const LOSS_REPORT_ROWS: ReadonlyArray<LossReportRow> = [
	{
		prefix:
			'Approximated: the UNIQUE constraint "app.users.users_email_key" is',
		identifier: "app.users.users_email_key",
		derived: true,
		dumpEvidence: "email text not null unique,",
	},
	{
		prefix:
			'Approximated: the UNIQUE constraint "catalog.products.products_sku_key" is',
		identifier: "catalog.products.products_sku_key",
		derived: false,
		dumpEvidence: "constraint products_sku_key unique (sku),",
	},
	{
		prefix: 'Approximated: column "catalog.products.external_ref" keeps',
		identifier: "catalog.products.external_ref",
		derived: false,
		dumpEvidence:
			"external_ref integer not null default nextval('catalog.external_ref_seq'),",
	},
	{
		prefix:
			"Approximated: every default, check, generated, and index-predicate expression is carried as raw SQL text,",
		identifier: null,
		derived: false,
		dumpEvidence: null,
	},
	{
		prefix: 'Omitted: schema "Marketing" --',
		identifier: "Marketing",
		derived: false,
		dumpEvidence: 'create schema "Marketing";',
	},
	{
		prefix: 'Omitted: table "shop.Widgets" --',
		identifier: "shop.Widgets",
		derived: false,
		dumpEvidence: 'create table shop."Widgets" (',
	},
	{
		prefix: 'Omitted: index "catalog.orders.IX_Orders_Status" --',
		identifier: "catalog.orders.IX_Orders_Status",
		derived: false,
		dumpEvidence: 'create index "IX_Orders_Status" on catalog.orders (status);',
	},
	{
		prefix: 'Omitted: check constraint "catalog.orders.CK_Orders_Total" --',
		identifier: "catalog.orders.CK_Orders_Total",
		derived: false,
		dumpEvidence: 'constraint "CK_Orders_Total" check (total >= 0)',
	},
	{
		prefix: 'Omitted: foreign key "shop.orders.orders_widget_id_fkey" --',
		identifier: "shop.orders.orders_widget_id_fkey",
		derived: true,
		dumpEvidence: 'widget_id integer not null references shop."Widgets" (id)',
	},
	{
		prefix: 'Omitted: column "catalog.products.a*/b" --',
		identifier: "catalog.products.a*/b",
		derived: false,
		dumpEvidence: '"a*/b" text,',
	},
	{
		prefix: 'Omitted: column "people.accounts._id" --',
		identifier: "people.accounts._id",
		derived: false,
		dumpEvidence: "_id text,",
	},
];

/** D110: an object Postgres names for us never writes that name into the dump -- only the clause that produced it does. */
const lastDotSegment = (identifier: string): string =>
	identifier.split(".").at(-1) ?? identifier;

describe.each(PG_IMAGES)("brownfield corpus / %s", (image) => {
	const container = `hejbro-brownfield-${process.pid}-${image.replace(/[^a-z0-9]/gi, "")}`;
	const state: { hostPort: string } = { hostPort: "" };
	const url = (): string =>
		`postgres://postgres@127.0.0.1:${state.hostPort}/${DATABASE}`;

	beforeAll(async () => {
		assertBuiltCli();
		if (!dockerAvailable()) {
			throw new Error(
				"the brownfield corpus witness needs a running Docker daemon -- `docker info` failed. Next: start Docker and re-run `pnpm --filter example-brownfield test:integration`.",
			);
		}
		execFileSync(
			"docker",
			[
				"run",
				"-d",
				"--name",
				container,
				"-e",
				"POSTGRES_PASSWORD=postgres",
				"-e",
				"POSTGRES_HOST_AUTH_METHOD=trust",
				"-p",
				"127.0.0.1::5432",
				image,
			],
			{ stdio: "ignore" },
		);
		await waitUntilReady(container, 60);
		state.hostPort = containerPort(container);
		execFileSync("docker", [
			"exec",
			container,
			"psql",
			"-U",
			"postgres",
			"-c",
			`create database ${DATABASE};`,
		]);
		psqlFile(container, DATABASE, DUMP_SQL);
	}, 120_000);

	afterAll(() => {
		removeContainer(container);
	});

	/**
	 * 2a (#714 bc-1): the headline flow the issue itself describes -- every
	 * schema in the dump, together, exactly the way a user adopting the
	 * whole database would run it.
	 */
	describe("the full corpus (all 8 schemas) -- the documented import flow", () => {
		it("imports every schema, twice identically, and every emitted file loads from every entry point", async () => {
			const cwd = await createCliFixtureDir();
			try {
				const initResult = await runCli(cwd, ["init"]);
				expect(initResult.exitCode).toBe(0);

				const firstImport = await runCli(
					cwd,
					importArgs(url(), ALL_SCHEMAS, "src/schema"),
				);
				// A whole-database reading stops at the FIRST defect it
				// reaches, so this run alone can only ever show one
				// failure mode at a time (it showed R5-B2 before #711);
				// 2b/2c below pin each schema's own mode separately so
				// none stays hidden behind another.
				expect(firstImport.exitCode).toBe(0);

				const lossReportLines = firstImport.stdout
					.split("\n")
					.filter((line) => /^(Omitted|Approximated):/.test(line));
				// D110: the full population the loss report can produce for this
				// corpus, not one example -- order and count both matter, so a
				// missing or reordered line fails here before the per-row checks
				// below even run.
				expect(
					lossReportLines.map((line) => line.match(/"([^"]*)"/)?.[1] ?? null),
				).toEqual(LOSS_REPORT_ROWS.map((row) => row.identifier));
				LOSS_REPORT_ROWS.map((row) =>
					expect(firstImport.stdout, row.identifier ?? row.prefix).toContain(
						row.prefix,
					),
				);
				const rowsWithDumpEvidence = LOSS_REPORT_ROWS.filter(
					(row): row is LossReportRow & { dumpEvidence: string } =>
						row.dumpEvidence !== null,
				);
				rowsWithDumpEvidence.map((row) =>
					expect(
						DUMP_SQL.split(row.dumpEvidence).length - 1,
						row.dumpEvidence,
					).toBe(1),
				);
				const namedLossReportRows = LOSS_REPORT_ROWS.filter(
					(row): row is LossReportRow & { identifier: string } =>
						row.identifier !== null,
				);
				namedLossReportRows
					.filter((row) => !row.derived)
					.map((row) =>
						expect(DUMP_SQL, row.identifier).toContain(
							lastDotSegment(row.identifier),
						),
					);
				namedLossReportRows
					.filter((row) => row.derived)
					.map((row) =>
						expect(DUMP_SQL, row.identifier).not.toContain(
							lastDotSegment(row.identifier),
						),
					);

				// Written outside "src/" -- the default entry glob
				// (init.ts's "src/**/*.schema.ts") would otherwise match
				// both copies once baseline runs below, turning this
				// byte-identical check into a duplicate-declaration error
				// instead (measured: `error[duplicate-identity]:
				// schema:app -- declarations at index 0 and index 16 both
				// produce the identity "schema:app"`).
				const secondImport = await runCli(
					cwd,
					importArgs(url(), ALL_SCHEMAS, "verify-schema"),
				);
				expect(secondImport.exitCode).toBe(0);
				execFileSync("diff", [
					"-rq",
					resolve(cwd, "src/schema"),
					resolve(cwd, "verify-schema"),
				]);

				const filesToProbe = ALL_SCHEMAS.filter(
					(schema) => schema !== "Marketing",
				).map((schema) => resolve(cwd, "src/schema", `${schema}.schema.ts`));
				await assertEveryEntryPointLoads(
					resolve(cwd, "hejbro.config.ts"),
					filesToProbe,
				);

				const baselineResult = await runCli(cwd, ["baseline"]);
				expect(baselineResult.exitCode).toBe(0);
				const migrateResult = await runCli(cwd, ["migrate", "--url", url()]);
				expect(migrateResult.exitCode).toBe(0);
				const checkResult = await runCli(cwd, ["check", "--url", url()]);
				expect(checkResult.exitCode).toBe(0);
				expect(checkResult.stdout).toContain("check: no differences.");
				expect(checkResult.stderr.match(/^error\[/gm) ?? []).toEqual([]);
				// The loss report's own promise from the import above -- an
				// omitted table keeps surfacing in `check`'s unmanaged inventory,
				// an omitted schema never surfaces at all -- pinned here against
				// `check`'s real output.
				expect(checkResult.stdout).toContain(
					"unmanaged table (not covered by any declaration): shop.Widgets",
				);
				expect(checkResult.stdout).not.toContain("Marketing");
				// harden-check-inventory, task 1.9 (#726): the loss report's own
				// column-line promise, end to end -- both columns `import`
				// named as "check reports this column until it is renamed" (the
				// LOSS_REPORT_ROWS entries above) actually appear in this same
				// run's `check` inventory.
				expect(checkResult.stdout).toContain(
					"unmanaged column (not covered by any declaration): catalog.products.a*/b",
				);
				expect(checkResult.stdout).toContain(
					"unmanaged column (not covered by any declaration): people.accounts._id",
				);
				// harden-check-inventory, task 1.9 (#707): the same end-to-end
				// proof for the loss report's index/check lines -- `import`
				// named `catalog.orders.IX_Orders_Status` and
				// `catalog.orders.CK_Orders_Total` with the new 1.7 wording
				// ("check keeps listing it as unmanaged"), and this run's
				// `check` inventory actually lists both, on the surviving
				// declared table (`catalog.orders` itself "stays declared" --
				// seed/brownfield.sql's own comment) that holds them.
				expect(firstImport.stdout).toContain(
					"`check` keeps listing it as unmanaged until it is renamed in the database and declared",
				);
				expect(checkResult.stdout).toContain(
					"unmanaged index (not covered by any declaration): catalog.orders.IX_Orders_Status",
				);
				expect(checkResult.stdout).toContain(
					"unmanaged check constraint (not covered by any declaration): catalog.orders.CK_Orders_Total",
				);
				// Q3's boundary, live: `shop.Widgets` is itself unmanaged (the
				// line above), so none of what it holds -- its columns, its
				// primary key's own index, its UNIQUE constraint's own index --
				// gets a line of its own underneath it.
				expect(checkResult.stdout).not.toContain("shop.Widgets.id");
				expect(checkResult.stdout).not.toContain("shop.Widgets.sku");
				expect(checkResult.stdout).not.toContain("shop.Widgets.Widgets_pkey");
				expect(checkResult.stdout).not.toContain(
					"shop.Widgets.Widgets_sku_key",
				);
			} finally {
				await removeCliFixtureDir(cwd);
			}
		}, 60_000);
	});

	/**
	 * 2b (#714 bc-1): each schema D106 round 5 (#711) found a defect in,
	 * run alone, so its own failure mode stays pinned on its own -- the
	 * full-corpus run above only ever shows the first one it reaches.
	 * `inventory`'s mode never was an exit code (a silent content swap),
	 * so its pin is a content assertion (2c).
	 */
	describe("the three schemas D106 round 5 found defects in, each in isolation", () => {
		it('shop: "Widgets" is omitted with its UNIQUE constraint, and the foreign key that targets it goes too', async () => {
			const cwd = await createCliFixtureDir();
			try {
				await runCli(cwd, ["init"]);
				const importResult = await runCli(
					cwd,
					importArgs(url(), ["shop"], "src/schema"),
				);
				// Two variables on one fixture (R5-B1: the inbound foreign
				// key into an omitted table; R5-N2: a UNIQUE constraint on
				// it), pinned separately. The starter's header carries the
				// loss report, which legitimately names "shop.Widgets", so
				// "the table is not declared" is asserted on the
				// declarations below the header, never on the whole file.
				expect(importResult.exitCode).toBe(0);
				const source = readFileSync(
					resolve(cwd, "src/schema/shop.schema.ts"),
					"utf8",
				);
				const header = source.slice(0, source.indexOf("*/"));
				const declarations = source.slice(source.indexOf("*/"));
				expect(declarations).not.toContain("Widgets");
				expect(declarations).toMatch(/export const orders = table\(/);
				expect(declarations).not.toContain("widget_id_fkey");
				expect(header).toContain('Omitted: table "shop.Widgets"');
				expect(header).toContain(
					'Omitted: foreign key "shop.orders.orders_widget_id_fkey"',
				);
				expect(header).not.toContain("Approximated: the UNIQUE constraint");
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});

		it("people: the leading-underscore column `_id` is omitted and named; the reading survives", async () => {
			const cwd = await createCliFixtureDir();
			try {
				await runCli(cwd, ["init"]);
				const importResult = await runCli(
					cwd,
					importArgs(url(), ["people"], "src/schema"),
				);
				// R5-B2: `_id` round-trips through the key rule but is not
				// a declarable SQL name, so it must cost the column, not
				// the run -- `id`/`email` stay declared.
				expect(importResult.exitCode).toBe(0);
				const source = readFileSync(
					resolve(cwd, "src/schema/people.schema.ts"),
					"utf8",
				);
				const header = source.slice(0, source.indexOf("*/"));
				const declarations = source.slice(source.indexOf("*/"));
				expect(declarations).not.toContain('"_id"');
				expect(declarations).toMatch(/export const accounts = table\(/);
				expect(declarations).toContain("email");
				expect(header).toContain('Omitted: column "people.accounts._id"');
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});

		it("inventory: terminals keeps its own check expression under the name it shares with registers", async () => {
			// scope: adds a content assertion beyond BC-1's (a)(b)(c);
			// droppable. A crash-free defect (R5-B3) can never be caught
			// by an exit-code assertion alone -- import succeeds
			// (exitCode 0) either way, which is exactly why the corpus
			// needs to pin the *content* it silently gets wrong, not just
			// whether the command ran.
			const cwd = await createCliFixtureDir();
			try {
				await runCli(cwd, ["init"]);
				const importResult = await runCli(
					cwd,
					importArgs(url(), ["inventory"], "src/schema"),
				);
				expect(importResult.exitCode).toBe(0);
				const source = readFileSync(
					resolve(cwd, "src/schema/inventory.schema.ts"),
					"utf8",
				);
				const blockFor = (exportName: string): string => {
					const rest = source.slice(
						source.indexOf(`export const ${exportName}`),
					);
					const nextExportIndex = rest.indexOf("\nexport const ", 1);
					if (nextExportIndex === -1) {
						return rest;
					}
					return rest.slice(0, nextExportIndex);
				};
				const terminalsBlock = blockFor("terminals");
				const registersBlock = blockFor("registers");
				// R5-B3: a check looked up by schema + constraint name
				// alone gave `terminals` (no "balance" column at all)
				// `registers`' expression; each table must keep its own
				// under the shared name "pos".
				expect(terminalsBlock).not.toContain("balance");
				expect(terminalsBlock).toMatch(/status/);
				expect(registersBlock).toContain("balance");
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});
	});
});

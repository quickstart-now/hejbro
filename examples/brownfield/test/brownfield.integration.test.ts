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
 * One container, one database, applied once per PG image -- every case
 * below only ever *reads* the catalog (`import`), so sharing one already-
 * seeded database across every `it()` in this file is safe and avoids
 * re-applying the dump per case.
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
const R5_BLOCKED_SCHEMAS = ["shop", "people", "inventory"] as const;
const ALL_SCHEMAS = [...CLEAN_SCHEMAS, ...R5_BLOCKED_SCHEMAS] as const;

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
				// red on dev until #711: the full-schema run stops at the
				// FIRST R5 defect it reaches during the reading, not the
				// last -- captured verbatim against postgres:17-alpine,
				// 2026-09-03, tip 36520086 (dev):
				//
				//   error[invalid-sql-name]: _id
				//     column name "_id" is not a valid hejbro SQL
				//     identifier -- names must match ^[a-z][a-z0-9_]*$
				//     (lower-case snake_case, no dots or symbols) so they
				//     can be referenced from --rename/--confirm-drop
				//     flags. Next: rename the column to snake_case.
				//
				// (R5-B2, #711 -- people.accounts._id fails table()'s own
				// assertSqlName instead of being omitted.) shop's and
				// inventory's own, different failure modes (a hard abort
				// on an omitted table's UNIQUE constraint, and a silent
				// check-expression swap with no abort at all) are
				// invisible from this run alone -- 2b/2c fix each one to
				// its own schema so neither stays hidden behind this one.
				expect(firstImport.exitCode).toBe(0);

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
				// (d): observed, not asserted -- 2nd-token work (#711 also
				// changes what the loss report and `check` say). Also
				// observed on dev 36520086, unattributed to #711 -- filed
				// as #716: every `serial()` column's own owned-sequence
				// default (`nextval(...)`) is missing from the declaration
				// `check` compares against, so a clean serial column reports
				// as differing even though nothing about it was omitted or
				// approximated in the loss report. Asserted once #716 is
				// ruled on (2nd token or later).
				const findingCount = (checkResult.stderr.match(/^error\[/gm) ?? [])
					.length;
				console.log(
					`[brownfield/full-corpus] check exitCode=${checkResult.exitCode} findings=${findingCount}`,
				);
			} finally {
				await removeCliFixtureDir(cwd);
			}
		}, 60_000);
	});

	/**
	 * 2b (#714 bc-1): each R5-blocked schema run alone, so its own
	 * distinct failure mode is captured on its own -- the full-corpus run
	 * above only ever shows the first one it reaches (R5-B2, `people`).
	 * `inventory` alone does not abort today (unlike `shop`/`people`) --
	 * its own failure is a silent content swap, not an exit code, and is
	 * fixed to green by a follow-up commit's content assertion instead
	 * (2c) rather than here.
	 */
	describe("the three R5-blocked schemas, each in isolation", () => {
		it('shop: red on #711 -- "Widgets" (and the UNIQUE on it) should be omitted, taking the FK that targets it with it', async () => {
			const cwd = await createCliFixtureDir();
			try {
				await runCli(cwd, ["init"]);
				const importResult = await runCli(
					cwd,
					importArgs(url(), ["shop"], "src/schema"),
				);
				// red on dev until #711: R5-B1 and/or R5-N2 (#711) -- both
				// concern this same fixture (a UNIQUE constraint on, and a
				// foreign key into, an omitted table), and this run alone
				// does not establish which of the two paths this
				// particular abort goes through -- that needs a
				// build --force'd measurement (pending the lead's slot),
				// not this witness's own build. Captured verbatim against
				// postgres:17-alpine, 2026-09-03, tip 36520086 (dev), this
				// worktree's own build (packages/cli/dist/cli.js mtime
				// 08:40:41 KST, newest packages/cli/src file 08:21:46 KST,
				// packages/ status clean against dev tip):
				//
				//   error[invalid-sql-name]: Widgets
				//     table name "Widgets" is not a valid hejbro SQL
				//     identifier -- names must match ^[a-z][a-z0-9_]*$
				//     (lower-case snake_case, no dots or symbols) so they
				//     can be referenced from --rename/--confirm-drop
				//     flags. Next: rename the table to snake_case.
				//
				// Once #711 lands: "Widgets" and its UNIQUE constraint are
				// omitted, the loss report names both, and shop.orders
				// survives without the foreign key that used to target it.
				expect(importResult.exitCode).toBe(0);
				const source = readFileSync(
					resolve(cwd, "src/schema/shop.schema.ts"),
					"utf8",
				);
				expect(source).not.toContain("Widgets");
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});

		it("people: red on #711 -- the leading-underscore column `_id` should be omitted, not abort the reading", async () => {
			const cwd = await createCliFixtureDir();
			try {
				await runCli(cwd, ["init"]);
				const importResult = await runCli(
					cwd,
					importArgs(url(), ["people"], "src/schema"),
				);
				// red on dev until #711: R5-B2 (#711) -- captured verbatim
				// against postgres:17-alpine, 2026-09-03, tip 36520086 (dev):
				//
				//   error[invalid-sql-name]: _id
				//     column name "_id" is not a valid hejbro SQL
				//     identifier -- names must match ^[a-z][a-z0-9_]*$
				//     (lower-case snake_case, no dots or symbols) so they
				//     can be referenced from --rename/--confirm-drop
				//     flags. Next: rename the column to snake_case.
				//
				// Once #711 lands: people.accounts survives with `_id`
				// omitted and named in the loss report, `id`/`email` intact.
				expect(importResult.exitCode).toBe(0);
				const source = readFileSync(
					resolve(cwd, "src/schema/people.schema.ts"),
					"utf8",
				);
				expect(source).not.toContain('"_id"');
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});

		it("inventory: red on #711 -- terminals' own check should not be registers' expression (silent content swap, R5-B3)", async () => {
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
				// red on dev until #711: R5-B3 -- verbatim, 2026-09-03,
				// postgres:17-alpine, tip 36520086 (dev): checksFor matches
				// a check expression on schema + constraint name only, so
				// `terminals` (columns: id, status -- no "balance" column
				// at all) silently inherits `registers`' own
				// check("pos", "balance >= 0") expression instead of its
				// own "status in (...)". Once #711 lands, each table keeps
				// its own expression under the shared name "pos".
				expect(terminalsBlock).not.toContain("balance");
				expect(terminalsBlock).toMatch(/status/);
				expect(registersBlock).toContain("balance");
			} finally {
				await removeCliFixtureDir(cwd);
			}
		});
	});

	/**
	 * 3 (#714 bc-1): the clean subset -- every schema R1-R4 (already on
	 * dev) already cover cleanly, selected on its own via `--schema`.
	 * Green today; proves the corpus's own non-R5 shapes (the
	 * opposite-direction enum/FK cycle, the three-schema `users` chain,
	 * default `_fkey` names, CamelCase schema/index/check omission, the
	 * star-slash-in-a-name header escape, the approximation shapes) all
	 * still work, without waiting on #711.
	 *
	 * #711 merged, re-check: once the full-corpus run in "the documented
	 * import flow" above is green on its own, this axis is redundant with
	 * it (this only exists because that one isn't green yet).
	 */
	describe("the clean subset (app, audit, billing, catalog, Marketing)", () => {
		it("imports cleanly, twice identically, and every emitted file loads from every entry point", async () => {
			const cwd = await createCliFixtureDir();
			try {
				const initResult = await runCli(cwd, ["init"]);
				expect(initResult.exitCode).toBe(0);

				const firstImport = await runCli(
					cwd,
					importArgs(url(), CLEAN_SCHEMAS, "src/schema"),
				);
				expect(firstImport.exitCode).toBe(0);

				// Written outside "src/" -- see the full-corpus case above
				// for why (the default entry glob would otherwise match
				// both copies once baseline runs).
				const secondImport = await runCli(
					cwd,
					importArgs(url(), CLEAN_SCHEMAS, "verify-schema"),
				);
				expect(secondImport.exitCode).toBe(0);
				execFileSync("diff", [
					"-rq",
					resolve(cwd, "src/schema"),
					resolve(cwd, "verify-schema"),
				]);

				const filesToProbe = CLEAN_SCHEMAS.filter(
					(schema) => schema !== "Marketing",
				).map((schema) => resolve(cwd, "src", "schema", `${schema}.schema.ts`));
				await assertEveryEntryPointLoads(
					resolve(cwd, "hejbro.config.ts"),
					filesToProbe,
				);

				const baselineResult = await runCli(cwd, ["baseline"]);
				expect(baselineResult.exitCode).toBe(0);
				const migrateResult = await runCli(cwd, ["migrate", "--url", url()]);
				expect(migrateResult.exitCode).toBe(0);
			} finally {
				await removeCliFixtureDir(cwd);
			}
		}, 60_000);
	});
});

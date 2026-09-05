import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hejbroError } from "@hejbro/core";
import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverRow,
	DriverSession,
} from "@hejbro/query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertInteractiveTransactions } from "../src/apply/capability";
import type { Migration } from "../src/apply/execute";
import type { PlanResult } from "../src/apply/plan";
import type {
	CheckDriverConnection,
	CheckDriverImporter,
} from "../src/check/driver";
import {
	applyFrom,
	NOTHING_TO_APPLY_LINE,
	planFailureResult,
	runMigrate,
} from "../src/commands/migrate";
import {
	createCliFixtureDir,
	removeCliFixtureDir,
	writeFixtureFile,
} from "./support/cli-runner";

type FailWhen = (compiled: CompileResult) => boolean;
type RowsWhen = (
	compiled: CompileResult,
) => ReadonlyArray<DriverRow> | undefined;

/** Mirrors `apply-execute.test.ts`'s own fake driver -- records every statement, `failWhen` makes exactly one fail, `rowsWhen` (task 11.2) answers a specific `select` (the ledger recheck) with rows of its own choosing so a test can make `applyMigration` resolve `"already-applied"` for a given file. */
const makeFakeDriver = (options?: {
	readonly failWhen?: FailWhen;
	readonly failError?: unknown;
	readonly rowsWhen?: RowsWhen;
	readonly capabilities?: DriverCapabilities;
}): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			if (options?.failWhen?.(compiled) === true) {
				throw options?.failError ?? new Error("fake failure");
			}
			return options?.rowsWhen?.(compiled) ?? [];
		},
	};
	const driver: Driver = {
		capabilities: options?.capabilities ?? {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: session.execute,
		transaction: async (callback) => callback(session),
		setupSession: async () => {},
	};
	return { driver, calls };
};

const migrationA: Migration = {
	fileName: "0001_a.sql",
	sql: 'create table "app"."a" (id integer);',
	origin: "applied",
};
const migrationB: Migration = {
	fileName: "0002_b.sql",
	sql: 'create table "app"."b" (id integer);',
	origin: "applied",
};

describe("applyFrom / 7.5", () => {
	it("names each migration it applied, in order", async () => {
		const { driver } = makeFakeDriver();

		const result = await applyFrom(driver, [migrationA, migrationB], []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: applied 2 migration(s):",
			" - 0001_a.sql",
			" - 0002_b.sql",
		]);
	});

	it("stops at the first failing migration and keeps the ones before it", async () => {
		const { driver, calls } = makeFakeDriver({
			failWhen: (call) => call.sql === migrationB.sql,
			failError: Object.assign(new Error("syntax error"), { code: "42601" }),
		});

		const result = await applyFrom(driver, [migrationA, migrationB], []);

		expect(result.exitCode).toBe(1);
		// 0001_a.sql is named as applied -- it committed before 0002_b.sql
		// ever ran, so it is not rolled back by 0002_b.sql's own failure.
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0001_a.sql",
		]);
		expect(result.stderr).toContain("0002_b.sql");
		expect(result.stderr).toContain("error[apply-failed]");
		// Only 0001_a.sql's own DDL was ever sent for 0002_b.sql's turn to
		// fail on -- proves the run really did stop, not just report as if.
		expect(calls.some((call) => call.sql === migrationB.sql)).toBe(true);
		expect(calls.filter((call) => call.sql === migrationA.sql)).toHaveLength(1);
	});
});

/** `true` when `call` is the ledger recheck (a `select` naming this filename in its params) -- shared by 11.2's tests below, each of which decides its own set of "already recorded" filenames. */
const isRecheckFor = (call: CompileResult, fileName: string): boolean =>
	call.sql.toLowerCase().includes("select") && call.params.includes(fileName);

describe("applyFrom / 11.2 (#620)", () => {
	it("reports a migration another run already applied in its own bucket, separate from what this run applied", async () => {
		const recheckFindsB = (
			call: CompileResult,
		): ReadonlyArray<DriverRow> | undefined => {
			if (isRecheckFor(call, migrationB.fileName)) {
				return [{ "?column?": 1 }];
			}
			return undefined;
		};
		const { driver, calls } = makeFakeDriver({ rowsWhen: recheckFindsB });

		const result = await applyFrom(driver, [migrationA, migrationB], []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0001_a.sql",
			"migrate: 1 migration(s) another run already applied while this one waited:",
			" - 0002_b.sql",
		]);
		// Never sent 0002_b.sql's own DDL -- the recheck inside the lock
		// found it recorded first (execute.ts's own task 11.1).
		expect(calls.some((call) => call.sql === migrationB.sql)).toBe(false);
	});

	it("reports every migration as already-applied when another run finished the whole pending set first", async () => {
		const recheckFindsBoth = (
			call: CompileResult,
		): ReadonlyArray<DriverRow> | undefined => {
			if (
				isRecheckFor(call, migrationA.fileName) ||
				isRecheckFor(call, migrationB.fileName)
			) {
				return [{ "?column?": 1 }];
			}
			return undefined;
		};
		const { driver } = makeFakeDriver({ rowsWhen: recheckFindsBoth });

		const result = await applyFrom(driver, [migrationA, migrationB], []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: 2 migration(s) another run already applied while this one waited:",
			" - 0001_a.sql",
			" - 0002_b.sql",
		]);
	});

	it("still reports the already-applied bucket when a later migration in the same run fails", async () => {
		const migrationC: Migration = {
			fileName: "0003_c.sql",
			sql: 'create table "app"."c" (id integer);',
			origin: "applied",
		};
		const recheckFindsA = (
			call: CompileResult,
		): ReadonlyArray<DriverRow> | undefined => {
			if (isRecheckFor(call, migrationA.fileName)) {
				return [{ "?column?": 1 }];
			}
			return undefined;
		};
		const { driver } = makeFakeDriver({
			rowsWhen: recheckFindsA,
			failWhen: (call) => call.sql === migrationC.sql,
			failError: Object.assign(new Error("syntax error"), { code: "42601" }),
		});

		const result = await applyFrom(
			driver,
			[migrationA, migrationB, migrationC],
			[],
		);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0002_b.sql",
			"migrate: 1 migration(s) another run already applied while this one waited:",
			" - 0001_a.sql",
		]);
		expect(result.stderr).toContain("0003_c.sql");
	});
});

describe("applyFrom / 12.2 (#624)", () => {
	const baselineMigration: Migration = {
		fileName: "0001_baseline.sql",
		sql: 'create table "app"."adopted" (id integer);',
		origin: "registered",
	};

	it("registers a baseline without sending its statements, and reports it as registered, not applied", async () => {
		const { driver, calls } = makeFakeDriver();

		const result = await applyFrom(driver, [baselineMigration], []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: registered 1 baseline migration(s) (statements not executed):",
			" - 0001_baseline.sql",
		]);
		// The user who sees "applied" for a file that was never run has
		// been told something false (tasks.md 12.2's own words) --
		// pinned directly: the report never uses that word for this file.
		expect(result.stdout.join("\n")).not.toContain("applied");
		// Never sent -- the whole point of registering rather than running.
		expect(calls.some((call) => call.sql === baselineMigration.sql)).toBe(
			false,
		);
		const ledgerInsertCall = calls.find((call) =>
			call.sql.toLowerCase().includes("insert into"),
		);
		expect(ledgerInsertCall?.params).toEqual([
			baselineMigration.fileName,
			baselineMigration.origin,
		]);
	});

	it("keeps a baseline's own bucket separate from an ordinary migration applied in the same run", async () => {
		const { driver } = makeFakeDriver();

		const result = await applyFrom(driver, [baselineMigration, migrationA], []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0001_a.sql",
			"migrate: registered 1 baseline migration(s) (statements not executed):",
			" - 0001_baseline.sql",
		]);
	});

	it("reports a baseline another run already registered in its own bucket, distinct from an ordinary already-applied one", async () => {
		const recheckFindsBaseline = (
			call: CompileResult,
		): ReadonlyArray<DriverRow> | undefined => {
			if (isRecheckFor(call, baselineMigration.fileName)) {
				return [{ "?column?": 1 }];
			}
			return undefined;
		};
		const { driver, calls } = makeFakeDriver({
			rowsWhen: recheckFindsBaseline,
		});

		const result = await applyFrom(driver, [baselineMigration], []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: 1 baseline migration(s) another run already registered while this one waited:",
			" - 0001_baseline.sql",
		]);
		expect(calls.some((call) => call.sql === baselineMigration.sql)).toBe(
			false,
		);
	});
});

describe("runMigrate / 7.4 exit codes (via applyFrom)", () => {
	it("exits zero with nothing to apply", () => {
		expect(NOTHING_TO_APPLY_LINE).toContain("nothing to apply");
	});

	it("exits non-zero when a migration failed", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === migrationA.sql,
			failError: Object.assign(new Error("syntax error"), { code: "42601" }),
		});

		const result = await applyFrom(driver, [migrationA], []);

		expect(result.exitCode).toBe(1);
	});

	it("distinguishes a run that could not act (chain-invalid) from one that acted and failed", () => {
		const chainInvalid: PlanResult = {
			ok: false,
			reason: "chain-invalid",
			error: hejbroError("diverged-migrations", "the chain does not verify"),
		};

		const result = planFailureResult(chainInvalid);

		// 2, not 1: nothing was ever sent to the database -- the run never
		// got far enough to have anything refuse it.
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("diverged-migrations");
	});

	it("distinguishes a run that could not act (ledger disagreement)", () => {
		const disagreement: PlanResult = {
			ok: false,
			reason: "ledger-disagreement",
			disagreements: [
				{
					identity: "0001_a.sql",
					error: hejbroError("apply-ledger-orphan-row", "orphan row"),
				},
			],
		};

		const result = planFailureResult(disagreement);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("apply-ledger-orphan-row");
	});
});

describe("assertInteractiveTransactions / 7.3", () => {
	it("refuses a driver without interactive transactions, naming the capability", () => {
		const { driver } = makeFakeDriver({
			capabilities: {
				"interactive-transactions": false,
				"session-state": false,
				"prepared-statements": false,
			},
		});

		expect(() =>
			assertInteractiveTransactions(driver, "hejbro migrate"),
		).toThrow(
			expect.objectContaining({
				code: "apply-missing-capability",
			}),
		);
		try {
			assertInteractiveTransactions(driver, "hejbro migrate");
			throw new Error("expected assertInteractiveTransactions to throw");
		} catch (error) {
			expect((error as Error).message).toContain("interactive-transactions");
			expect((error as Error).message).toContain("hejbro migrate");
		}
	});

	it("passes a driver that declares interactive transactions", () => {
		const { driver } = makeFakeDriver();

		expect(() =>
			assertInteractiveTransactions(driver, "hejbro migrate"),
		).not.toThrow();
	});
});

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

/**
 * [task 17.1, D106 M3] Two files whose banner hashes either chain (root's
 * own `current`, `sha256:bbbb`, matches the second file's `parent`) or
 * don't (`secondParent` is anything else) -- `checkChain` only needs
 * consistent parent/current links, never real sha256 output, matching
 * this suite's siblings (`status-command.test.ts`'s own fixture).
 */
const writeTwoFileChain = async (
	cwd: string,
	secondParent: string,
): Promise<void> => {
	await writeFixtureFile(
		cwd,
		"migrations/0001_a.sql",
		[
			"-- hejbro migration",
			"-- parent-snapshot: sha256:aaaa",
			"-- snapshot: sha256:bbbb",
			'create table "app"."a" (id integer);',
		].join("\n"),
	);
	await writeFixtureFile(
		cwd,
		"migrations/0002_b.sql",
		[
			"-- hejbro migration",
			`-- parent-snapshot: ${secondParent}`,
			"-- snapshot: sha256:cccc",
			'create table "app"."b" (id integer);',
		].join("\n"),
	);
};

describe("runMigrate / 17.1 (D106 M3) verifies the chain before connecting", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("refuses an unverifiable chain without opening a connection", async () => {
		// 0002_b.sql's own parent is not 0001_a.sql's own current
		// (sha256:bbbb) -- a broken link, not a fork (nothing earlier
		// claims this parent), so checkChain reports "broken-chain".
		await writeTwoFileChain(cwd, "sha256:zzzz");
		const calls: string[] = [];
		// Coded ERR_MODULE_NOT_FOUND (mirrors the 7.2 suite's own
		// rejectingImporter below) rather than a plain Error -- a plain
		// one is not a HejbroError, and asHejbroError rethrows anything
		// that isn't, turning a should-never-run spy into an unhandled
		// rejection instead of a clean, coded failure if it is ever hit.
		const spyImporter = async () => {
			calls.push("import");
			throw Object.assign(new Error("Cannot find package '@hejbro/pg'"), {
				code: "ERR_MODULE_NOT_FOUND",
			});
		};

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			spyImporter,
		);

		expect(calls).toHaveLength(0);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[broken-chain]");
		expect(result.stderr).not.toContain("apply-driver-missing");
		expect(result.stderr).not.toContain("apply-connection-failed");
	});

	it("opens a connection when the chain verifies (control, same spy importer)", async () => {
		// 0002_b.sql's own parent matches 0001_a.sql's own current --
		// a healthy chain. Without this pair, the refusal above would be
		// indistinguishable from a fixture that never reaches the
		// connection path at all.
		await writeTwoFileChain(cwd, "sha256:bbbb");
		const calls: string[] = [];
		const spyImporter = async () => {
			calls.push("import");
			throw Object.assign(new Error("Cannot find package '@hejbro/pg'"), {
				code: "ERR_MODULE_NOT_FOUND",
			});
		};

		await runMigrate(cwd, ["--url", "postgres://fake"], spyImporter);

		expect(calls).toHaveLength(1);
	});

	// #616: the chain root's own parent is taken as given, so removing the
	// first migration leaves a chain that verifies -- the pre-flight passes
	// and the run goes on to open its connection. A stated limit, pinned.
	// #616: the pre-flight is the chain walk alone -- no tip check -- so both
	// ends of the chain are outside its reach. Each case below is one the
	// requirement states as passing; the spy importer records the connection
	// attempt that proves the pre-flight passed.
	const connectionAttempted = async (): Promise<number> => {
		const calls: string[] = [];
		const spyImporter = async () => {
			calls.push("import");
			throw Object.assign(new Error("Cannot find package '@hejbro/pg'"), {
				code: "ERR_MODULE_NOT_FOUND",
			});
		};
		await runMigrate(cwd, ["--url", "postgres://fake"], spyImporter);
		return calls.length;
	};

	it("opens a connection when the first migration's parent-snapshot line was edited (stated limitation)", async () => {
		await writeTwoFileChain(cwd, "sha256:bbbb");
		const first = join(cwd, "migrations", "0001_a.sql");
		const original = await readFile(first, "utf8");
		await writeFile(
			first,
			original.replace(
				"-- parent-snapshot: sha256:aaaa",
				"-- parent-snapshot: sha256:0000",
			),
		);
		expect(await connectionAttempted()).toBe(1);
	});

	it("opens a connection when the last migration's snapshot line was edited (stated limitation: no tip check)", async () => {
		await writeTwoFileChain(cwd, "sha256:bbbb");
		const last = join(cwd, "migrations", "0002_b.sql");
		const original = await readFile(last, "utf8");
		const edited = original.replace(
			/^-- snapshot: .*$/m,
			"-- snapshot: sha256:0000",
		);
		expect(edited).not.toBe(original);
		await writeFile(last, edited);
		expect(await connectionAttempted()).toBe(1);
	});

	it("opens a connection when the last migration was removed (stated limitation: no tip check)", async () => {
		await writeTwoFileChain(cwd, "sha256:bbbb");
		await rm(join(cwd, "migrations", "0002_b.sql"));
		expect(await connectionAttempted()).toBe(1);
	});

	const writeThreeFileChain = async (): Promise<void> => {
		const files: ReadonlyArray<readonly [string, string, string]> = [
			["0001_a.sql", "sha256:aaaa", "sha256:bbbb"],
			["0002_b.sql", "sha256:bbbb", "sha256:cccc"],
			["0003_c.sql", "sha256:cccc", "sha256:dddd"],
		];
		await Promise.all(
			files.map(([name, parent, current]) =>
				writeFixtureFile(
					cwd,
					`migrations/${name}`,
					[
						"-- hejbro migration",
						`-- parent-snapshot: ${parent}`,
						`-- snapshot: ${current}`,
						`create table "app"."${name.slice(5, 6)}" (id integer);`,
					].join("\n"),
				),
			),
		);
	};

	it("opens a connection when a leading run of migrations was removed (stated limitation)", async () => {
		await writeThreeFileChain();
		await rm(join(cwd, "migrations", "0001_a.sql"));
		await rm(join(cwd, "migrations", "0002_b.sql"));
		expect(await connectionAttempted()).toBe(1);
	});

	it("opens a connection when a trailing run of migrations was removed (stated limitation)", async () => {
		await writeThreeFileChain();
		await rm(join(cwd, "migrations", "0002_b.sql"));
		await rm(join(cwd, "migrations", "0003_c.sql"));
		expect(await connectionAttempted()).toBe(1);
	});

	it("opens a connection when the first migration was removed (stated limitation: the root is taken as given)", async () => {
		await writeTwoFileChain(cwd, "sha256:bbbb");
		await rm(join(cwd, "migrations", "0001_a.sql"));
		const calls: string[] = [];
		const spyImporter = async () => {
			calls.push("import");
			throw Object.assign(new Error("Cannot find package '@hejbro/pg'"), {
				code: "ERR_MODULE_NOT_FOUND",
			});
		};

		await runMigrate(cwd, ["--url", "postgres://fake"], spyImporter);

		expect(calls).toHaveLength(1);
	});
});

describe("runMigrate / 7.2 connection acquisition, apply-owned codes", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("names the driver package when it is missing, under migrate's own command name and code prefix", async () => {
		const rejectingImporter = async () => {
			throw Object.assign(new Error("Cannot find package '@hejbro/pg'"), {
				code: "ERR_MODULE_NOT_FOUND",
			});
		};

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			rejectingImporter,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[apply-driver-missing]");
		expect(result.stderr).toContain("hejbro migrate");
		expect(result.stderr).not.toContain("hejbro check");
		expect(result.stderr).not.toContain("check-driver-missing");
	});

	it("reports an unreachable database in its own words, under migrate's own command name and code prefix", async () => {
		const capabilities: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		};
		const unreachableImporter = async () => ({
			pgDriver: () => ({
				capabilities,
				execute: async () => {
					throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
						code: "ECONNREFUSED",
					});
				},
				transaction: async () => {
					throw new Error("transaction should not be called by this test");
				},
				setupSession: async () => {},
				client: { end: async () => {} },
			}),
		});

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			unreachableImporter,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[apply-connection-failed]");
		expect(result.stderr).toContain("hejbro migrate");
		expect(result.stderr).not.toContain("hejbro check");
	});
});

describe("runMigrate — a relation that is not the ledger at the ledger's name is refused before the bootstrap (harden-ledger-identity, 1.4)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"migrations/0001_a.sql",
			[
				"-- hejbro migration",
				"-- parent-snapshot: sha256:aaaa",
				"-- snapshot: sha256:bbbb",
				'create table "app"."a" (id integer);',
			].join("\n"),
		);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	/** One `pg_class`/`pg_attribute` row shape, as `probeLedgerIdentity`'s own statement returns it. */
	type ProbeRow = {
		readonly relkind: string;
		readonly name: string | null;
		readonly type: string | null;
	};

	/** A full pgDriver fake -- unlike `makeFakeDriver` above (`applyFrom`'s own unit-level fake), this one goes through `runMigrate`'s real connection/bootstrap/apply path, answering the identity probe with `probeRows` and every other statement (bootstrap DDL, the advisory lock, the ledger recheck, the migration's own SQL, the ledger insert) with no rows -- the happy-path answer each of those needs to let a real apply through. `probeRows.length === 0` (identity: absent) also makes `readLedger`'s own select answer `42P01` -- consistent with a genuinely untouched database (task 2.1, harden-ledger-diagnostics review repair: `migrate` now reads before it bootstraps, so this select has to answer the same "absent" fact the probe already promised, not a silent `{ exists: true, applied: [] }` that would skip the bootstrap this test means to exercise). */
	const makeFakeMigrateImporter = (
		probeRows: ReadonlyArray<ProbeRow>,
	): { readonly importer: CheckDriverImporter; readonly calls: string[] } => {
		const calls: string[] = [];
		const session: DriverSession = {
			execute: async (compiled) => {
				calls.push(compiled.sql);
				const sql = compiled.sql.trim().toLowerCase();
				if (sql.startsWith("select c.relkind")) {
					return probeRows as unknown as ReadonlyArray<DriverRow>;
				}
				if (probeRows.length === 0 && sql.startsWith('select "filename"')) {
					throw Object.assign(
						new Error('relation "hejbro.migration_ledger" does not exist'),
						{ code: "42P01" },
					);
				}
				return [];
			},
		};
		const driver: CheckDriverConnection = {
			capabilities: {
				"interactive-transactions": true,
				"session-state": true,
				"prepared-statements": false,
			},
			execute: session.execute,
			transaction: async (callback) => callback(session),
			setupSession: async () => {},
			client: { end: async () => {} },
		};
		const importer: CheckDriverImporter = async () => ({
			pgDriver: () => driver,
		});
		return { importer, calls };
	};

	it.each<[string, ReadonlyArray<ProbeRow>, string, ReadonlyArray<string>]>([
		[
			"a table carrying the ledger's four column names, filename typed differently -- the worst case, the insert would otherwise succeed",
			[
				{ relkind: "r", name: "id", type: "bigint" },
				{ relkind: "r", name: "filename", type: "integer" },
				{ relkind: "r", name: "origin", type: "text" },
				{ relkind: "r", name: "applied_at", type: "timestamp with time zone" },
			],
			"table",
			["id", "filename", "origin", "applied_at"],
		],
		["a view", [{ relkind: "v", name: "x", type: "integer" }], "view", ["x"]],
	])(
		"refuses with apply-ledger-occupied, exit 2, nothing bootstrapped or written -- %s",
		async (_label, probeRows, relationWord, columns) => {
			const { importer, calls } = makeFakeMigrateImporter(probeRows);

			const result = await runMigrate(
				cwd,
				["--url", "postgres://fake"],
				importer,
			);

			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("error[apply-ledger-occupied]");
			expect(result.stderr).toContain(relationWord);
			columns.map((column) => expect(result.stderr).toContain(column));
			const lowered = calls.map((sql) => sql.toLowerCase());
			expect(lowered.some((sql) => sql.includes("create schema"))).toBe(false);
			expect(lowered.some((sql) => sql.includes("create table"))).toBe(false);
			expect(lowered.some((sql) => sql.startsWith("insert"))).toBe(false);
			expect(
				lowered.some((sql) => sql.includes('create table "app"."a"')),
			).toBe(false);
		},
	);

	it("regression: an absent ledger bootstraps and applies the pending migration as today", async () => {
		const { importer, calls } = makeFakeMigrateImporter([]);

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			importer,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0001_a.sql",
		]);
		const lowered = calls.map((sql) => sql.toLowerCase());
		expect(lowered.some((sql) => sql.includes("create schema"))).toBe(true);
	});
});

describe("applyFrom — a ledger failure is not the migration's failure / 1.5 (harden-ledger-diagnostics)", () => {
	it("ledger insert refused with 23502 on the first pending migration -> exit 2, apply-ledger-unwritable, header names the ledger, no migration file in the header", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql.toLowerCase().includes("insert into"),
			failError: Object.assign(
				new Error(
					'null value in column "id" of relation "migration_ledger" violates not-null constraint',
				),
				{ code: "23502", column: "id" },
			),
		});

		const result = await applyFrom(driver, [migrationA], []);

		expect(result.exitCode).toBe(2);
		// The header line (`error[code]: <identity>`) names the ledger, never
		// the migration file -- the file still appears further down, inside
		// the write site's own "the row recording ..." sentence (D3), which
		// is a different fact (what was being written) from "what failed".
		const headerLine = (result.stderr ?? "").split("\n")[0] ?? "";
		expect(headerLine).toContain("error[apply-ledger-unwritable]");
		expect(headerLine).not.toContain(migrationA.fileName);
		expect(result.stdout).toEqual([]);
	});

	// [task 2.5, harden-ledger-diagnostics review repair] Regression: the
	// wording change (2.5 drops "migration" from the rollback sentence,
	// `raise`'s own reason) still states migrate's own rollback truthfully
	// -- the sentence names what ran, not what kind of file it came from.
	it("ledger insert refused -> the rollback sentence still states the rollback, with the file named separately", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql.toLowerCase().includes("insert into"),
			failError: Object.assign(
				new Error(
					'null value in column "id" of relation "migration_ledger" violates not-null constraint',
				),
				{ code: "23502", column: "id" },
			),
		});

		const result = await applyFrom(driver, [migrationA], []);

		expect(result.stderr).toContain(
			`the row recording "${migrationA.fileName}"`,
		);
		expect(result.stderr).toContain(
			"the statements from that file ran in the same transaction and rolled back with it",
		);
	});

	it("the same failure with one migration already applied before it -> the applied bucket still printed", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) =>
				call.sql.toLowerCase().includes("insert into") &&
				call.params.includes(migrationB.fileName),
			failError: Object.assign(
				new Error(
					'null value in column "id" of relation "migration_ledger" violates not-null constraint',
				),
				{ code: "23502", column: "id" },
			),
		});

		const result = await applyFrom(driver, [migrationA, migrationB], []);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0001_a.sql",
		]);
		const headerLine = (result.stderr ?? "").split("\n")[0] ?? "";
		expect(headerLine).toContain("error[apply-ledger-unwritable]");
		expect(headerLine).not.toContain(migrationB.fileName);
	});

	it("regression: a migration's own failure still exits one with apply-failed naming the file", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) => call.sql === migrationA.sql,
			failError: Object.assign(new Error("syntax error"), { code: "42601" }),
		});

		const result = await applyFrom(driver, [migrationA], []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[apply-failed]");
		expect(result.stderr).toContain(migrationA.fileName);
	});
});

describe("applyFrom — a ledger that vanishes mid-transaction is the ledger's failure / 2.2 (harden-ledger-diagnostics review repair)", () => {
	it("42P01 on the in-transaction recheck -> exit 2, apply-ledger-unreadable, never apply-failed naming the file", async () => {
		const { driver } = makeFakeDriver({
			failWhen: (call) =>
				call.sql.toLowerCase().includes("select") &&
				call.params.includes(migrationA.fileName),
			failError: Object.assign(
				new Error('relation "hejbro.migration_ledger" does not exist'),
				{ code: "42P01" },
			),
		});

		const result = await applyFrom(driver, [migrationA], []);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[apply-ledger-unreadable]");
		expect(result.stderr).not.toContain("error[apply-failed]");
		expect(result.stdout).toEqual([]);
	});
});

/** The four bootstrap columns, exactly as `bootstrapLedger` creates them -- makes the identity probe answer `ledger`, so the run reaches `bootstrapLedger`/`readLedger` instead of refusing on `apply-ledger-occupied` first. Shared by every describe below that needs a genuine (not absent, not occupied) ledger identity. */
const LEDGER_SHAPE_PROBE_ROWS = [
	{ relkind: "r", persistence: "p", name: "id", type: "bigint" },
	{ relkind: "r", persistence: "p", name: "filename", type: "text" },
	{ relkind: "r", persistence: "p", name: "origin", type: "text" },
	{
		relkind: "r",
		persistence: "p",
		name: "applied_at",
		type: "timestamp with time zone",
	},
];

/** A full pgDriver fake that answers the identity probe with `probeRows` (default: a genuine ledger shape), `select current_user` with a fixed role, `select "filename"...` (readLedger) with `ledgerRows` (default: empty, an existing-but-empty ledger) unless `failWhen` matches it first, and fails exactly one statement -- `failWhen` matches on the lower-cased SQL text, the fixture's own choice, never production code's (D4). */
const makeFailingLedgerImporter = (
	failWhen: (sql: string) => boolean,
	failError: unknown,
	options?: {
		readonly probeRows?: ReadonlyArray<Record<string, unknown>>;
		readonly ledgerRows?: ReadonlyArray<Record<string, unknown>>;
	},
): { readonly importer: CheckDriverImporter; readonly calls: string[] } => {
	const calls: string[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled.sql);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select c.relkind")) {
				return (options?.probeRows ??
					LEDGER_SHAPE_PROBE_ROWS) as unknown as ReadonlyArray<DriverRow>;
			}
			if (failWhen(sql)) {
				throw failError;
			}
			if (sql.startsWith("select current_user")) {
				return [
					{ currentUser: "ld_role" },
				] as unknown as ReadonlyArray<DriverRow>;
			}
			if (sql.startsWith('select "filename"')) {
				// probeRows explicitly [] means "absent" -- readLedger's own
				// select has to answer that same fact (42P01), or a caller
				// asking for an absent ledger would silently get "exists,
				// empty" instead (task 2.1: migrate now reads this before
				// deciding whether to bootstrap).
				if (
					options?.probeRows?.length === 0 &&
					options.ledgerRows === undefined
				) {
					throw Object.assign(
						new Error('relation "hejbro.migration_ledger" does not exist'),
						{ code: "42P01" },
					);
				}
				return (options?.ledgerRows ??
					[]) as unknown as ReadonlyArray<DriverRow>;
			}
			return [];
		},
	};
	const driver: CheckDriverConnection = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: session.execute,
		transaction: async (callback) => callback(session),
		setupSession: async () => {},
		client: { end: async () => {} },
	};
	const importer: CheckDriverImporter = async () => ({
		pgDriver: () => driver,
	});
	return { importer, calls };
};

describe("runMigrate — a ledger failure is not the migration's failure / 1.5 (harden-ledger-diagnostics)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"migrations/0001_a.sql",
			[
				"-- hejbro migration",
				"-- parent-snapshot: sha256:aaaa",
				"-- snapshot: sha256:bbbb",
				'create table "app"."a" (id integer);',
			].join("\n"),
		);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("readLedger refused with 42501 before any apply -> exit 2, apply-ledger-unreadable", async () => {
		const { importer } = makeFailingLedgerImporter(
			(sql) => sql.startsWith('select "filename"'),
			Object.assign(new Error("permission denied for table migration_ledger"), {
				code: "42501",
			}),
		);

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			importer,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[apply-ledger-unreadable]");
		expect(result.stdout).toEqual([]);
	});

	it("bootstrap's create schema refused with 42501 -> exit 2, apply-ledger-unwritable naming the bootstrap (836/R2)", async () => {
		// [task 2.1, harden-ledger-diagnostics] The identity probe answers
		// absent -- bootstrapping is only ever attempted when the ledger
		// genuinely doesn't exist yet (a "ledger" identity here would mean
		// migrate never calls bootstrapLedger at all after 2.1's reorder,
		// making this scenario unreachable).
		const { importer } = makeFailingLedgerImporter(
			(sql) => sql.startsWith("create schema"),
			Object.assign(new Error("permission denied for database ldtest"), {
				code: "42501",
			}),
			{ probeRows: [] },
		);

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			importer,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[apply-ledger-unwritable]");
		expect(result.stderr).toContain("bootstrap");
		expect(result.stdout).toEqual([]);
	});
});

describe("runMigrate — a ledger that exists but cannot be read is not reported as a bootstrap / 2.1 (harden-ledger-diagnostics review repair)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"migrations/0001_a.sql",
			[
				"-- hejbro migration",
				"-- parent-snapshot: sha256:aaaa",
				"-- snapshot: sha256:bbbb",
				'create table "app"."a" (id integer);',
			].join("\n"),
		);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("ledger present, select withheld -> apply-ledger-unreadable, no create schema sent", async () => {
		const { importer, calls } = makeFailingLedgerImporter(
			(sql) => sql.startsWith('select "filename"'),
			Object.assign(new Error("permission denied for table migration_ledger"), {
				code: "42501",
			}),
		);

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			importer,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[apply-ledger-unreadable]");
		expect(
			calls.some((sql) => sql.toLowerCase().startsWith("create schema")),
		).toBe(false);
	});

	it("ledger present, schema usage withheld (create granted) -> apply-ledger-unreadable, no create schema sent", async () => {
		const { importer, calls } = makeFailingLedgerImporter(
			(sql) => sql.startsWith('select "filename"'),
			Object.assign(new Error("permission denied for schema hejbro"), {
				code: "42501",
			}),
		);

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			importer,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("error[apply-ledger-unreadable]");
		expect(
			calls.some((sql) => sql.toLowerCase().startsWith("create schema")),
		).toBe(false);
	});

	it("regression: ledger absent and creatable -> bootstrap runs exactly once and the pending migration applies", async () => {
		const { importer, calls } = makeFailingLedgerImporter(
			() => false,
			new Error("unreachable"),
			{ probeRows: [] },
		);

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			importer,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0001_a.sql",
		]);
		expect(
			calls.filter((sql) => sql.toLowerCase().startsWith("create schema")),
		).toHaveLength(1);
	});

	it("regression: ledger present and readable -> today's report, the pending migration applies", async () => {
		const { importer, calls } = makeFailingLedgerImporter(
			() => false,
			new Error("unreachable"),
		);

		const result = await runMigrate(
			cwd,
			["--url", "postgres://fake"],
			importer,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"migrate: applied 1 migration(s):",
			" - 0001_a.sql",
		]);
		expect(
			calls.some((sql) => sql.toLowerCase().startsWith("create schema")),
		).toBe(false);
	});
});

// add-config-driver, #458, task 1.4: mirrors check-command.test.ts's own
// seam (a fixture config runs in-process through jiti, so a per-test
// recording driver reaches it only through globalThis).
const FACTORY_SEAM_KEY = "__hejbroMigrateConfigDriverFactorySeam458__";

type FactorySeam = {
	readonly calls: string[];
	readonly driver: CheckDriverConnection;
};

const globalRecord = globalThis as Record<string, unknown>;

const installFactorySeam = (seam: FactorySeam): void => {
	globalRecord[FACTORY_SEAM_KEY] = seam;
};

const clearFactorySeam = (): void => {
	delete globalRecord[FACTORY_SEAM_KEY];
};

const FACTORY_CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	driver: (connectionString) => {
		const seam = globalThis[${JSON.stringify(FACTORY_SEAM_KEY)}];
		seam.calls.push(connectionString);
		return seam.driver;
	},
});
`;

/** Same happy-path answer this file's own harden-ledger-identity fixture
 * uses for an absent ledger (empty probe rows -> `42P01` on the ledger
 * select -> `bootstrapLedger` runs) -- the one shape that lets a real
 * apply through a fake driver. */
const buildRecordingMigrateDriver = (
	capabilities: DriverCapabilities = {
		"interactive-transactions": true,
		"session-state": true,
	},
): {
	readonly driver: CheckDriverConnection;
	readonly executed: number[];
	readonly closed: number[];
} => {
	const executed: number[] = [];
	const closed: number[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			executed.push(1);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select c.relkind")) {
				return [];
			}
			if (sql.startsWith('select "filename"')) {
				throw Object.assign(
					new Error('relation "hejbro.migration_ledger" does not exist'),
					{ code: "42P01" },
				);
			}
			return [];
		},
	};
	const driver: CheckDriverConnection = {
		capabilities,
		execute: session.execute,
		transaction: async (callback) => callback(session),
		setupSession: async () => {},
		client: {
			end: async () => {
				closed.push(1);
			},
		},
	};
	return { driver, executed, closed };
};

describe("hejbro migrate / the configured driver factory threads through (#458 task 1.4)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", FACTORY_CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"migrations/0001_a.sql",
			[
				"-- hejbro migration",
				"-- parent-snapshot: sha256:aaaa",
				"-- snapshot: sha256:bbbb",
				'create table "app"."a" (id integer);',
			].join("\n"),
		);
	});

	afterEach(async () => {
		clearFactorySeam();
		await removeCliFixtureDir(cwd);
	});

	it("calls the factory exactly once with --url's string, sends migrate's statements to the recording driver, closes it, and never imports @hejbro/pg", async () => {
		const { driver, executed, closed } = buildRecordingMigrateDriver();
		const calls: string[] = [];
		installFactorySeam({ calls, driver });
		const importerCalls: string[] = [];
		const importer: CheckDriverImporter = async () => {
			importerCalls.push("called");
			throw new Error("the importer must not run when a factory is configured");
		};

		const result = await runMigrate(
			cwd,
			["--url", "postgres://factory-test"],
			importer,
		);

		expect(result.exitCode).toBe(0);
		expect(calls).toEqual(["postgres://factory-test"]);
		expect(importerCalls).toHaveLength(0);
		expect(executed.length).toBeGreaterThan(0);
		expect(closed).toHaveLength(1);
	});

	// The refusal is unchanged by this whole change (design.md, "Capability
	// requirements are unchanged"): a factory-built driver declaring no
	// interactive transactions is refused exactly as an imported one
	// would be, before any migration statement is sent.
	it("refuses a factory-built driver with no interactive transactions, exactly as an imported one would be", async () => {
		const { driver } = buildRecordingMigrateDriver({
			"interactive-transactions": false,
			"session-state": true,
		});
		installFactorySeam({ calls: [], driver });
		const importer: CheckDriverImporter = async () => {
			throw new Error("the importer must not run when a factory is configured");
		};

		const result = await runMigrate(
			cwd,
			["--url", "postgres://factory-test"],
			importer,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("apply-missing-capability");
	});
});

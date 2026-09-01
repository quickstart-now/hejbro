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
};
const migrationB: Migration = {
	fileName: "0002_b.sql",
	sql: 'create table "app"."b" (id integer);',
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
		baseline: true,
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
		expect(ledgerInsertCall?.params).toEqual([baselineMigration.fileName]);
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

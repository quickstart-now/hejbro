import { hejbroError } from "@hejbro/core";
import type { CompileResult } from "@hejbro/query";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LedgerState } from "../src/apply/ledger";
import { bodyChecksum } from "../src/apply/ledger";
import type { PlanResult } from "../src/apply/plan";
import type { CheckDriverConnection } from "../src/check/driver";
import { planFailureResult } from "../src/commands/migrate";
import {
	renderPlanFailure,
	renderStatusReport,
	runStatus,
} from "../src/commands/status";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	writeFixtureFile,
} from "./support/cli-runner";

const EMPTY_LEDGER: LedgerState = { exists: true, applied: [] };
const NO_LEDGER: LedgerState = { exists: false };

describe("renderStatusReport / 7.6", () => {
	it("reports pending migrations, in chain order", () => {
		const plan: Extract<PlanResult, { readonly ok: true }> = {
			ok: true,
			pending: ["0001_a.sql", "0002_b.sql"],
			baselineFileNames: new Set(),
		};

		const result = renderStatusReport(plan, EMPTY_LEDGER);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: 2 migration(s) pending:",
			" - 0001_a.sql",
			" - 0002_b.sql",
		]);
	});

	it("reports nothing pending when the ledger is caught up", () => {
		const plan: Extract<PlanResult, { readonly ok: true }> = {
			ok: true,
			pending: [],
			baselineFileNames: new Set(),
		};

		const result = renderStatusReport(plan, EMPTY_LEDGER);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: nothing pending -- the ledger is caught up with the chain.",
		]);
	});
});

describe("renderStatusReport / 16.3 (D106 M1)", () => {
	const caughtUp: Extract<PlanResult, { readonly ok: true }> = {
		ok: true,
		pending: [],
		baselineFileNames: new Set(),
	};

	it("tells an absent ledger from an empty one", () => {
		const absent = renderStatusReport(caughtUp, NO_LEDGER);
		const empty = renderStatusReport(caughtUp, EMPTY_LEDGER);

		expect(absent.stdout[0]).toBe(
			"status: no ledger table exists yet -- this database has never been touched by hejbro.",
		);
		expect(empty.stdout[0]).toBe(
			"status: the ledger table exists and records no migrations yet.",
		);
	});

	it("names the migrations the ledger records as applied", () => {
		const ledger: LedgerState = {
			exists: true,
			applied: [
				{ filename: "0001_a.sql", origin: "applied", checksum: null },
				{ filename: "0002_b.sql", origin: "applied", checksum: null },
			],
		};

		const result = renderStatusReport(caughtUp, ledger);

		expect(result.stdout).toEqual([
			"status: 2 migration(s) recorded as applied:",
			" - 0001_a.sql",
			" - 0002_b.sql",
			"status: nothing pending -- the ledger is caught up with the chain.",
		]);
	});
});

describe("renderStatusReport / 16.4 (D106 M7)", () => {
	it("says the database was raised from that file", () => {
		const plan: Extract<PlanResult, { readonly ok: true }> = {
			ok: true,
			pending: [],
			baselineFileNames: new Set(),
		};
		const ledger: LedgerState = {
			exists: true,
			applied: [
				{ filename: "vendor/schema.sql", origin: "raised", checksum: null },
			],
		};

		const result = renderStatusReport(plan, ledger);

		expect(result.stdout).toEqual([
			'status: this database was raised from "vendor/schema.sql".',
			"status: nothing pending -- the ledger is caught up with the chain.",
		]);
	});
});

describe("renderPlanFailure / 7.6", () => {
	it("reports a ledger row with no file", () => {
		const plan: Extract<PlanResult, { readonly ok: false }> = {
			ok: false,
			reason: "ledger-disagreement",
			disagreements: [
				{
					identity: "0003_missing.sql",
					error: hejbroError(
						"apply-ledger-orphan-row",
						'the ledger records "0003_missing.sql" as applied, but no migration of that name exists on disk.',
					),
				},
			],
		};

		const result = renderPlanFailure(plan);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[apply-ledger-orphan-row]");
		expect(result.stderr).toContain("0003_missing.sql");
	});

	it("reports a chain that does not verify", () => {
		const plan: Extract<PlanResult, { readonly ok: false }> = {
			ok: false,
			reason: "chain-invalid",
			error: hejbroError("diverged-migrations", "the chain does not verify"),
		};

		const result = renderPlanFailure(plan);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[diverged-migrations]");
	});

	// [spec: "A disagreement is reported by status too"] The exact same
	// `PlanResult` fed to `migrate`'s own report-builder and `status`'s
	// own -- both must name the identical code, because both read it off
	// the identical `Disagreement.error` group 2's `planApply` produced.
	// This is what makes the ledger-disagreement codes (`apply-ledger-
	// orphan-row`/`apply-ledger-out-of-order`) `apply-*`-prefixed rather
	// than `migrate-*`: two commands report them, not one.
	it("reports the identical code migrate itself would refuse with, for the same disagreement", () => {
		const plan: Extract<PlanResult, { readonly ok: false }> = {
			ok: false,
			reason: "ledger-disagreement",
			disagreements: [
				{
					identity: "0003_missing.sql",
					error: hejbroError(
						"apply-ledger-orphan-row",
						'the ledger records "0003_missing.sql" as applied, but no migration of that name exists on disk.',
					),
				},
			],
		};

		const statusResult = renderPlanFailure(plan);
		const migrateResult = planFailureResult(plan);

		expect(statusResult.stderr).toContain("error[apply-ledger-orphan-row]");
		expect(migrateResult.stderr).toContain("error[apply-ledger-orphan-row]");
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

/** One `pg_class`/`pg_attribute` row shape, as `probeLedgerIdentity`'s own statement returns it. */
type ProbeRow = {
	readonly relkind: string;
	/** [2.2, 783/R5] `c.relpersistence` -- optional because only the real-ledger fixture below needs `"p"` (logged) to be judged `ledger`. */
	readonly persistence?: string;
	readonly name: string | null;
	readonly type: string | null;
};

/** The four bootstrap columns, exactly as `bootstrapLedger` creates them -- the probe answer that makes `readLedger`'s own mocked rows below internally consistent (a real ledger, not merely an absent one). */
const LEDGER_PROBE_ROWS: ReadonlyArray<ProbeRow> = [
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

/** A fake importer whose driver answers the identity probe with `probeRows` and `readLedger`'s own statement with `options.ledgerRows` (default: none) -- every other statement (including a write) is recorded so a test can assert none was ever sent. */
const makeFakeStatusImporter = (
	probeRows: ReadonlyArray<ProbeRow>,
	options?: {
		readonly ledgerRows?: ReadonlyArray<Record<string, unknown>>;
	},
): {
	readonly importer: () => Promise<{
		readonly pgDriver: () => {
			readonly capabilities: {
				readonly "interactive-transactions": boolean;
				readonly "session-state": boolean;
				readonly "prepared-statements": boolean;
				readonly "batched-transactions": boolean;
			};
			readonly execute: (compiled: {
				readonly sql: string;
			}) => Promise<ReadonlyArray<Record<string, unknown>>>;
			readonly transaction: () => Promise<never>;
			readonly batch: () => Promise<
				ReadonlyArray<ReadonlyArray<Record<string, unknown>>>
			>;
			readonly setupSession: () => Promise<void>;
			readonly client: { readonly end: () => Promise<void> };
		};
	}>;
	readonly calls: string[];
} => {
	const calls: string[] = [];
	const importer = async () => ({
		pgDriver: () => ({
			capabilities: {
				"interactive-transactions": false,
				"session-state": false,
				"prepared-statements": false,
				"batched-transactions": false,
			},
			execute: async (compiled: { readonly sql: string }) => {
				calls.push(compiled.sql);
				const sql = compiled.sql.trim().toLowerCase();
				if (sql.startsWith("select c.relkind")) {
					return probeRows;
				}
				if (sql.startsWith('select "filename"')) {
					return options?.ledgerRows ?? [];
				}
				return [];
			},
			transaction: async () => {
				throw new Error("status must never open a transaction");
			},
			batch: async () => {
				throw new Error("status must never open a transaction");
			},
			setupSession: async () => {},
			client: { end: async () => {} },
		}),
	});
	return { importer, calls };
};

// [spec: "Pending migrations are reported without being applied"] `status`
// never opens a transaction and sends no DDL at all -- proved here by
// recording every statement a fake driver ever receives and asserting
// none of them is a write. A test that only reads `result.stdout`'s
// pending list would pass even if `status` had quietly applied
// something first; this is the assertion that would catch that.
describe("runStatus / 7.6, database unchanged", () => {
	// This fixture's hejbro.config.ts imports "hejbro" -- real Node
	// resolution, so it needs a built dist.
	beforeAll(assertBuiltCli);

	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		// A real chain-shaped file on disk (hand-fabricated hash chain --
		// `checkChain` only needs consistent parent/current links, never
		// real sha256 output, matching this suite's siblings). Nothing in
		// the fake ledger below records it applied, so `planApply` reports
		// it pending, not disagreeing.
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

	it("sends no write statement while reporting pending migrations", async () => {
		const { importer, calls } = makeFakeStatusImporter(LEDGER_PROBE_ROWS);

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: 1 migration(s) pending:",
			" - 0001_a.sql",
		]);
		expect(
			calls.some((sql) =>
				/^\s*(insert|update|delete|create|drop|alter)\b/i.test(sql),
			),
		).toBe(false);
	});

	// [harden-ledger-identity, 1.3] The same regression pin as above, over
	// the probe branch only -- proves the probe answering "ledger" changes
	// nothing about today's report (byte-identical stdout, exit 0).
	it("reports today's output byte-for-byte when the probe finds the real ledger", async () => {
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS);

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: 1 migration(s) pending:",
			" - 0001_a.sql",
		]);
	});

	// [harden-ledger-identity, 1.3] A relation that is not the ledger at the
	// ledger's name is a coded diagnostic, never `readLedger`'s own raw
	// `column "origin" does not exist` stack (#796).
	it("a relation that is not the ledger is reported as a coded diagnostic, never a raw failure", async () => {
		const { importer, calls } = makeFakeStatusImporter([
			{ relkind: "v", name: "x", type: "integer" },
		]);

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContain("error[apply-ledger-occupied]");
		expect(result.stderr).toContain("Next:");
		expect(
			calls.some((sql) =>
				sql.trim().toLowerCase().startsWith('select "filename"'),
			),
		).toBe(false);
		// [task 2.4, harden-ledger-diagnostics review repair] Regression:
		// apply-ledger-occupied is not one of the two codes this task
		// unifies -- its header still names the command, unchanged.
		expect(result.stderr).toContain(
			"error[apply-ledger-occupied]: hejbro status",
		);
	});
});

/** A fake importer whose driver answers the identity probe with `LEDGER_PROBE_ROWS`, `select current_user` with a fixed role, and fails `readLedger`'s own read with `failError` -- everything else answers `[]`. */
const makeFailingReadImporter = (
	failError: unknown,
): {
	readonly importer: () => Promise<{
		readonly pgDriver: () => {
			readonly capabilities: {
				readonly "interactive-transactions": boolean;
				readonly "session-state": boolean;
				readonly "prepared-statements": boolean;
				readonly "batched-transactions": boolean;
			};
			readonly execute: (compiled: {
				readonly sql: string;
			}) => Promise<ReadonlyArray<Record<string, unknown>>>;
			readonly transaction: () => Promise<never>;
			readonly batch: () => Promise<
				ReadonlyArray<ReadonlyArray<Record<string, unknown>>>
			>;
			readonly setupSession: () => Promise<void>;
			readonly client: { readonly end: () => Promise<void> };
		};
	}>;
	readonly calls: string[];
} => {
	const calls: string[] = [];
	const importer = async () => ({
		pgDriver: () => ({
			capabilities: {
				"interactive-transactions": false,
				"session-state": false,
				"prepared-statements": false,
				"batched-transactions": false,
			},
			execute: async (compiled: { readonly sql: string }) => {
				calls.push(compiled.sql);
				const sql = compiled.sql.trim().toLowerCase();
				if (sql.startsWith("select c.relkind")) {
					return LEDGER_PROBE_ROWS;
				}
				if (sql.startsWith('select "filename"')) {
					throw failError;
				}
				if (sql.startsWith("select current_user")) {
					return [{ currentUser: "ld_noselect" }];
				}
				return [];
			},
			transaction: async () => {
				throw new Error("status must never open a transaction");
			},
			batch: async () => {
				throw new Error("status must never open a transaction");
			},
			setupSession: async () => {},
			client: { end: async () => {} },
		}),
	});
	return { importer, calls };
};

describe("runStatus — a ledger the role may not read is a coded diagnostic, never a raw failure / 1.6 (harden-ledger-diagnostics)", () => {
	beforeAll(assertBuiltCli);

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

	it("42501 on the ledger's own read -> exit 1, apply-ledger-unreadable, Next:, no stack frame", async () => {
		const { importer } = makeFailingReadImporter(
			Object.assign(new Error("permission denied for table migration_ledger"), {
				code: "42501",
			}),
		);

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContain("error[apply-ledger-unreadable]");
		expect(result.stderr).toContain("42501");
		expect(result.stderr).toContain("Next:");
		// A raw failure prints a stack trace line ("at " followed by a file
		// path/function) -- this diagnostic's own body never does.
		expect(result.stderr).not.toMatch(/\bat .*\.(ts|js):\d+/);
		// [task 2.4, harden-ledger-diagnostics review repair] The header
		// names the ledger, not `hejbro status` -- the same identity
		// `migrate` already used for this code, so one code never prints two
		// different headers depending on which command raised it.
		expect(result.stderr).toContain(
			'error[apply-ledger-unreadable]: "hejbro"."migration_ledger"',
		);
	});

	it("regression: a successful read still reports today's output byte-for-byte", async () => {
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS);

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: 1 migration(s) pending:",
			" - 0001_a.sql",
		]);
	});
});

// add-config-driver, #458, task 1.3: mirrors check-command.test.ts's own
// seam (a fixture config runs in-process through jiti, so a per-test
// recording driver reaches it only through globalThis).
const FACTORY_SEAM_KEY = "__hejbroStatusConfigDriverFactorySeam458__";

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
	driver: (connectionString) => {
		const seam = globalThis[${JSON.stringify(FACTORY_SEAM_KEY)}];
		seam.calls.push(connectionString);
		return seam.driver;
	},
});
`;

const buildRecordingDriver = (): {
	readonly driver: CheckDriverConnection;
	readonly executed: CompileResult[];
	readonly closed: number[];
} => {
	const executed: CompileResult[] = [];
	const closed: number[] = [];
	const driver: CheckDriverConnection = {
		capabilities: {
			"interactive-transactions": false,
			"session-state": false,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: async (compiled) => {
			executed.push(compiled);
			return [];
		},
		transaction: async () => {
			throw new Error("transaction should not be called by this test");
		},
		batch: async () => {
			throw new Error("batch should not be called by this test");
		},
		setupSession: async () => {
			throw new Error("setupSession should not be called by this test");
		},
		client: {
			end: async () => {
				closed.push(1);
			},
		},
	};
	return { driver, executed, closed };
};

describe("hejbro status / the configured driver factory threads through (#458 task 1.3)", () => {
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

	it("calls the factory exactly once with --url's string, sends status's statements to the recording driver, closes it, and never imports @hejbro/pg", async () => {
		const { driver, executed, closed } = buildRecordingDriver();
		const calls: string[] = [];
		installFactorySeam({ calls, driver });
		const importerCalls: string[] = [];
		const importer = async (): Promise<never> => {
			importerCalls.push("called");
			throw new Error("the importer must not run when a factory is configured");
		};

		await runStatus(cwd, ["--url", "postgres://factory-test"], importer);

		expect(calls).toEqual(["postgres://factory-test"]);
		expect(importerCalls).toHaveLength(0);
		expect(executed.length).toBeGreaterThan(0);
		expect(closed).toHaveLength(1);
	});
});

/**
 * [task 1.4, 631/R9, R11] `status` reports a changed body as its own
 * per-file diagnostic (identity: the filename, code:
 * `apply-migration-body-changed`), on a run whose plan has no
 * disagreement -- a disagreement is reported alone, as today, and the
 * body comparison never runs. `origin: "raised"` and a `null` checksum
 * are never compared, the same rules `changedBodies` already states.
 */
describe("runStatus — a changed body is reported / 1.4, 631/R9, R11", () => {
	beforeAll(assertBuiltCli);

	let cwd: string;

	const bannerBlock = (
		parent: string,
		current: string,
		extraLines: ReadonlyArray<string> = [],
	): string =>
		[
			"-- hejbro migration",
			...extraLines,
			`-- parent-snapshot: ${parent}`,
			`-- snapshot: ${current}`,
		].join("\n");

	const migrationFileText = (
		parent: string,
		current: string,
		body: string,
		extraLines: ReadonlyArray<string> = [],
	): string => `${bannerBlock(parent, current, extraLines)}\n\n${body}`;

	const file1Body = 'create table "app"."a" (id integer);';
	const file2Body = 'create table "app"."b" (id integer);';
	const originalFile1 = migrationFileText(
		"sha256:aaaa",
		"sha256:bbbb",
		file1Body,
	);
	const originalFile2 = migrationFileText(
		"sha256:bbbb",
		"sha256:cccc",
		file2Body,
	);
	const editedFile1 = migrationFileText(
		"sha256:aaaa",
		"sha256:bbbb",
		`${file1Body}\nalter table "app"."a" add column "z" integer;`,
	);
	const editedFile2 = migrationFileText(
		"sha256:bbbb",
		"sha256:cccc",
		`${file2Body}\nalter table "app"."b" add column "z" integer;`,
	);

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	const changedBodyMessage = (
		recordedChecksum: string,
		diskChecksum: string,
	): string =>
		`body changed after it was applied (recorded ${recordedChecksum.slice(0, 12)}, on disk ${diskChecksum.slice(0, 12)}). Next: restore the file from version control, or, if the change was deliberate, write it as a new migration -- hejbro never rewrites applied history -- before rerunning \`hejbro migrate\`.`;

	it("1: a recorded file's body was edited -- one diagnostic naming the file, exit 1", async () => {
		await writeFixtureFile(cwd, "migrations/0001_a.sql", editedFile1);
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS, {
			ledgerRows: [
				{
					filename: "0001_a.sql",
					origin: "applied",
					checksum: bodyChecksum(originalFile1),
				},
			],
		});

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("apply-migration-body-changed");
		expect(result.stderr).toContain("0001_a.sql");
		expect(result.stderr).toContain(
			changedBodyMessage(
				bodyChecksum(originalFile1),
				bodyChecksum(editedFile1),
			),
		);
	});

	it("2: a row with a null checksum is never compared -- exit 0, no diagnostic", async () => {
		await writeFixtureFile(cwd, "migrations/0001_a.sql", editedFile1);
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS, {
			ledgerRows: [
				{ filename: "0001_a.sql", origin: "applied", checksum: null },
			],
		});

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBeNull();
	});

	it("3: two recorded files edited -- two diagnostics, in chain order", async () => {
		await writeFixtureFile(cwd, "migrations/0001_a.sql", editedFile1);
		await writeFixtureFile(cwd, "migrations/0002_b.sql", editedFile2);
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS, {
			ledgerRows: [
				{
					filename: "0001_a.sql",
					origin: "applied",
					checksum: bodyChecksum(originalFile1),
				},
				{
					filename: "0002_b.sql",
					origin: "applied",
					checksum: bodyChecksum(originalFile2),
				},
			],
		});

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(1);
		const stderr = result.stderr ?? "";
		expect(stderr.indexOf("0001_a.sql")).toBeGreaterThanOrEqual(0);
		expect(stderr.indexOf("0002_b.sql")).toBeGreaterThan(
			stderr.indexOf("0001_a.sql"),
		);
	});

	it("4: an orphan row and an edited body together -- only the disagreement is reported, no body diagnostic", async () => {
		await writeFixtureFile(cwd, "migrations/0001_a.sql", editedFile1);
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS, {
			ledgerRows: [
				{
					filename: "0001_a.sql",
					origin: "applied",
					checksum: bodyChecksum(originalFile1),
				},
				{
					filename: "0099_ghost.sql",
					origin: "applied",
					checksum: bodyChecksum("-- hejbro migration\n\nselect 1;"),
				},
			],
		});

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("apply-ledger-orphan-row");
		expect(result.stderr).not.toContain("apply-migration-body-changed");
	});

	it("5: a clean run reports no changed body -- control", async () => {
		await writeFixtureFile(cwd, "migrations/0001_a.sql", originalFile1);
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS, {
			ledgerRows: [
				{
					filename: "0001_a.sql",
					origin: "applied",
					checksum: bodyChecksum(originalFile1),
				},
			],
		});

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBeNull();
	});

	// The raised row below is given the same filename as a real chain file
	// on disk, not to imitate a realistic raise -- a raised row's filename
	// is never a chain entry -- but to isolate condition 2 (`origin !==
	// "raised"`) from condition 3 (absent from `bodiesOnDisk`): a
	// different filename would leave the two indistinguishable, since
	// either one alone already excludes the row.
	it("6: a raised row is never reported as a changed body", async () => {
		await writeFixtureFile(cwd, "migrations/0001_a.sql", originalFile1);
		const { importer } = makeFakeStatusImporter(LEDGER_PROBE_ROWS, {
			ledgerRows: [
				{
					filename: "0001_a.sql",
					origin: "raised",
					checksum: bodyChecksum(editedFile1),
				},
			],
		});

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBeNull();
	});
});

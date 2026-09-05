import {
	buildSnapshot,
	createDefaultRegistry,
	emptySnapshot,
	getTableMeta,
	renderSnapshot,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyResetReport, runReset } from "../src/commands/reset";
import {
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

// Declarations and the fake driver are built directly from `@hejbro/core`
// (no `loadDeclarations`/jiti fixture) -- exactly `apply-reset.test.ts`'s
// own approach, and for the same reason: a jiti-loaded fixture file
// resolves a *different* `@hejbro/core` module instance than this
// vitest-aliased one, which would make `isTable()` silently misclassify
// the fixture's own declarations (`test/support/cli-runner.ts`'s own
// documented finding). `applyResetReport` is `commands/reset.ts`'s own
// split for exactly this: the connected half, testable without touching
// the filesystem at all (`runReset` above it is the one caller that
// reads real declarations off disk, and is not tested directly here,
// mirroring `check.ts`'s own `runCheck`).
const registry = createDefaultRegistry();
const app = schema("app");
const managedSnapshot = buildSnapshot(
	[app, getTableMeta(table(app, "managed", { id: uuid().primaryKey() }))],
	registry,
	emptySnapshot,
);

/** The four bootstrap columns, exactly as `bootstrapLedger` creates them -- the fake's answer to the identity probe when `ledgerExists` is true. `persistence: "p"` (2.2, 783/R5) -- logged, so the probe judges it `ledger`. */
const LEDGER_PROBE_ROWS = [
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

/**
 * `ledgerExists` (D106 R1, B1, #753 reopened; harden-ledger-identity, 1.2):
 * answers `probeLedgerIdentity`'s own catalog statement -- `false` (the
 * default) mirrors a database whose migrations were all applied without
 * `hejbro migrate` ever running, so `applyReset` reports `ledgerCleared:
 * false` and `commands/reset.ts`'s own success line drops its "and
 * cleared the ledger" clause.
 */
const makeFakeDriver = (
	databaseName = "testdb",
	capabilities?: DriverCapabilities,
	ledgerExists = false,
): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select current_database()")) {
				return [{ name: databaseName }];
			}
			if (sql.startsWith("select c.relkind")) {
				if (ledgerExists) {
					return LEDGER_PROBE_ROWS;
				}
				return [];
			}
			return [];
		},
	};
	const driver: Driver = {
		capabilities: capabilities ?? {
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

describe("applyResetReport / 7.7", () => {
	it("refuses without confirmation", async () => {
		const { driver } = makeFakeDriver();

		await expect(
			applyResetReport(driver, managedSnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-not-confirmed" });
	});

	it("succeeds with the exact database-and-count confirmation", async () => {
		const { driver } = makeFakeDriver("testdb");

		const result = await applyResetReport(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain("dropped");
	});

	// [task 4.1, D106 R1, B1, #753 reopened] The success line's own wording
	// pin, both directions: `commands/reset.ts` now builds it from
	// `applyReset`'s own `ledgerCleared`, never a fixed string, so both
	// outcomes need their own byte-exact assertion.
	it("does not claim the ledger was cleared when it never existed", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, false);

		const result = await applyResetReport(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result.stdout).toEqual([
			"reset: dropped every object your declarations manage. There was no hejbro ledger to clear.",
		]);
	});

	it("claims the ledger was cleared when it existed", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, true);

		const result = await applyResetReport(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result.stdout).toEqual([
			"reset: dropped every object your declarations manage, and cleared the ledger.",
		]);
	});

	it("refuses a driver without interactive transactions, before ever confirming", async () => {
		const { driver, calls } = makeFakeDriver("testdb", {
			"interactive-transactions": false,
			"session-state": false,
			"prepared-statements": false,
		});

		await expect(
			applyResetReport(driver, managedSnapshot, registry, "testdb:2"),
		).rejects.toMatchObject({ code: "apply-missing-capability" });
		// Refused before anything was even sent -- not even the
		// current_database() probe that a real confirmation check needs.
		expect(calls).toHaveLength(0);
	});
});

describe("applyResetReport / 18.1 (D106 M6)", () => {
	it("refuses a declaration set that exports nothing", async () => {
		const { driver, calls } = makeFakeDriver();

		await expect(
			applyResetReport(driver, emptySnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-declarations-empty" });
		// Not even current_database() went out -- a misconfigured entry
		// pattern refuses before the confirmation check that would need it.
		expect(calls).toHaveLength(0);
	});

	// Arrives green: `assertResetConfirmed` already throws before
	// `driver.transaction` ever runs whenever `changes.length > 0`, so
	// this is a pin (D106 M6 wants it named as a scenario), not a red.
	// Measured, not assumed: the branch-move mutant (moving `clearLedgerRows`
	// back outside the `changes.length > 0` branch) does NOT turn this
	// test red -- `assertResetConfirmed`'s refusal for a non-empty
	// `changes` set happens before the transaction runs regardless of
	// where `clearLedgerRows` sits inside it, so this scenario alone cannot
	// discriminate the branch move. See the completion report for what
	// does: `changes.length === 0` is unreachable from a non-empty
	// declaration set (every registered kind reports "drop" when an
	// object disappears), so the branch move is unreachable structural
	// invariant, not something an integration test through
	// `applyResetReport` can pin.
	it("clears no ledger row without confirmation", async () => {
		const { driver, calls } = makeFakeDriver("testdb");

		await expect(
			applyResetReport(driver, managedSnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-not-confirmed" });
		expect(
			calls.some((call) =>
				call.sql.toLowerCase().includes('delete from "hejbro"'),
			),
		).toBe(false);
	});
});

const RX_SCHEMA_SOURCE = `import { schema, table, uuid } from "hejbro";

export const rx = schema("rx");

export const items = table(rx, "items", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

const CONFIRM_DROP_PATTERN = /--confirm-drop (\S+)/;

/**
 * [task 2.4, harden-ledger-diagnostics review repair] `runReset`'s own
 * catch (`preconditionResult`) is the one place that picks the header
 * identity -- `applyResetReport` above never renders anything, it only
 * throws, so proving the header names the ledger needs the full
 * disk-reading path. `init`/`generate` (real, subprocess) build a valid
 * config/snapshot/migration on disk; `runReset` then runs in-process
 * against a fake driver that refuses the ledger clear.
 */
describe("runReset — a ledger diagnostic's header names the ledger, not the command / 2.4 (harden-ledger-diagnostics review repair)", () => {
	it('a refused ledger clear\'s header is error[apply-ledger-unwritable]: "hejbro"."migration_ledger"', async () => {
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/a.schema.ts", RX_SCHEMA_SOURCE);
			await runCli(cwd, ["generate"]);

			const makeImporter = (failClear: boolean) => async () => ({
				pgDriver: () => ({
					capabilities: {
						"interactive-transactions": true,
						"session-state": true,
						"prepared-statements": false,
					},
					execute: async (compiled: CompileResult) => {
						const sql = compiled.sql.trim().toLowerCase();
						if (sql.startsWith("select current_database()")) {
							return [{ name: "testdb" }];
						}
						if (sql.startsWith("select c.relkind")) {
							return LEDGER_PROBE_ROWS;
						}
						return [];
					},
					transaction: async <T>(
						callback: (session: DriverSession) => Promise<T>,
					): Promise<T> =>
						callback({
							execute: async (compiled: CompileResult) => {
								const sql = compiled.sql.trim().toLowerCase();
								if (failClear && sql.startsWith("delete from")) {
									throw Object.assign(
										new Error("permission denied for table migration_ledger"),
										{ code: "42501" },
									);
								}
								if (sql.startsWith("select current_user")) {
									return [{ currentUser: "ld_role" }];
								}
								return [];
							},
						}),
					setupSession: async () => {},
					client: { end: async () => {} },
				}),
			});

			const refused = await runReset(
				cwd,
				["--url", "postgres://fake"],
				makeImporter(false),
			);
			const match = CONFIRM_DROP_PATTERN.exec(refused.stderr ?? "");
			if (match === null) {
				throw new Error(
					`could not find the required --confirm-drop value in: ${refused.stderr}`,
				);
			}
			const confirmation = match[1] as string;

			const result = await runReset(
				cwd,
				["--url", "postgres://fake", "--confirm-drop", confirmation],
				makeImporter(true),
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				'error[apply-ledger-unwritable]: "hejbro"."migration_ledger"',
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	// Regression: reset-not-confirmed is not one of the two ledger codes --
	// its header still names the command, unchanged.
	it("regression: reset-not-confirmed's header still names the command", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/a.schema.ts", RX_SCHEMA_SOURCE);
			await runCli(cwd, ["generate"]);

			const importer = async () => ({
				pgDriver: () => ({
					capabilities: {
						"interactive-transactions": true,
						"session-state": true,
						"prepared-statements": false,
					},
					execute: async (compiled: CompileResult) => {
						const sql = compiled.sql.trim().toLowerCase();
						if (sql.startsWith("select current_database()")) {
							return [{ name: "testdb" }];
						}
						if (sql.startsWith("select c.relkind")) {
							return LEDGER_PROBE_ROWS;
						}
						return [];
					},
					transaction: async <T>(
						callback: (session: DriverSession) => Promise<T>,
					): Promise<T> => callback({ execute: async () => [] }),
					setupSession: async () => {},
					client: { end: async () => {} },
				}),
			});

			const result = await runReset(
				cwd,
				["--url", "postgres://fake"],
				importer,
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"error[reset-not-confirmed]: hejbro reset",
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});

// add-config-driver, #458, task 1.4: mirrors check-command.test.ts's own
// seam (a fixture config runs in-process through jiti, so a per-test
// recording driver reaches it only through globalThis). The run is left
// unconfirmed on purpose -- `assertResetConfirmed` still queries
// `current_database()` through the driver before it refuses, so this
// proves the wiring without needing this suite's own two-call
// confirm-drop dance.
const FACTORY_SEAM_KEY = "__hejbroResetConfigDriverFactorySeam458__";

type FactorySeam = {
	readonly calls: string[];
	readonly driver: Driver & { readonly client: { end(): Promise<void> } };
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
	snapshotPath: "hejbro.snapshot.json",
	driver: (connectionString) => {
		const seam = globalThis[${JSON.stringify(FACTORY_SEAM_KEY)}];
		seam.calls.push(connectionString);
		return seam.driver;
	},
});
`;

describe("hejbro reset / the configured driver factory threads through (#458 task 1.4)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", FACTORY_CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"src/app.schema.ts",
			`import { schema, table, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
});
`,
		);
		await writeFixtureFile(
			cwd,
			"hejbro.snapshot.json",
			renderSnapshot(emptySnapshot),
		);
	});

	afterEach(async () => {
		clearFactorySeam();
		await removeCliFixtureDir(cwd);
	});

	it("calls the factory exactly once with --url's string, sends reset's statements to the recording driver, closes it, and never imports @hejbro/pg", async () => {
		const executed: number[] = [];
		const closed: number[] = [];
		const { driver: fakeDriver } = makeFakeDriver();
		const driver: FactorySeam["driver"] = {
			...fakeDriver,
			execute: async (compiled) => {
				executed.push(1);
				return fakeDriver.execute(compiled);
			},
			client: {
				end: async () => {
					closed.push(1);
				},
			},
		};
		const calls: string[] = [];
		installFactorySeam({ calls, driver });
		const importerCalls: string[] = [];
		const importer = async (): Promise<never> => {
			importerCalls.push("called");
			throw new Error("the importer must not run when a factory is configured");
		};

		await runReset(cwd, ["--url", "postgres://factory-test"], importer);

		expect(calls).toEqual(["postgres://factory-test"]);
		expect(importerCalls).toHaveLength(0);
		expect(executed.length).toBeGreaterThan(0);
		expect(closed).toHaveLength(1);
	});
});

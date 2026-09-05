import type { DriverCapabilities } from "@hejbro/query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckDriverConnection } from "../src/check/driver";
import { runRaise } from "../src/commands/raise";
import {
	createCliFixtureDir,
	removeCliFixtureDir,
	writeFixtureFile,
} from "./support/cli-runner";

const capabilities: DriverCapabilities = {
	"interactive-transactions": true,
	"session-state": true,
	"prepared-statements": false,
	"batched-transactions": false,
};

type FakeCompiled = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};
type FakeRow = Record<string, unknown>;

/** A fake importer whose driver's `select "filename"` answers from a seeded ledger, and whose DDL/insert statements are recorded but not otherwise interpreted -- mirrors `apply-raise.test.ts`'s own fake driver. One `execute` implementation, reused for both the bare-driver reads (`bootstrapLedger`/`readLedger`) and the transaction session (`applyMigration`), so the two paths can never see a different world. */
const makeImporter = (options?: {
	readonly seededLedgerRows?: ReadonlyArray<string>;
}) => {
	const ledgerRows: string[] = [...(options?.seededLedgerRows ?? [])];
	const execute = async (
		compiled: FakeCompiled,
	): Promise<ReadonlyArray<FakeRow>> => {
		const sql = compiled.sql.trim().toLowerCase();
		if (sql.startsWith("create schema") || sql.startsWith("create table")) {
			return [];
		}
		if (sql.startsWith("insert into")) {
			ledgerRows.push(String(compiled.params[0]));
			return [];
		}
		if (sql.startsWith('select "filename"')) {
			return ledgerRows.map((filename) => ({ filename }));
		}
		return [];
	};
	return async () => ({
		pgDriver: () => ({
			capabilities,
			execute,
			transaction: async <T>(
				callback: (session: { execute: typeof execute }) => Promise<T>,
			): Promise<T> => callback({ execute }),
			batch: async () => [],
			setupSession: async () => {},
			client: { end: async () => {} },
		}),
	});
};

describe("runRaise / 7.7", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("applies a snapshot file to an empty database", async () => {
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);

		const result = await runRaise(
			cwd,
			["--url", "postgres://fake", "--file", "vendor/schema.sql"],
			makeImporter(),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain("vendor/schema.sql");
	});

	it("refuses a non-empty database (ledger already has history)", async () => {
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);

		const result = await runRaise(
			cwd,
			["--url", "postgres://fake", "--file", "vendor/schema.sql"],
			makeImporter({ seededLedgerRows: ["0001_init.sql"] }),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[raise-not-empty]");
	});

	it("refuses when --file is not given", async () => {
		const result = await runRaise(
			cwd,
			["--url", "postgres://fake"],
			makeImporter(),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[raise-file-missing]");
		expect(result.stderr).toContain("hejbro raise");
	});

	// [task 2.4, harden-ledger-diagnostics review repair] The header names
	// the ledger, not `hejbro raise` -- the same identity every command's
	// own ledger diagnostic now shares.
	it("a ledger read refusal's header names the ledger, not the command", async () => {
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);
		const readRefusedImporter = async () => ({
			pgDriver: () => ({
				capabilities,
				execute: async (compiled: FakeCompiled) => {
					const sql = compiled.sql.trim().toLowerCase();
					if (sql.startsWith('select "filename"')) {
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
				transaction: async <T>(
					callback: (session: {
						execute: (
							compiled: FakeCompiled,
						) => Promise<ReadonlyArray<FakeRow>>;
					}) => Promise<T>,
				): Promise<T> =>
					callback({ execute: async () => [] as ReadonlyArray<FakeRow> }),
				batch: async () => [],
				setupSession: async () => {},
				client: { end: async () => {} },
			}),
		});

		const result = await runRaise(
			cwd,
			["--url", "postgres://fake", "--file", "vendor/schema.sql"],
			readRefusedImporter,
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'error[apply-ledger-unreadable]: "hejbro"."migration_ledger"',
		);
	});

	// Regression: a non-ledger precondition (raise-file-missing above,
	// raise-not-empty here) keeps naming the command, unaffected by 2.4.
	it("regression: raise-not-empty's header still names the command", async () => {
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);

		const result = await runRaise(
			cwd,
			["--url", "postgres://fake", "--file", "vendor/schema.sql"],
			makeImporter({ seededLedgerRows: ["0001_init.sql"] }),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[raise-not-empty]: hejbro raise");
	});
});

// add-config-driver, #458, task 1.4: mirrors check-command.test.ts's own
// seam (a fixture config runs in-process through jiti, so a per-test
// recording driver reaches it only through globalThis).
const FACTORY_SEAM_KEY = "__hejbroRaiseConfigDriverFactorySeam458__";

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
	driver: (connectionString) => {
		const seam = globalThis[${JSON.stringify(FACTORY_SEAM_KEY)}];
		seam.calls.push(connectionString);
		return seam.driver;
	},
});
`;

const NO_DRIVER_CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
});
`;

/** Same statement dispatch as `makeImporter`'s own driver, but built as a
 * bare `CheckDriverConnection` (no importer wrapper) so a test can hand
 * it straight to the config factory seam -- `interactive-transactions:
 * true` since raise needs it to reach `applyRaise` at all. */
const buildRecordingRaiseDriver = (): {
	readonly driver: CheckDriverConnection;
	readonly executed: number[];
	readonly closed: number[];
} => {
	const executed: number[] = [];
	const closed: number[] = [];
	const execute = async (compiled: {
		readonly sql: string;
		readonly params: ReadonlyArray<unknown>;
	}): Promise<ReadonlyArray<Record<string, unknown>>> => {
		executed.push(1);
		const sql = compiled.sql.trim().toLowerCase();
		if (sql.startsWith('select "filename"')) {
			return [];
		}
		return [];
	};
	const driver: CheckDriverConnection = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute,
		transaction: async (callback) => callback({ execute }),
		batch: async () => [],
		setupSession: async () => {},
		client: {
			end: async () => {
				closed.push(1);
			},
		},
	};
	return { driver, executed, closed };
};

describe("hejbro raise / the configured driver factory threads through (#458 task 1.4)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		clearFactorySeam();
		await removeCliFixtureDir(cwd);
	});

	it("calls the factory exactly once with --url's string, sends raise's statements to the recording driver, closes it, and never imports @hejbro/pg", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", FACTORY_CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);
		const { driver, executed, closed } = buildRecordingRaiseDriver();
		const calls: string[] = [];
		installFactorySeam({ calls, driver });
		const importerCalls: string[] = [];
		const importer = async (): Promise<never> => {
			importerCalls.push("called");
			throw new Error("the importer must not run when a factory is configured");
		};

		const result = await runRaise(
			cwd,
			["--url", "postgres://factory-test", "--file", "vendor/schema.sql"],
			importer,
		);

		expect(result.exitCode).toBe(0);
		expect(calls).toEqual(["postgres://factory-test"]);
		expect(importerCalls).toHaveLength(0);
		expect(executed.length).toBeGreaterThan(0);
		expect(closed).toHaveLength(1);
	});
});

describe("hejbro raise / a configuration present but silent on driver behaves like none (#458 task 1.4)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("still uses the vanilla importer path when hejbro.config.ts exists but sets no driver", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", NO_DRIVER_CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);

		const result = await runRaise(
			cwd,
			["--url", "postgres://fake", "--file", "vendor/schema.sql"],
			makeImporter(),
		);

		expect(result.exitCode).toBe(0);
	});
});

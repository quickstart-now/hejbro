import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckDriverConnection } from "../src/check/driver";
import type { PullDeps } from "../src/commands/pull";
import { runPull } from "../src/commands/pull";
import { emitContract } from "../src/contract/emit";
import type { InferCatalogResult } from "../src/infer/compose";
import {
	lockPath,
	vendorContractPath,
	vendorDirPath,
	vendorSchemaPath,
	vendorSqlPath,
	writeLock,
} from "../src/vendor/lock";
import { createCliFixtureDir, removeCliFixtureDir } from "./support/cli-runner";

/**
 * Same seam granularity as `import-command.test.ts`: the connectivity
 * probe runs against a real (fake) driver, `inferCatalog` is replaced by
 * a canned `InferCatalogResult`, and `currentDatabaseName` is replaced
 * directly rather than faking `driver.execute`'s SQL dispatch.
 */
const fakeConnection: CheckDriverConnection = {
	capabilities: {
		"interactive-transactions": false,
		"session-state": false,
		"prepared-statements": false,
	},
	execute: async () => [],
	transaction: async () => {
		throw new Error("transaction should not be called by this test");
	},
	setupSession: async () => {
		throw new Error("setupSession should not be called by this test");
	},
	client: { end: async () => {} },
};

const fakeImporter = async () => ({ pgDriver: () => fakeConnection });

const emptyResult: InferCatalogResult = {
	snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
	description: { tables: [], roleNames: [] },
	lossReport: [],
	sql: "",
	omittedSchemaNames: [],
};

const widgetsResult: InferCatalogResult = {
	snapshot: {
		formatVersion: 8,
		dialect: "postgres",
		objects: {
			"table:app.widgets": {
				schema: "app",
				name: "widgets",
				columns: [
					{
						name: "id",
						typeNode: { typeName: "uuid" },
						notNull: true,
						primaryKey: true,
					},
				],
				indexes: [],
				foreignKeys: [],
				primaryKeyName: "widgets_pkey",
			},
		},
	},
	description: {
		tables: [
			{
				schema: "app",
				table: "widgets",
				columns: [{ sqlName: "id", tsKey: "id" }],
			},
		],
		roleNames: [],
	},
	lossReport: [],
	sql: 'create table "app"."widgets" (\n\t"id" uuid not null primary key\n);\n',
	omittedSchemaNames: [],
};

const depsFor = (
	result: InferCatalogResult,
	database = "widgets_db",
): PullDeps => ({
	importer: fakeImporter,
	inferCatalog: async () => result,
	currentDatabaseName: async () => database,
});

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "hejbro-pull-command-test-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("runPull / 4.1", () => {
	it("pulls a database into the vendor destination, marking the lock as pull's own", async () => {
		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture", "--schema", "app"],
			depsFor(widgetsResult),
		);

		expect(outcome.exitCode).toBe(0);
		expect(outcome.stderr).toBeNull();

		const contractText = readFileSync(vendorContractPath(cwd), "utf8");
		expect(contractText).toContain("inferred from a database");
		expect(contractText).toContain('database: "widgets_db"');
		expect(contractText).toContain('schemas: ["app"]');

		const schemaText = readFileSync(vendorSchemaPath(cwd), "utf8");
		expect(schemaText).toContain('"widgets"');

		const sqlText = readFileSync(vendorSqlPath(cwd), "utf8");
		expect(sqlText).toContain('create table "app"."widgets"');

		const lock = JSON.parse(readFileSync(lockPath(cwd), "utf8"));
		expect(lock.generatedBy).toBe("hejbro pull");
		expect(lock.commit).toBeUndefined();
		expect(lock.database).toBe("widgets_db");
		expect(lock.schemas).toEqual(["app"]);
		expect(typeof lock.schemaHash).toBe("string");
		expect(typeof lock.sqlHash).toBe("string");
		expect(typeof lock.contractHash).toBe("string");
	});

	it("sorts multiple --schema values by name in both the origin and the lock", async () => {
		const outcome = await runPull(
			cwd,
			[
				"--db-url",
				"postgres://fixture",
				"--schema",
				"zeta",
				"--schema",
				"alpha",
			],
			depsFor(emptyResult),
		);

		expect(outcome.exitCode).toBe(0);
		const contractText = readFileSync(vendorContractPath(cwd), "utf8");
		expect(contractText).toContain('schemas: ["alpha", "zeta"]');
		const lock = JSON.parse(readFileSync(lockPath(cwd), "utf8"));
		expect(lock.schemas).toEqual(["alpha", "zeta"]);
	});

	/**
	 * Schema-vendoring spec, "pull writes where vendor writes": an
	 * already-vendored (git-sourced) repository's outputs are replaced
	 * outright, and the lock left behind is marked as `pull`'s own -- the
	 * same destination `link` will later swap back to a git origin, and
	 * `vendor --check`/`outdated` read that one lock regardless of which
	 * command wrote it last.
	 */
	it("overwrites an already-vendored (git-sourced) repository's outputs, and the lock ends up pull-marked", async () => {
		const priorOrigin = {
			source: "git" as const,
			commit: "abc123",
			exportHash: "sha256:deadbeef",
		};
		const priorContract = emitContract(
			{
				tables: [],
				functions: [],
				roles: [],
				snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
			},
			priorOrigin,
		);
		mkdirSync(vendorDirPath(cwd), { recursive: true });
		writeLock(cwd, {
			generatedBy: "hejbro vendor",
			commit: "abc123",
			schemaHash: "old-schema-hash",
			sqlHash: "old-sql-hash",
			contractHash: "old-contract-hash",
		});
		writeFileSync(vendorContractPath(cwd), priorContract);
		writeFileSync(
			vendorSchemaPath(cwd),
			'{"tables":[],"functions":[],"roles":[]}',
		);
		writeFileSync(vendorSqlPath(cwd), "-- nothing yet\n");

		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture", "--schema", "app"],
			depsFor(widgetsResult),
		);

		expect(outcome.exitCode).toBe(0);
		const contractText = readFileSync(vendorContractPath(cwd), "utf8");
		expect(contractText).toContain("inferred from a database");
		expect(contractText).not.toContain("abc123");
		const lock = JSON.parse(readFileSync(lockPath(cwd), "utf8"));
		expect(lock.generatedBy).toBe("hejbro pull");
		expect(lock.commit).toBeUndefined();
	});

	it("refuses to guess which schemas to read when --schema is not given", async () => {
		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture"],
			depsFor(emptyResult),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("pull-schema-missing");
		expect(outcome.stderr).toContain("--schema");
		expect(existsSync(vendorDirPath(cwd))).toBe(false);
	});

	it("still refuses when a foreign (non-hejbro) file already occupies the contract destination -- no --force exists to override it", async () => {
		mkdirSync(vendorDirPath(cwd), { recursive: true });
		writeFileSync(vendorContractPath(cwd), "// hand-written, not ours\n");

		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture", "--schema", "app"],
			depsFor(widgetsResult),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("vendor-destination-not-vendored");
		expect(readFileSync(vendorContractPath(cwd), "utf8")).toBe(
			"// hand-written, not ours\n",
		);
		// D106 R3-N2: pull has no --force flag at all -- the remedy text
		// must not send a consumer looking for one.
		expect(outcome.stderr).not.toContain("--force");
		expect(outcome.stderr).toContain("hejbro pull");
	});

	it("still refuses when a foreign (non-hejbro) file already occupies hejbro.lock -- no --force exists to override it either (D106 R3-N2)", async () => {
		mkdirSync(vendorDirPath(cwd), { recursive: true });
		writeFileSync(lockPath(cwd), '{"generatedBy": "some-other-tool"}');

		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture", "--schema", "app"],
			depsFor(widgetsResult),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("vendor-destination-not-vendored");
		expect(outcome.stderr).not.toContain("--force");
		expect(outcome.stderr).toContain("hejbro pull");
	});
});

// add-config-driver, #458, task 1.3: pull never read hejbro.config.ts
// before this field existed (lead ruling 458/R2) -- every test above
// this point runs in a bare temp dir with none, so it already proves the
// "no configuration file" path unchanged. These two blocks add the two
// rows that path can't cover: a configured factory, and a configuration
// present but silent on `driver`.
const FACTORY_SEAM_KEY = "__hejbroPullConfigDriverFactorySeam458__";

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

const buildRecordingDriver = (): {
	readonly driver: CheckDriverConnection;
	readonly executed: number[];
	readonly closed: number[];
} => {
	const executed: number[] = [];
	const closed: number[] = [];
	const driver: CheckDriverConnection = {
		capabilities: { "interactive-transactions": false, "session-state": false },
		execute: async () => {
			executed.push(1);
			return [];
		},
		transaction: async () => {
			throw new Error("transaction should not be called by this test");
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

// These two blocks need `node_modules/hejbro` to actually resolve (their
// fixture `hejbro.config.ts` imports it) -- `createCliFixtureDir` sets
// that symlink up; the bare `mkdtempSync` `cwd` every other test in this
// file uses does not, and every one of those tests already proves the
// "no configuration file" path (none of them ever writes one).
describe("hejbro pull / the configured driver factory threads through (#458 task 1.3)", () => {
	let factoryCwd: string;

	beforeEach(async () => {
		factoryCwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		clearFactorySeam();
		await removeCliFixtureDir(factoryCwd);
	});

	it("calls the factory exactly once with --db-url's string, the recording driver takes the connectivity probe, closes it, and never imports @hejbro/pg", async () => {
		writeFileSync(join(factoryCwd, "hejbro.config.ts"), FACTORY_CONFIG_SOURCE);
		const { driver, executed, closed } = buildRecordingDriver();
		const calls: string[] = [];
		installFactorySeam({ calls, driver });
		const importerCalls: string[] = [];
		const importer = async (): Promise<never> => {
			importerCalls.push("called");
			throw new Error("the importer must not run when a factory is configured");
		};

		const outcome = await runPull(
			factoryCwd,
			["--db-url", "postgres://factory-test", "--schema", "app"],
			{
				importer,
				inferCatalog: async () => emptyResult,
				currentDatabaseName: async () => "widgets_db",
			},
		);

		expect(outcome.exitCode).toBe(0);
		expect(calls).toEqual(["postgres://factory-test"]);
		expect(importerCalls).toHaveLength(0);
		expect(executed.length).toBeGreaterThan(0);
		expect(closed).toHaveLength(1);
	});
});

describe("hejbro pull / a configuration present but silent on driver behaves like none (#458 task 1.3)", () => {
	let noDriverCwd: string;

	beforeEach(async () => {
		noDriverCwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		await removeCliFixtureDir(noDriverCwd);
	});

	it("still uses the vanilla importer path when hejbro.config.ts exists but sets no driver", async () => {
		writeFileSync(
			join(noDriverCwd, "hejbro.config.ts"),
			NO_DRIVER_CONFIG_SOURCE,
		);

		const outcome = await runPull(
			noDriverCwd,
			["--db-url", "postgres://fixture", "--schema", "app"],
			depsFor(widgetsResult),
		);

		expect(outcome.exitCode).toBe(0);
	});
});

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
		"batched-transactions": false,
	},
	execute: async () => [],
	transaction: async () => {
		throw new Error("transaction should not be called by this test");
	},
	batch: async () => {
		throw new Error("batch should not be called by this test");
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

/** One table per schema, minimal shape (mirrors `widgetsResult`) -- a schema fixture must actually contribute a snapshot object under B2's final rule (a schema mentioned only in `--schema` contributes nothing and is excluded), so any test exercising two or more surviving schemas needs one of these per schema, not `emptyResult`. */
/** One table per schema; a multi-schema fixture names them apart, since
 * the contract keys `Tables` by SQL name alone and refuses two carried
 * tables of one name across schemas (#1004). */
const tableNameFor = (schema: string, schemaCount: number): string => {
	if (schemaCount > 1) {
		return `widgets_${schema}`;
	}
	return "widgets";
};

const tableFixture = (
	schema: string,
	name = "widgets",
): InferCatalogResult["snapshot"]["objects"][string] => ({
	schema,
	name,
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
	primaryKeyName: `${name}_pkey`,
});

const resultForSchemas = (
	schemas: ReadonlyArray<string>,
): InferCatalogResult => ({
	snapshot: {
		formatVersion: 8,
		dialect: "postgres",
		objects: Object.fromEntries(
			schemas.map((schema) => [
				`table:${schema}.${tableNameFor(schema, schemas.length)}`,
				tableFixture(schema, tableNameFor(schema, schemas.length)),
			]),
		),
	},
	description: {
		tables: schemas.map((schema) => ({
			schema,
			table: tableNameFor(schema, schemas.length),
			columns: [{ sqlName: "id", tsKey: "id" }],
		})),
		roleNames: [],
	},
	lossReport: [],
	sql: schemas
		.map(
			(schema) =>
				`create table "${schema}"."${tableNameFor(schema, schemas.length)}" (\n\t"id" uuid not null primary key\n);\n`,
		)
		.join(""),
	omittedSchemaNames: [],
});

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
			depsFor(resultForSchemas(["zeta", "alpha"])),
		);

		expect(outcome.exitCode).toBe(0);
		const contractText = readFileSync(vendorContractPath(cwd), "utf8");
		expect(contractText).toContain('schemas: ["alpha", "zeta"]');
		const lock = JSON.parse(readFileSync(lockPath(cwd), "utf8"));
		expect(lock.schemas).toEqual(["alpha", "zeta"]);
	});

	/**
	 * N11 (D106 review, cfr1-planner's own measurement): a requested
	 * `--schema` the reading omitted whole (its own catalog name is not
	 * a valid hejbro SQL identifier, `partitionSchemas`) is not one this
	 * command actually read -- the "pulled …" line and the lock's own
	 * `schemas` must never claim it, matching what the loss report
	 * already says was dropped. `omittedSchemaNames` is
	 * `InferCatalogResult`'s own name for exactly this set.
	 */
	it("excludes a requested schema the reading omitted whole from the 'pulled' line and the lock's own schemas", async () => {
		const outcome = await runPull(
			cwd,
			[
				"--db-url",
				"postgres://fixture",
				"--schema",
				"zeta",
				"--schema",
				"BadSchema",
			],
			depsFor({
				...resultForSchemas(["zeta"]),
				omittedSchemaNames: ["BadSchema"],
			}),
		);

		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout[0]).toBe("pulled widgets_db (zeta)");
		const contractText = readFileSync(vendorContractPath(cwd), "utf8");
		expect(contractText).toContain('schemas: ["zeta"]');
		expect(contractText).not.toContain("BadSchema");
		const lock = JSON.parse(readFileSync(lockPath(cwd), "utf8"));
		expect(lock.schemas).toEqual(["zeta"]);
	});

	/**
	 * B2 final (D106 round-1 correction, lead ruling, "pull mirrors
	 * import"): the list/lock is exactly the schemas that actually
	 * contributed something to the snapshot -- a `--schema` that never
	 * existed in the database contributed nothing, the same way an
	 * omitted-whole schema did (above), so it is excluded too. Live-
	 * measured (cfr1-pg): a genuinely absent schema earns its own
	 * `Not inferred: nothing to infer in schema "X".` line (mirroring
	 * `import`'s own `emptySchemaLines`), never the `Omitted: schema …`
	 * line an invalid-name schema earns instead (below) -- the two
	 * causes are announced in different bands, on purpose.
	 */
	it("excludes a requested schema that produced nothing (never existed) from the 'pulled' line and the lock's own schemas, naming it in the Not-inferred band", async () => {
		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture", "--schema", "app", "--schema", "nope"],
			depsFor(widgetsResult),
		);

		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout[0]).toBe("pulled widgets_db (app)");
		expect(outcome.stdout).toContain(
			'Not inferred: nothing to infer in schema "nope".',
		);
		const lock = JSON.parse(readFileSync(lockPath(cwd), "utf8"));
		expect(lock.schemas).toEqual(["app"]);
	});

	/**
	 * B2 final: mirrors `import`'s own already-correct behaviour
	 * verbatim -- an invalid-name schema keeps its own `Omitted: schema
	 * …` line (from `result.lossReport`, shared with `import`), and
	 * never also earns the `Not inferred: nothing to infer …` line
	 * above (`schemaHasNamedOmission`'s own guard).
	 *
	 * NB1 (#1047, review round 2): also pins the report's own band
	 * order with all three cases present at once (a genuinely absent
	 * schema, an invalid-name schema, and content carrying its own
	 * Guessed/Not-inferred/Approximated/Omitted line) -- the absent-
	 * schema line used to land after every Omitted line; it now lands
	 * inside the Not-inferred band.
	 */
	it("names an omitted-whole schema with its own Omitted line, never the Not-inferred nothing-to-infer line, in band order", async () => {
		const outcome = await runPull(
			cwd,
			[
				"--db-url",
				"postgres://fixture",
				"--schema",
				"app",
				"--schema",
				"BadSchema",
				"--schema",
				"nope",
			],
			depsFor({
				...resultForSchemas(["app"]),
				omittedSchemaNames: ["BadSchema"],
				lossReport: [
					"Guessed: TypeScript keys from SQL names.",
					"Not inferred: grants beyond their role name.",
					"Approximated: every default, check, generated, and index-predicate expression is carried as raw SQL text, not the typed builders a hand-written declaration would use.",
					'Omitted: schema "BadSchema" -- its catalog name is not a valid hejbro SQL identifier, so nothing it holds (tables, enums, sequences) can be carried in the contract. Rename the schema in the database, then link the schema repository.',
				],
			}),
		);

		expect(outcome.exitCode).toBe(0);
		expect(
			outcome.stdout.some((line) =>
				line.startsWith('Omitted: schema "BadSchema"'),
			),
		).toBe(true);
		expect(outcome.stdout).not.toContain(
			'Not inferred: nothing to infer in schema "BadSchema".',
		);
		expect(outcome.stdout).toContain(
			'Not inferred: nothing to infer in schema "nope".',
		);
		const bandPrefixes = outcome.stdout
			.map((line) => /^(Guessed|Not inferred|Approximated|Omitted):/.exec(line))
			.filter((match) => match !== null)
			.map((match) => match[1]);
		expect(bandPrefixes).toEqual([
			"Guessed",
			"Not inferred",
			"Not inferred",
			"Approximated",
			"Omitted",
		]);
	});

	/**
	 * B2 final (712/R14, new surface, pending lead approval on the exact
	 * message text): mirrors `import`'s own
	 * `error[import-nothing-declarable]` verbatim, "declare" swapped for
	 * pull's own "carry into the contract" -- a pull that reads real
	 * database objects but can carry none of them into the contract
	 * refuses outright, rather than writing an empty `pulled X ()`
	 * bundle. The requested schema held something (it is in
	 * `omittedSchemaNames`), so this is the "declarable" branch, not the
	 * "nothing to infer" one below.
	 */
	it("refuses with pull-nothing-declarable when a requested schema held something this reading could not carry the name of, and nothing else contributed either", async () => {
		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture", "--schema", "zeta"],
			depsFor({ ...emptyResult, omittedSchemaNames: ["zeta"] }),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("pull-nothing-declarable");
		expect(outcome.stderr).toContain(
			'hejbro pull found nothing it could carry into the contract in schema(s) zeta: each one held something, but its own catalog name is not a valid hejbro SQL identifier (see the "Omitted" line(s) above). Next: rename the schema(s) named above in the database, then rerun `hejbro pull`.',
		);
	});

	/**
	 * B2 final (712/R14, new surface, lead-approved): mirrors `import`'s
	 * own `error[import-nothing-to-infer]` verbatim, only the command
	 * name swapped -- every requested schema produced nothing at all,
	 * and none of them for a nameable-but-omitted reason
	 * (`omittedSchemaNames` is empty), so this is the "genuinely nothing
	 * here" branch, a different code than the "held something, couldn't
	 * carry it" one above.
	 */
	it("refuses with pull-nothing-to-infer when every requested schema produced nothing, and none of them for an omitted-name reason", async () => {
		const outcome = await runPull(
			cwd,
			["--db-url", "postgres://fixture", "--schema", "nope"],
			depsFor(emptyResult),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("pull-nothing-to-infer");
		expect(outcome.stderr).toContain(
			"hejbro pull found no table, enum, or sequence to infer in schema(s) nope. Next: confirm the schema name(s) are correct and that the database holds objects in them, then rerun `hejbro pull`.",
		);
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
		capabilities: {
			"interactive-transactions": false,
			"session-state": false,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: async () => {
			executed.push(1);
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
				inferCatalog: async () => resultForSchemas(["app"]),
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

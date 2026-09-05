import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Snapshot, TableSnapshot } from "@hejbro/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckDriverConnection } from "../src/check/driver";
import type { ImportDeps } from "../src/commands/import";
import { runImport } from "../src/commands/import";
import type { InferCatalogResult } from "../src/infer/compose";

/**
 * `import`'s own dependency seam takes over exactly where `check.ts`'s own
 * `importer` seam does: the connectivity probe still runs against a real
 * (fake) driver, but the actual catalog reading is replaced outright by a
 * canned `InferCatalogResult` -- 2.1's `emitDeclarationFiles` and Group
 * 1's `inferFromCatalog` are proved against real Postgres elsewhere
 * (`declare-emit.integration.test.ts`, `infer-catalog-read.integration.
 * test.ts`); this suite's only job is `import.ts`'s own orchestration:
 * flag validation, refuse-before-write, and writing what it was given.
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
	client: {
		end: async () => {},
	},
};

const fakeImporter = async () => ({ pgDriver: () => fakeConnection });

const table = (
	schema: string,
	name: string,
	columns: TableSnapshot["columns"],
): TableSnapshot => ({
	schema,
	name,
	columns,
	indexes: [],
	foreignKeys: [],
	primaryKeyName: `${name}_pkey`,
});

const snapshotWith = (tables: ReadonlyArray<TableSnapshot>): Snapshot => ({
	formatVersion: 8,
	dialect: "postgres",
	objects: Object.fromEntries(
		tables.map((entry) => [`table:${entry.schema}.${entry.name}`, entry]),
	),
});

const resultFor = (
	tables: ReadonlyArray<TableSnapshot>,
	lossReport: ReadonlyArray<string> = [],
	omittedSchemaNames: ReadonlyArray<string> = [],
): InferCatalogResult => ({
	snapshot: snapshotWith(tables),
	description: {
		tables: tables.map((entry) => ({
			schema: entry.schema,
			table: entry.name,
			columns: entry.columns.map((column) => ({
				sqlName: column.name,
				tsKey: column.name,
			})),
		})),
		roleNames: [],
	},
	lossReport,
	// unused by this suite -- runImport never reads it.
	sql: "",
	omittedSchemaNames,
});

const emptyResult: InferCatalogResult = {
	snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
	description: { tables: [], roleNames: [] },
	lossReport: [],
	sql: "",
	omittedSchemaNames: [],
};

const idColumn: TableSnapshot["columns"][number] = {
	name: "id",
	typeNode: { typeName: "uuid" },
	notNull: true,
	primaryKey: true,
};

const depsFor = (result: InferCatalogResult): ImportDeps => ({
	importer: fakeImporter,
	inferCatalog: async () => result,
});

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "hejbro-import-command-test-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("runImport / 3.1", () => {
	it("writes starter declaration files from a database with two schemas", async () => {
		const appTable = table("app", "widgets", [idColumn]);
		const billingTable = table("billing", "invoices", [idColumn]);
		const result = resultFor([appTable, billingTable]);

		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"app",
				"--schema",
				"billing",
				"--out",
				"src/schema",
			],
			depsFor(result),
		);

		expect(outcome.exitCode).toBe(0);
		expect(outcome.stderr).toBeNull();
		const appPath = join(cwd, "src/schema/app.schema.ts");
		const billingPath = join(cwd, "src/schema/billing.schema.ts");
		expect(existsSync(appPath)).toBe(true);
		expect(existsSync(billingPath)).toBe(true);
		expect(readFileSync(appPath, "utf8")).toContain(
			"export const widgets = table(",
		);
		expect(readFileSync(billingPath, "utf8")).toContain(
			"export const invoices = table(",
		);
	});

	it("leaves out a column the DSL cannot name and reports it in the printed loss report", async () => {
		// `compose.ts` (Group 1) is what actually drops an undeclarable-name
		// column from the snapshot -- this fixture stands in for its output
		// (the column already excluded) with the loss line it would have
		// produced, so this test proves only `import.ts`'s own job: writing
		// exactly what it was given, and printing the loss report verbatim.
		const partialTable = table("app", "events", [idColumn]);
		const lossLine =
			'"createdAt" on app.events cannot be named by any declaration key and is left out of the starter file -- the table is only partly declared until it is declared by hand or renamed.';
		const result = resultFor([partialTable], [lossLine]);

		const outcome = await runImport(
			cwd,
			["--url", "postgres://fixture", "--schema", "app", "--out", "src/schema"],
			depsFor(result),
		);

		expect(outcome.exitCode).toBe(0);
		const source = readFileSync(join(cwd, "src/schema/app.schema.ts"), "utf8");
		// the loss line itself legitimately names "createdAt" in the header's
		// prose (the file carries the loss report in full) -- what must be
		// absent is a *declared column* of that name, i.e. `createdAt:`.
		expect(source).not.toContain("createdAt:");
		expect(outcome.stdout).toContain(lossLine);
	});

	it("never overwrites an existing file -- proved over two schemas, only one of which already exists", async () => {
		// A single-file fixture can't tell "refused before writing" apart
		// from "wrote one file, then failed on the next" -- with two
		// schemas and only `app`'s file pre-existing, the untouched
		// `billing` file must never appear at all.
		mkdirSync(join(cwd, "src/schema"), { recursive: true });
		writeFileSync(join(cwd, "src/schema/app.schema.ts"), "// hand-written\n");
		const result = resultFor([
			table("app", "widgets", [idColumn]),
			table("billing", "invoices", [idColumn]),
		]);

		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"app",
				"--schema",
				"billing",
				"--out",
				"src/schema",
			],
			depsFor(result),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("import-destination-exists");
		expect(outcome.stderr).toContain("app.schema.ts");
		expect(readFileSync(join(cwd, "src/schema/app.schema.ts"), "utf8")).toBe(
			"// hand-written\n",
		);
		expect(existsSync(join(cwd, "src/schema/billing.schema.ts"))).toBe(false);
	});

	/**
	 * D106 N6: `safeFileBaseName` (`declare-emit/emit.ts`) folds every
	 * character outside `[A-Za-z0-9_-]` to `_`, so schemas `"a.b"` and
	 * `"a b"` both become `a_b` -- without a check across the *planned*
	 * files themselves (not just against disk), the second write would
	 * silently overwrite the first, and stdout would print `created ...`
	 * twice for the same path.
	 */
	it("refuses before writing anything when two schemas' starter files would collide on the same path", async () => {
		const result = resultFor([
			table("a.b", "widgets", [idColumn]),
			table("a b", "gadgets", [idColumn]),
		]);

		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"a.b",
				"--schema",
				"a b",
				"--out",
				"src/schema",
			],
			depsFor(result),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("import-destination-collision");
		expect(outcome.stderr).toContain("a_b.schema.ts");
		expect(existsSync(join(cwd, "src/schema"))).toBe(false);
	});

	it("fails when the destination cannot be written, and writes nothing", async () => {
		// `--out` names a path segment that is already a plain file, not a
		// directory, so `mkdir` itself fails (ENOTDIR) before any file is
		// written -- proves the same "wrote nothing" property as the
		// overwrite case, for the other refusal path.
		writeFileSync(join(cwd, "blocked"), "not a directory\n");
		const result = resultFor([table("app", "widgets", [idColumn])]);

		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"app",
				"--out",
				"blocked/schema",
			],
			depsFor(result),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("import-destination-unwritable");
		expect(outcome.stderr).toContain("blocked/schema");
		expect(readFileSync(join(cwd, "blocked"), "utf8")).toBe(
			"not a directory\n",
		);
		expect(existsSync(join(cwd, "blocked/schema/app.schema.ts"))).toBe(false);
	});

	it("refuses to guess which schemas to read when --schema is not given, and shows the common answer", async () => {
		const outcome = await runImport(
			cwd,
			["--url", "postgres://fixture", "--out", "src/schema"],
			depsFor(emptyResult),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("import-schema-missing");
		expect(outcome.stderr).toContain("--schema");
		expect(outcome.stderr).toContain("--schema public");
		expect(existsSync(join(cwd, "src/schema"))).toBe(false);
	});

	it("refuses to guess the destination when --out is not given, and writes nothing", async () => {
		const outcome = await runImport(
			cwd,
			["--url", "postgres://fixture", "--schema", "app"],
			depsFor(resultFor([table("app", "widgets", [idColumn])])),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("import-destination-missing");
		expect(outcome.stderr).toContain("--out");
		// nothing was ever written -- the fixture's own fresh temp dir stays empty.
		expect(readdirSync(cwd)).toEqual([]);
	});

	it("fails when the named schemas hold nothing to infer, and writes no files", async () => {
		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"empty_schema",
				"--out",
				"src/schema",
			],
			depsFor(emptyResult),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("import-nothing-to-infer");
		expect(outcome.stderr).toContain("empty_schema");
		expect(existsSync(join(cwd, "src/schema"))).toBe(false);
	});

	/**
	 * D106 R5-N3(b): `import-nothing-to-infer` used to fire whenever every
	 * named schema produced zero snapshot objects, whether that was
	 * genuine emptiness or an omission for the schema's own name -- the
	 * refusal discarded the `Omitted: schema …` line the reading had
	 * already produced, telling the user "nothing here" about a schema
	 * that in fact held a table hejbro just could not name. The team
	 * lead's ruling: this case still refuses (an empty `--out` directory
	 * left behind by a zero-file "success" is worse than refusing before
	 * `mkdirSync` ever runs), but under its own code -- `import-nothing-
	 * to-infer` means "genuinely empty", `import-nothing-declarable`
	 * means "held something, couldn't name it" -- and only after the
	 * `Omitted: schema …` line has already reached stdout.
	 */
	it("refuses with its own code when every named schema was omitted for its name, not genuinely empty -- after naming the reason and before creating --out", async () => {
		const omittedLine =
			'Omitted: schema "App" -- its catalog name is not a valid hejbro SQL identifier.';
		const result = resultFor([], [omittedLine], ["App"]);

		const outcome = await runImport(
			cwd,
			["--url", "postgres://fixture", "--schema", "App", "--out", "src/schema"],
			depsFor(result),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain("import-nothing-declarable");
		expect(outcome.stdout).toContain(omittedLine);
		expect(existsSync(join(cwd, "src/schema"))).toBe(false);
	});

	/**
	 * D106 N7: when only *some* named schemas hold nothing, `import` wrote
	 * a file for the ones that did and said nothing at all about the ones
	 * that didn't -- no file, no diagnostic, no loss-report line. Only the
	 * all-empty case (above) was ever announced.
	 */
	it("writes a file for the schema that has something and names the one that doesn't, rather than staying silent about it", async () => {
		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"app",
				"--schema",
				"billing",
				"--out",
				"src/schema",
			],
			depsFor(resultFor([table("app", "widgets", [idColumn])])),
		);

		expect(outcome.exitCode).toBe(0);
		expect(existsSync(join(cwd, "src/schema/app.schema.ts"))).toBe(true);
		expect(existsSync(join(cwd, "src/schema/billing.schema.ts"))).toBe(false);
		expect(outcome.stdout).toContain(
			'Not inferred: nothing to infer in schema "billing".',
		);
	});

	/**
	 * D106 R4-B4/#707: a schema `Omitted: schema …` already names is not
	 * "empty" -- it held something, hejbro just could not carry its own
	 * name. Stating both lines side by side would tell the reader two
	 * different, contradictory stories about the same schema. A genuinely
	 * empty schema (named, holds nothing, not omitted for its name) keeps
	 * getting the N7 line exactly as before -- each schema in this fixture
	 * gets exactly its own line, never the other's.
	 */
	it("suppresses the empty-schema line for a schema the loss report already reports as omitted for its name, while a genuinely empty schema still gets its own line", async () => {
		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"App",
				"--schema",
				"app",
				"--schema",
				"billing",
				"--out",
				"src/schema",
			],
			depsFor(
				resultFor(
					[table("app", "widgets", [idColumn])],
					[
						'Omitted: schema "App" -- its catalog name is not a valid hejbro SQL identifier.',
					],
					["App"],
				),
			),
		);

		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout.some((line) => line.includes('schema "App"'))).toBe(
			true,
		);
		expect(
			outcome.stdout.some((line) =>
				line.includes('Not inferred: nothing to infer in schema "App"'),
			),
		).toBe(false);
		expect(outcome.stdout).toContain(
			'Not inferred: nothing to infer in schema "billing".',
		);
	});

	/**
	 * D106 R2-N3: `emptySchemaLines` reached stdout only -- the requirement
	 * is that a file's header carries the loss report "in full", so a
	 * reader of the committed file (not the run's own terminal) must see
	 * the same line. Byte-determinism (the delta's "a second import
	 * writes the same bytes") has to survive the header growing this
	 * line, so a second run into a fresh directory is checked too.
	 */
	it("carries the empty-schema report line in the written file's own header, byte-identically across two runs", async () => {
		const argv = [
			"--url",
			"postgres://fixture",
			"--schema",
			"app",
			"--schema",
			"billing",
			"--out",
			"src/schema",
		];
		const result = resultFor([table("app", "widgets", [idColumn])]);

		const first = await runImport(cwd, argv, depsFor(result));
		expect(first.exitCode).toBe(0);
		const firstSource = readFileSync(
			join(cwd, "src/schema/app.schema.ts"),
			"utf8",
		);
		expect(firstSource).toContain(
			'Not inferred: nothing to infer in schema "billing".',
		);

		const cwd2 = mkdtempSync(join(tmpdir(), "hejbro-import-command-test-"));
		try {
			const second = await runImport(cwd2, argv, depsFor(result));
			expect(second.exitCode).toBe(0);
			const secondSource = readFileSync(
				join(cwd2, "src/schema/app.schema.ts"),
				"utf8",
			);
			expect(secondSource).toBe(firstSource);
		} finally {
			rmSync(cwd2, { recursive: true, force: true });
		}
	});

	/**
	 * D106 R6-N3: `withEmptySchemaLines` used to append the empty-schema
	 * line after `buildLossReport` had already closed with the way-out
	 * line, so the way-out line was no longer the report's own last line
	 * -- in stdout or in the header, identically (R2-N3's own parity
	 * property). The injected `lossReport` here is shaped exactly like a
	 * real `buildLossReport("import")` call's own output: guessed facts,
	 * then the way-out line last -- proving the fix holds for the report
	 * `withEmptySchemaLines` actually receives, not a hand-picked shape.
	 */
	it("prints the empty-schema line before the way out, in stdout and in every file header alike", async () => {
		const guessedLine =
			"Guessed: TypeScript keys from SQL names, the default numeric mode, and unknown array-element nullability (read as nullable).";
		const wayOut = "The loss ends when you hand-edit the starter declarations.";
		const billingLine = 'Not inferred: nothing to infer in schema "billing".';
		const result = resultFor(
			[table("app", "widgets", [idColumn])],
			[guessedLine, wayOut],
		);

		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"app",
				"--schema",
				"billing",
				"--out",
				"src/schema",
			],
			depsFor(result),
		);

		expect(outcome.exitCode).toBe(0);
		// The way-out line is the report's own last line -- stdout's true
		// last element, since nothing follows the report there.
		expect(outcome.stdout.at(-1)).toBe(wayOut);

		const expectedReportOrder = [guessedLine, billingLine, wayOut];
		const stdoutReportLines = outcome.stdout.filter((line) =>
			expectedReportOrder.includes(line),
		);
		expect(stdoutReportLines).toEqual(expectedReportOrder);

		// Round-2 parity: the written file's own header carries the same
		// report lines, in the same order, as stdout's own report half.
		const schemaSource = readFileSync(
			join(cwd, "src/schema/app.schema.ts"),
			"utf8",
		);
		const fileLines = schemaSource.split("\n");
		const headerIndices = expectedReportOrder.map((line) =>
			fileLines.indexOf(` * ${line}`),
		);
		expect(headerIndices.every((index) => index !== -1)).toBe(true);
		expect(headerIndices).toEqual([...headerIndices].sort((a, b) => a - b));
	});
});

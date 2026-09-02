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
	capabilities: { "interactive-transactions": false, "session-state": false },
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
});

const emptyResult: InferCatalogResult = {
	snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
	description: { tables: [], roleNames: [] },
	lossReport: [],
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
});

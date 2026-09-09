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
import { createCliFixtureDir, removeCliFixtureDir } from "./support/cli-runner";

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
			'Not inferred: no table or enum to declare in schema "billing".',
		);
	});

	/**
	 * 712/R10 N#4: a schema that produced zero snapshot objects only
	 * because everything it held was itself omitted (an enum whose own
	 * name D36 rejects, here) is not "nothing to infer" -- the loss
	 * report's own "Omitted: …" line already gives the real reason, and
	 * stating both would tell the reader two different stories about the
	 * same schema. The test right above this one is this test's own
	 * control: a genuinely empty schema (no such line at all) still gets
	 * the plain "nothing to infer" line.
	 */
	it("N#4: suppresses the empty-schema line when the loss report already named an object this schema's own content cost it", async () => {
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
			depsFor(
				resultFor(
					[table("app", "widgets", [idColumn])],
					[
						'Omitted: enum type "billing.Status" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it.',
					],
				),
			),
		);

		expect(outcome.exitCode).toBe(0);
		expect(
			outcome.stdout.some((line) =>
				line.includes(
					'Not inferred: no table or enum to declare in schema "billing"',
				),
			),
		).toBe(false);
		expect(outcome.stdout).toContain(
			'Omitted: enum type "billing.Status" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it.',
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
	 *
	 * NB1 (#1047, review round 2): also pins the report's own band order
	 * with all three cases present at once (a genuinely empty schema, an
	 * invalid-name schema, and content that itself carries a Guessed/
	 * Not-inferred/Approximated/Omitted line each) -- the empty-schema
	 * line used to land after every Omitted line (appended right before
	 * the way-out line); it now lands inside the Not-inferred band, so
	 * the four bands never interleave.
	 */
	it("suppresses the empty-schema line for a schema the loss report already reports as omitted for its name, while a genuinely empty schema still gets its own line, in band order", async () => {
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
						"Guessed: TypeScript keys from SQL names.",
						"Not inferred: grants beyond their role name.",
						"Approximated: every default, check, generated, and index-predicate expression is carried as raw SQL text, not the typed builders a hand-written declaration would use.",
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
				line.includes(
					'Not inferred: no table or enum to declare in schema "App"',
				),
			),
		).toBe(false);
		expect(outcome.stdout).toContain(
			'Not inferred: no table or enum to declare in schema "billing".',
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
	 * NB1 (#1047, review round 2): the insertion point's own fallback,
	 * pinned rather than left undefined -- `withReportLinesInNotInferredBand`
	 * finds the *last* existing `Guessed:`/`Not inferred:` line and
	 * inserts right after it; when a report carries neither (never true
	 * for `buildLossReport`'s own real output, which always opens with
	 * a `Guessed:` line, but reachable through this suite's own
	 * synthetic `lossReport: []`), the insertion point is the very
	 * front of the report -- still ahead of any Approximated/Omitted
	 * line, the position the band order requires.
	 */
	it("NB1 fallback: inserts the empty-schema line at the very front when the report carries no Guessed/Not-inferred line at all", async () => {
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
			depsFor(
				resultFor(
					[table("app", "widgets", [idColumn])],
					[
						"Approximated: every default, check, generated, and index-predicate expression is carried as raw SQL text, not the typed builders a hand-written declaration would use.",
					],
				),
			),
		);

		expect(outcome.exitCode).toBe(0);
		const bandLines = outcome.stdout.filter((line) =>
			/^(Guessed|Not inferred|Approximated|Omitted):/.test(line),
		);
		expect(bandLines[0]).toBe(
			'Not inferred: no table or enum to declare in schema "billing".',
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
			'Not inferred: no table or enum to declare in schema "billing".',
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
		const billingLine =
			'Not inferred: no table or enum to declare in schema "billing".';
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

/**
 * 712/R15 (D106 round 2, R2-B2/R2-N3, lead ruling): a schema whose only
 * objects are omitted for their own name still held something the
 * reading saw -- `import-nothing-to-infer` used to fire for it anyway,
 * discarding the loss report and telling the user "nothing here" about
 * a schema that in fact held a table/enum hejbro just could not carry
 * the name of. The classification now counts what the reading saw
 * (an `Omitted:` line naming that schema), not what it kept --
 * `nothing-declarable` is reserved for that name cause; a schema
 * holding only a standalone sequence or function (a *kind* cause, D66,
 * not a name one) stays `nothing-to-infer`, alongside its own
 * `Not inferred:` line, never silently. Neither refusal ever suppresses
 * the report that precedes it: both print the full loss report to
 * stdout before exiting 1.
 */
describe("runImport / 712 D106 R2 3.1 (R2-B2, R2-N3)", () => {
	const badOnlyOmittedLine =
		'Omitted: table "bad_only.Only" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it.';
	const badEnumOnlyOmittedLine =
		'Omitted: enum type "bad_enum_only.Color" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it.';
	const badTableSeqOmittedLine =
		'Omitted: table "bad_table_plus_seq.T" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it.';
	const badTableSeqNotInferredLine =
		'Not inferred: sequence "bad_table_plus_seq.s2" -- no column owns it, and the DSL has no defineSequence() (D66).';
	const seqOnlyNotInferredLine =
		'Not inferred: sequence "seq_only.s" -- no column owns it, and the DSL has no defineSequence() (D66).';
	const fnOnlyNotInferredLine = "Not inferred: 1 function(s) not inferred.";

	const nothingDeclarableMessage = (schemas: string): string =>
		`hejbro import found nothing it could declare in schema(s) ${schemas}: each one held something whose name no declaration can carry (see the "Omitted" line(s) above). Next: follow the way out that line names (a rename in the database), then rerun \`hejbro import\`.`;

	const nothingToInferMessage = (schemas: string): string =>
		`hejbro import found no table or enum to declare in schema(s) ${schemas}. Next: confirm the schema name(s) are correct and that they hold a table or enum type to declare, then rerun \`hejbro import\`.`;

	it.each<[string, string, ReadonlyArray<string>]>([
		["a table with an uncarriable name only", "bad_only", [badOnlyOmittedLine]],
		[
			"an enum with an uncarriable name only",
			"bad_enum_only",
			[badEnumOnlyOmittedLine],
		],
		[
			"a table with an uncarriable name plus a standalone sequence",
			"bad_table_plus_seq",
			[badTableSeqOmittedLine, badTableSeqNotInferredLine],
		],
	])(
		"refuses with import-nothing-declarable, never import-nothing-to-infer, for a schema holding %s -- naming that schema and printing the loss report first",
		async (_label, schema, lossReport) => {
			const outcome = await runImport(
				cwd,
				[
					"--url",
					"postgres://fixture",
					"--schema",
					schema,
					"--out",
					"src/schema",
				],
				depsFor(resultFor([], lossReport)),
			);

			expect(outcome.exitCode).toBe(1);
			expect(outcome.stderr).toContain("error[import-nothing-declarable]");
			expect(outcome.stderr).not.toContain("import-nothing-to-infer");
			expect(outcome.stderr).toContain(nothingDeclarableMessage(schema));
			lossReport.map((line) => expect(outcome.stdout).toContain(line));
			expect(existsSync(join(cwd, "src/schema"))).toBe(false);
		},
	);

	it("names only the schema that held something, never a schema the database does not hold, in the same refusal", async () => {
		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"bad_only",
				"--schema",
				"nope",
				"--out",
				"src/schema",
			],
			depsFor(resultFor([], [badOnlyOmittedLine])),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain(nothingDeclarableMessage("bad_only"));
		expect(outcome.stderr).not.toContain("nope");
		expect(outcome.stdout).toContain(badOnlyOmittedLine);
		expect(outcome.stdout).toContain(
			'Not inferred: no table or enum to declare in schema "nope".',
		);
	});

	it("names only the schema that held something, never a schema that is genuinely empty, in the same refusal", async () => {
		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"bad_only",
				"--schema",
				"empty_s",
				"--out",
				"src/schema",
			],
			depsFor(resultFor([], [badOnlyOmittedLine])),
		);

		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toContain(nothingDeclarableMessage("bad_only"));
		expect(outcome.stderr).not.toContain("empty_s");
		expect(outcome.stdout).toContain(badOnlyOmittedLine);
		expect(outcome.stdout).toContain(
			'Not inferred: no table or enum to declare in schema "empty_s".',
		);
	});

	it("writes files and prints the omission with no refusal at all when the uncarriable schema sits beside a healthy one", async () => {
		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"bad_only",
				"--schema",
				"healthy",
				"--out",
				"src/schema",
			],
			depsFor(
				resultFor(
					[table("healthy", "widgets", [idColumn])],
					[badOnlyOmittedLine],
				),
			),
		);

		expect(outcome.exitCode).toBe(0);
		expect(existsSync(join(cwd, "src/schema/healthy.schema.ts"))).toBe(true);
		expect(existsSync(join(cwd, "src/schema/bad_only.schema.ts"))).toBe(false);
		expect(outcome.stdout).toContain(badOnlyOmittedLine);
	});

	/**
	 * R2-N3 boundary, lead ruling: a schema holding *only* a standalone
	 * sequence or function is a *kind* cause (D66, no DSL builder), never
	 * a name one -- it stays `import-nothing-to-infer`, not
	 * `import-nothing-declarable`, but the refusal still prints the
	 * schema's own `Not inferred:` line rather than an empty stdout.
	 */
	it.each<[string, string, string]>([
		["a standalone sequence only", "seq_only", seqOnlyNotInferredLine],
		["a function only", "fn_only", fnOnlyNotInferredLine],
	])(
		"refuses with import-nothing-to-infer, never import-nothing-declarable, for a schema holding %s -- printing its own Not-inferred line first",
		async (_label, schema, notInferredLine) => {
			const outcome = await runImport(
				cwd,
				[
					"--url",
					"postgres://fixture",
					"--schema",
					schema,
					"--out",
					"src/schema",
				],
				depsFor(resultFor([], [notInferredLine])),
			);

			expect(outcome.exitCode).toBe(1);
			expect(outcome.stderr).toContain("error[import-nothing-to-infer]");
			expect(outcome.stderr).not.toContain("import-nothing-declarable");
			expect(outcome.stderr).toContain(nothingToInferMessage(schema));
			expect(outcome.stdout).toContain(notInferredLine);
			expect(outcome.stdout).toContain(
				`Not inferred: no table or enum to declare in schema "${schema}".`,
			);
			expect(existsSync(join(cwd, "src/schema"))).toBe(false);
		},
	);

	/** Regression guard: a schema holding no table, enum, sequence or function at all keeps `import-nothing-to-infer`, printing its own generic line, corrected wording. */
	it("still refuses with import-nothing-to-infer, corrected wording, when the only named schema truly holds nothing", async () => {
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
		expect(outcome.stderr).toContain("error[import-nothing-to-infer]");
		expect(outcome.stderr).toContain(nothingToInferMessage("empty_schema"));
		expect(outcome.stdout).toContain(
			'Not inferred: no table or enum to declare in schema "empty_schema".',
		);
		expect(existsSync(join(cwd, "src/schema"))).toBe(false);
	});
});

/**
 * 712/R17 (D106 round 2 constructor review, B2, lead ruling, extended):
 * a schema whose own name fails D36 counts what it held, not that its
 * own name failed. `partitionSchemas` (`compose.ts`) now puts a
 * D36-failing schema on `omittedSchemas` only when it held at least one
 * table or enum -- a schema failing D36 but holding nothing, or holding
 * only a standalone sequence or a function, earns no `Omitted: schema
 * …` line at all (that line's own rename would recover nothing) and
 * never reaches `omittedSchemaNames`; it falls through to the same
 * `Not inferred: no table or enum to declare in schema "X".` line a
 * genuinely empty schema gets, and classifies as
 * `import-nothing-to-infer`, never `import-nothing-declarable` on its
 * own name alone.
 */
describe("runImport / 712 D106 R2 B2 (R17): an omitted-for-name schema counts what it held", () => {
	const badWithContentOmittedLine =
		'Omitted: schema "BadWithContent" -- its catalog name is not a valid hejbro SQL identifier.';
	const notInferredLineFor = (schemaName: string): string =>
		`Not inferred: no table or enum to declare in schema "${schemaName}".`;

	it.each<[string]>([["EmptyBad"], ["SeqOnlyBad"]])(
		"refuses with import-nothing-to-infer, never import-nothing-declarable, and never prints an Omitted line, for %s (its own name fails D36 but it lost no table or enum) -- alone",
		async (schemaName) => {
			const outcome = await runImport(
				cwd,
				[
					"--url",
					"postgres://fixture",
					"--schema",
					schemaName,
					"--out",
					"src/schema",
				],
				depsFor(resultFor([])),
			);

			expect(outcome.exitCode).toBe(1);
			expect(outcome.stderr).toContain("error[import-nothing-to-infer]");
			expect(outcome.stderr).not.toContain("import-nothing-declarable");
			expect(outcome.stdout).not.toContain("Omitted:");
			expect(outcome.stdout).toContain(notInferredLineFor(schemaName));
			expect(existsSync(join(cwd, "src/schema"))).toBe(false);
		},
	);

	it.each<[string]>([["EmptyBad"], ["SeqOnlyBad"]])(
		"refuses with import-nothing-declarable naming only the sibling that lost a table, never %s, beside it -- and still names %s's own Not-inferred line",
		async (schemaName) => {
			const outcome = await runImport(
				cwd,
				[
					"--url",
					"postgres://fixture",
					"--schema",
					schemaName,
					"--schema",
					"BadWithContent",
					"--out",
					"src/schema",
				],
				depsFor(resultFor([], [badWithContentOmittedLine], ["BadWithContent"])),
			);

			expect(outcome.exitCode).toBe(1);
			expect(outcome.stderr).toContain("error[import-nothing-declarable]");
			expect(outcome.stderr).toContain("BadWithContent");
			expect(outcome.stderr).not.toContain(schemaName);
			expect(outcome.stdout).toContain(badWithContentOmittedLine);
			expect(outcome.stdout).toContain(notInferredLineFor(schemaName));
		},
	);

	it("writes files and prints the sibling's Not-inferred line, no refusal at all, when an empty badly-named schema sits beside a healthy one", async () => {
		const outcome = await runImport(
			cwd,
			[
				"--url",
				"postgres://fixture",
				"--schema",
				"EmptyBad",
				"--schema",
				"healthy",
				"--out",
				"src/schema",
			],
			depsFor(resultFor([table("healthy", "widgets", [idColumn])])),
		);

		expect(outcome.exitCode).toBe(0);
		expect(existsSync(join(cwd, "src/schema/healthy.schema.ts"))).toBe(true);
		expect(outcome.stdout).not.toContain("Omitted:");
		expect(outcome.stdout).toContain(notInferredLineFor("EmptyBad"));
	});
});

// add-config-driver, #458, task 1.4: mirrors pull-command.test.ts's own
// two blocks -- every test above this point runs in a bare `mkdtempSync`
// `cwd` with no `hejbro.config.ts`, so it already proves the "no
// configuration file" path unchanged (lead ruling 458/R2). These two
// need `node_modules/hejbro` to actually resolve (their fixture config
// imports it), so they use `createCliFixtureDir` instead.
const FACTORY_SEAM_KEY = "__hejbroImportConfigDriverFactorySeam458__";

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

describe("hejbro import / the configured driver factory threads through (#458 task 1.4)", () => {
	let factoryCwd: string;

	beforeEach(async () => {
		factoryCwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		clearFactorySeam();
		await removeCliFixtureDir(factoryCwd);
	});

	it("calls the factory exactly once with --url's string, the recording driver takes the connectivity probe, closes it, and never imports @hejbro/pg", async () => {
		writeFileSync(join(factoryCwd, "hejbro.config.ts"), FACTORY_CONFIG_SOURCE);
		const { driver, executed, closed } = buildRecordingDriver();
		const calls: string[] = [];
		installFactorySeam({ calls, driver });
		const importerCalls: string[] = [];
		const importer = async (): Promise<never> => {
			importerCalls.push("called");
			throw new Error("the importer must not run when a factory is configured");
		};

		const outcome = await runImport(
			factoryCwd,
			[
				"--url",
				"postgres://factory-test",
				"--schema",
				"app",
				"--out",
				"src/schema",
			],
			{
				importer,
				inferCatalog: async () =>
					resultFor([table("app", "widgets", [idColumn])]),
			},
		);

		expect(outcome.exitCode).toBe(0);
		expect(calls).toEqual(["postgres://factory-test"]);
		expect(importerCalls).toHaveLength(0);
		expect(executed.length).toBeGreaterThan(0);
		expect(closed).toHaveLength(1);
	});
});

describe("hejbro import / a configuration present but silent on driver behaves like none (#458 task 1.4)", () => {
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

		const outcome = await runImport(
			noDriverCwd,
			["--url", "postgres://fixture", "--schema", "app", "--out", "src/schema"],
			depsFor(resultFor([table("app", "widgets", [idColumn])])),
		);

		expect(outcome.exitCode).toBe(0);
	});
});

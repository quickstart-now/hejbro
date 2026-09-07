import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { createJiti } from "jiti";
import { afterEach, describe, expect, it } from "vitest";
import { CHECK_CATALOG_QUERIES } from "../src/check/catalog";
import { emitDeclarationFiles } from "../src/declare-emit/emit";
import { INFER_CATALOG_QUERIES } from "../src/infer/catalog";
import type { InferCatalogResult } from "../src/infer/compose";
import { inferFromCatalog } from "../src/infer/compose";

type CheckQueryKey = keyof typeof CHECK_CATALOG_QUERIES;
type InferQueryKey = keyof typeof INFER_CATALOG_QUERIES;

type TableFixture = { readonly schema: string; readonly table: string };

type ColumnFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly sqlType?: string;
	readonly baseTypeName?: string;
	readonly baseTypeKind?: string | null;
	readonly baseTypeSchema?: string | null;
	/** `pg_get_expr` text over `pg_attrdef` when this column is `attgenerated = 's'` -- set only for a stored generated column (measured against `postgres:17-alpine`, `check/catalog.ts`'s own split). */
	readonly generated?: string;
	/** `pg_depend`'s own normal dependency of a generated column's `pg_attrdef` row on the columns its expression names (measured, `postgres:17-alpine`) -- set only alongside `generated`. */
	readonly generatedReferences?: ReadonlyArray<string>;
	/** `attidentity` -- set only for an identity column, never together with `generated` (mutually exclusive on a real column). */
	readonly identity?: "a" | "d";
};

type EnumFixture = {
	readonly schema: string;
	readonly name: string;
	readonly labels: ReadonlyArray<string>;
};

const columnRow = (column: ColumnFixture): DriverRow => ({
	schema: column.schema,
	table: column.table,
	name: column.name,
	notNull: true,
	catalogType: column.sqlType ?? "uuid",
	baseTypeKind: column.baseTypeKind ?? null,
	baseTypeSchema: column.baseTypeSchema ?? null,
	baseTypeName: column.baseTypeName ?? "uuid",
	catalogDefault: null,
	catalogGenerated: column.generated ?? null,
});

const generatedKindFor = (column: ColumnFixture): string => {
	if (column.generated === undefined) {
		return "";
	}
	return "s";
};

const columnDetailRow = (
	column: ColumnFixture,
	position: number,
): DriverRow => ({
	schema: column.schema,
	table: column.table,
	name: column.name,
	position,
	identityKind: column.identity ?? "",
	generatedKind: generatedKindFor(column),
	referencedColumns: column.generatedReferences ?? [],
});

/**
 * 712/R11 (B1, #1022): a stored generated column read as a plain
 * column, silently -- built from a scenario's own tables/columns, one
 * independent fixture per input-table row (D110), mirroring
 * `infer-omitted-enum.test.ts`'s own fake `DriverSession`. Identity
 * options are never asked for here (every identity column below keeps
 * every value at Postgres's own default, so `identityOptionsDiff`
 * renders none) -- `sequenceOwnership` stays empty on purpose.
 */
const buildSession = (
	tables: ReadonlyArray<TableFixture>,
	columns: ReadonlyArray<ColumnFixture>,
	enums: ReadonlyArray<EnumFixture> = [],
): DriverSession => {
	const positionByColumn = new Map<string, number>();
	const columnDetails = columns.map((column) => {
		const key = `${column.schema}.${column.table}`;
		const nextPosition = (positionByColumn.get(key) ?? 0) + 1;
		positionByColumn.set(key, nextPosition);
		return columnDetailRow(column, nextPosition);
	});

	const checkFixtureRows: {
		readonly [K in CheckQueryKey]: ReadonlyArray<DriverRow>;
	} = {
		schemas: [...new Set(tables.map((table) => table.schema))].map(
			(schema) => ({ schema }),
		),
		tables: tables.map((table) => ({ ...table, rls: false })),
		columns: columns.map(columnRow),
		constraints: tables.map((table) => ({
			schema: table.schema,
			table: table.table,
			name: `${table.table}_pkey`,
			type: "p" as const,
			columns: ["id"],
		})),
		indexes: [],
		enums: enums.map((entry) => ({ schema: entry.schema, name: entry.name })),
		sequences: [],
		functions: [],
		views: [],
		policies: [],
		triggers: [],
		tableGrants: [],
		schemaUsageGrants: [],
		defaultTableGrants: [],
		extensions: [],
	};

	const inferFixtureRows: {
		readonly [K in InferQueryKey]: ReadonlyArray<DriverRow>;
	} = {
		columnDetails,
		foreignKeyDetails: [],
		checkExpressions: [],
		indexDetails: [],
		enumLabels: enums.flatMap((entry) =>
			entry.labels.map((label, index) => ({
				schema: entry.schema,
				name: entry.name,
				label,
				sortOrder: index + 1,
			})),
		),
		sequenceOwnership: [],
	};

	return {
		execute: async (compiled: CompileResult) => {
			const checkEntry = (
				Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
					[CheckQueryKey, string]
				>
			).find(([, sql]) => sql === compiled.sql);
			if (checkEntry !== undefined) {
				return checkFixtureRows[checkEntry[0]];
			}
			const inferEntry = (
				Object.entries(INFER_CATALOG_QUERIES) as ReadonlyArray<
					[InferQueryKey, string]
				>
			).find(([, sql]) => sql === compiled.sql);
			if (inferEntry !== undefined) {
				return inferFixtureRows[inferEntry[0]];
			}
			throw new Error(
				`unexpected query sent to inferFromCatalog: ${compiled.sql}`,
			);
		},
	};
};

let dir = "";

afterEach(() => {
	if (dir !== "") {
		rmSync(dir, { recursive: true, force: true });
		dir = "";
	}
});

const importAsEntry = async (path: string): Promise<unknown> => {
	const jiti = createJiti(path, { fsCache: false });
	return jiti.import(path);
};

const writeFiles = (result: InferCatalogResult): ReadonlyArray<string> => {
	dir = mkdtempSync(join(__dirname, "_tmp-generated-column-"));
	return emitDeclarationFiles(result).map((file) => {
		const path = join(dir, `${file.fileBaseName}.schema.ts`);
		writeFileSync(path, file.source);
		return path;
	});
};

const sourceOf = (result: InferCatalogResult): string =>
	emitDeclarationFiles(result)
		.map((file) => file.source)
		.join("\n");

describe("inferFromCatalog / B1, 712/R11: a stored generated column is read as one, never a plain column", () => {
	it("a generated column whose expression names one column, one naming two columns with a cast, and one beside an identity column all reach the starter as generatedAlwaysAs, never a plain column or a default", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t" }],
			[
				{
					schema: "app",
					table: "t",
					name: "id",
					sqlType: "integer",
					baseTypeName: "int4",
					identity: "a",
				},
				{
					schema: "app",
					table: "t",
					name: "a",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				{
					schema: "app",
					table: "t",
					name: "b",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				// Names one column (measured, postgres:17-alpine: `create table
				// app2.t (... label text generated always as (upper(a::text))
				// stored)` -> `pg_get_expr` text `upper((a)::text)`).
				{
					schema: "app",
					table: "t",
					name: "label",
					sqlType: "text",
					baseTypeName: "text",
					generated: "upper((a)::text)",
				},
				// Names two columns with a cast around the whole expression --
				// distinct from label's cast-inside-a-function-call shape.
				{
					schema: "app",
					table: "t",
					name: "combo",
					sqlType: "text",
					baseTypeName: "text",
					generated: "((a + b))::text",
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const source = sourceOf(result);
		expect(source).toContain('.generatedAlwaysAs(sql.raw("upper((a)::text)"))');
		expect(source).toContain('.generatedAlwaysAs(sql.raw("((a + b))::text"))');
		// The identity column beside them keeps its own marker, not folded
		// into or displaced by the generated ones on the same table.
		expect(source).toContain(".generatedAlwaysAsIdentity(");
		// Never a plain column, and never a `.default(...)` re-reading of the
		// same `pg_attrdef` row a plain default would use (B1's own trap).
		expect(source).not.toContain("label: text(),");
		expect(source).not.toContain("combo: text(),");
		expect(source).not.toMatch(/label:\s*text\(\)\.default/);
		expect(source).not.toMatch(/combo:\s*text\(\)\.default/);

		// No band names label/combo/id -- a correctly carried column is
		// never also reported as an approximation, omission or loss (B1:
		// "no Guessed, Not inferred, Approximated or Omitted line named
		// any of the three").
		expect(
			result.lossReport.some(
				(line) => line.includes("app.t.label") || line.includes("app.t.combo"),
			),
		).toBe(false);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("a generated column whose own name no declaration can carry is omitted with it, exactly like a plain column would be (the existing Omitted rule wins)", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t" }],
			[
				{
					schema: "app",
					table: "t",
					name: "id",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				// A space in the SQL name: no TS key round-trips to it (same
				// shape as the review's own `"users v2"`), independent of the
				// generated axis entirely.
				{
					schema: "app",
					table: "t",
					name: "gen code",
					sqlType: "text",
					baseTypeName: "text",
					generated: "upper(id::text)",
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const source = sourceOf(result);
		expect(source).not.toContain("generatedAlwaysAs");
		expect(
			result.lossReport.some(
				(line) =>
					line.startsWith("Omitted: column") &&
					line.includes('"app.t.gen code"'),
			),
		).toBe(true);
	});
});

/**
 * 712/R11/R12 (cross-cutting cell 1, lead pre-ruling on 712/R12): a
 * generated column whose own expression names a column this reading
 * already omitted (for its own name, or for the enum type that typed
 * it) is a new failure mode the merge fix above opens on its own --
 * before it, the generated column fell back to a plain column and
 * happened to produce valid SQL; after it, the catalog's own expression
 * text is carried verbatim and now names a column the starter never
 * declares, which Postgres itself refuses at `CREATE TABLE` (measured,
 * postgres:17-alpine: `column "Bad Name" does not exist`). The generated
 * column is therefore excluded with the column it depends on, the same
 * "member at an omitted column" shape 712/R10 B#1 already gives an index
 * or a check constraint.
 */
describe("inferFromCatalog / 712/R11/R12 cross-cutting cell 1: a generated column naming an already-omitted column is itself omitted", () => {
	it("names a column omitted for its own name", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t" }],
			[
				{
					schema: "app",
					table: "t",
					name: "id",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				// A space: no TS key round-trips to it (D36), the same shape
				// the review's own "users v2" and "createdAt" already cost.
				{
					schema: "app",
					table: "t",
					name: "Bad Name",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				{
					schema: "app",
					table: "t",
					name: "total",
					sqlType: "integer",
					baseTypeName: "int4",
					generated: '("Bad Name" + 1)',
					generatedReferences: ["Bad Name"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const source = sourceOf(result);
		// Neither the DSL declaration nor the migration SQL a following
		// `baseline` would replay ever names `total` -- a surviving column
		// naming an omitted one is exactly what B#1 forbids.
		expect(source).not.toMatch(/total:/);
		expect(result.lossReport).toContain(
			'Omitted: generated column "app.t.total" -- its expression names column "app.t.Bad Name", which this reading left out because no declaration can carry its name, so the generated column cannot be declared either. `check` keeps listing the generated column as unmanaged until that column and the generated column are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("names a column typed by an omitted enum", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t" }],
			[
				{
					schema: "app",
					table: "t",
					name: "id",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				{
					schema: "app",
					table: "t",
					name: "status",
					sqlType: 'app."Status"',
					baseTypeName: "Status",
					baseTypeKind: "e",
					baseTypeSchema: "app",
				},
				{
					schema: "app",
					table: "t",
					name: "derived",
					sqlType: "text",
					baseTypeName: "text",
					generated: "(status)::text",
					generatedReferences: ["status"],
				},
			],
			[{ schema: "app", name: "Status", labels: ["open", "closed"] }],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const source = sourceOf(result);
		expect(source).not.toMatch(/derived:/);
		expect(result.lossReport).toContain(
			'Omitted: generated column "app.t.derived" -- its expression names column "app.t.status", which this reading left out with the enum type "app.Status" that types it, so the generated column cannot be declared either. `check` keeps listing the generated column as unmanaged until that column and the generated column are both declared. Next: rename the type in the database, then re-run `hejbro import`.',
		);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("control: a generated column naming a surviving column is unaffected", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t" }],
			[
				{
					schema: "app",
					table: "t",
					name: "id",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				{
					schema: "app",
					table: "t",
					name: "a",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				{
					schema: "app",
					table: "t",
					name: "total",
					sqlType: "integer",
					baseTypeName: "int4",
					generated: "(a + 1)",
					generatedReferences: ["a"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const source = sourceOf(result);
		expect(source).toContain('.generatedAlwaysAs(sql.raw("(a + 1)"))');
		expect(result.lossReport.some((line) => line.includes("app.t.total"))).toBe(
			false,
		);
	});
});

/**
 * 712/R11/R12 (cross-cutting cell 2): a generated column typed by
 * something no column builder expresses at all (`money`) is not a case
 * this fix's own Approximated-line promise ("if the DSL cannot carry
 * the expression the reading found, an Approximated line names the
 * column") ever reaches -- `inferColumnDeclaration`'s type lookup fails
 * before the generated/identity/default branch is ever asked, so the
 * existing "Not inferred: column ... no column builder expresses it"
 * line already names it, the same as a plain column of that type would
 * get. No new line: adding one here would be the dead branch the lead's
 * own instruction (R12) warns against building.
 */
describe("inferFromCatalog / 712/R11/R12 cross-cutting cell 2: a generated column of a type no builder expresses", () => {
	it("is named by the existing Not-inferred type line, never silently", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t" }],
			[
				{
					schema: "app",
					table: "t",
					name: "id",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				{
					schema: "app",
					table: "t",
					name: "a",
					sqlType: "integer",
					baseTypeName: "int4",
				},
				{
					schema: "app",
					table: "t",
					name: "cost",
					sqlType: "money",
					baseTypeName: "money",
					generated: "(a::numeric::money)",
					generatedReferences: ["a"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const source = sourceOf(result);
		expect(source).not.toMatch(/cost:/);
		expect(result.lossReport).toContain(
			'Not inferred: column "app.t.cost" (type "money") -- no column builder expresses it.',
		);
		// No Approximated line names it either -- the type loss is the
		// whole story, never doubled (D2's own forbidden double report).
		expect(
			result.lossReport.some(
				(line) => line.startsWith("Approximated:") && line.includes("cost"),
			),
		).toBe(false);
	});
});

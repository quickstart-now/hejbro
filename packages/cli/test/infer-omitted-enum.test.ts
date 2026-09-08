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
	readonly enumType?: { readonly schema: string; readonly name: string };
};

type EnumFixture = {
	readonly schema: string;
	readonly name: string;
	readonly labels: ReadonlyArray<string>;
};

const catalogTypeFor = (column: ColumnFixture): string => {
	if (column.enumType === undefined) {
		return "uuid";
	}
	return `${column.enumType.schema}."${column.enumType.name}"`;
};

const baseTypeKindFor = (column: ColumnFixture): string | null => {
	if (column.enumType === undefined) {
		return null;
	}
	return "e";
};

/** `pg_type.typname` (not `format_type` text) -- the key `SIMPLE_TYPE_BUILDERS` looks a plain column's builder up by; an enum column's own base type is the enum's own name. */
const baseTypeNameFor = (column: ColumnFixture): string => {
	if (column.enumType === undefined) {
		return "uuid";
	}
	return column.enumType.name;
};

const columnRow = (column: ColumnFixture): DriverRow => ({
	schema: column.schema,
	table: column.table,
	name: column.name,
	notNull: true,
	catalogType: catalogTypeFor(column),
	baseTypeKind: baseTypeKindFor(column),
	baseTypeSchema: column.enumType?.schema ?? null,
	baseTypeName: baseTypeNameFor(column),
	catalogDefault: null,
	catalogGenerated: null,
});

const columnDetailRow = (
	column: ColumnFixture,
	position: number,
): DriverRow => ({
	schema: column.schema,
	table: column.table,
	name: column.name,
	position,
	identityKind: "",
	generatedKind: "",
	referencedColumns: [],
});

const enumLabelRows = (enumFixture: EnumFixture): ReadonlyArray<DriverRow> =>
	enumFixture.labels.map((label, index) => ({
		schema: enumFixture.schema,
		name: enumFixture.name,
		label,
		sortOrder: index + 1,
	}));

type ForeignKeyFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly targetSchema: string;
	readonly targetTable: string;
	readonly targetColumns: ReadonlyArray<string>;
};

type BuildSessionOptions = {
	/** Overrides a table's own catalog PK constraint name -- default `"<table>_pkey"` (the derived one, so no PK-name approximation fires unless a test asks for one). */
	readonly primaryKeyNames?: ReadonlyMap<string, string>;
	readonly foreignKeys?: ReadonlyArray<ForeignKeyFixture>;
};

/**
 * #712/R3: an enum type whose own catalog name is not a valid hejbro SQL
 * identifier is omitted, along with every column typed by it -- built
 * from a scenario's own tables/columns/enums, one independent fixture
 * per input-table row (D110), mirroring `infer-omitted-column-foreign-
 * keys.test.ts`'s own fake `DriverSession`.
 */
const buildSession = (
	tables: ReadonlyArray<TableFixture>,
	columns: ReadonlyArray<ColumnFixture>,
	enums: ReadonlyArray<EnumFixture>,
	options: BuildSessionOptions = {},
): DriverSession => {
	const positionByColumn = new Map<string, number>();
	const columnDetails = columns.map((column) => {
		const key = `${column.schema}.${column.table}`;
		const nextPosition = (positionByColumn.get(key) ?? 0) + 1;
		positionByColumn.set(key, nextPosition);
		return columnDetailRow(column, nextPosition);
	});

	const foreignKeys = options.foreignKeys ?? [];

	const checkFixtureRows: {
		readonly [K in CheckQueryKey]: ReadonlyArray<DriverRow>;
	} = {
		schemas: [...new Set(tables.map((table) => table.schema))].map(
			(schema) => ({ schema }),
		),
		tables: tables.map((table) => ({ ...table, rls: false })),
		columns: columns.map(columnRow),
		constraints: [
			...tables.map((table) => ({
				schema: table.schema,
				table: table.table,
				name:
					options.primaryKeyNames?.get(table.table) ?? `${table.table}_pkey`,
				type: "p" as const,
				columns: ["id"],
			})),
			...foreignKeys.map((fk) => ({
				schema: fk.schema,
				table: fk.table,
				name: fk.name,
				type: "f" as const,
				columns: fk.columns,
			})),
		],
		indexes: [],
		enums: enums.map((enumFixture) => ({
			schema: enumFixture.schema,
			name: enumFixture.name,
		})),
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
		foreignKeyDetails: foreignKeys.map((fk) => ({
			schema: fk.schema,
			table: fk.table,
			name: fk.name,
			targetSchema: fk.targetSchema,
			targetTable: fk.targetTable,
			targetColumns: fk.targetColumns,
			onDelete: "a",
			onUpdate: "a",
		})),
		checkExpressions: [],
		indexDetails: [],
		enumLabels: enums.flatMap(enumLabelRows),
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
	dir = mkdtempSync(join(__dirname, "_tmp-omitted-enum-"));
	return emitDeclarationFiles(result).map((file) => {
		const path = join(dir, `${file.fileBaseName}.schema.ts`);
		writeFileSync(path, file.source);
		return path;
	});
};

const enumIdentitiesIn = (result: InferCatalogResult): ReadonlySet<string> =>
	new Set(
		Object.keys(result.snapshot.objects)
			.filter((key) => key.startsWith("enum:"))
			.map((key) => key.slice("enum:".length)),
	);

const columnIdentitiesIn = (
	result: InferCatalogResult,
	tableIdentity: string,
): ReadonlySet<string> => {
	const node = result.snapshot.objects[`table:${tableIdentity}`] as
		| { readonly columns?: ReadonlyArray<{ readonly name: string }> }
		| undefined;
	return new Set((node?.columns ?? []).map((column) => column.name));
};

describe("inferFromCatalog / 712-R3: an enum type held to D36", () => {
	it("E1: an undeclarable-name enum and its own column are both omitted, an ordinary sibling enum and column survive, and the starter loads", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "tasks" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{
					schema: "app",
					table: "orders",
					name: "status",
					enumType: { schema: "app", name: "Status" },
				},
				{ schema: "app", table: "tasks", name: "id" },
				{
					schema: "app",
					table: "tasks",
					name: "status",
					enumType: { schema: "app", name: "status" },
				},
			],
			[
				{ schema: "app", name: "Status", labels: ["open", "closed"] },
				{ schema: "app", name: "status", labels: ["open", "closed"] },
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(enumIdentitiesIn(result).has("app.Status")).toBe(false);
		expect(enumIdentitiesIn(result).has("app.status")).toBe(true);
		expect(columnIdentitiesIn(result, "app.orders").has("status")).toBe(false);
		expect(columnIdentitiesIn(result, "app.tasks").has("status")).toBe(true);
		// The enum's own line, specifically, names the column it took with
		// it -- not merely "the column is gone from the snapshot" (which a
		// plain type loss would also satisfy, D2's forbidden double route).
		const enumLine = result.lossReport.find((line) =>
			line.includes('"app.Status"'),
		);
		if (enumLine === undefined) {
			throw new Error(
				`expected an "app.Status" enum-omission line:\n${result.lossReport.join("\n")}`,
			);
		}
		expect(enumLine).toContain('"app.orders.status"');
		expect(
			result.lossReport.some(
				(line) =>
					line.startsWith("Not inferred: column") &&
					line.includes("app.orders.status"),
			),
		).toBe(false);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("E2: an enum and a column typed by it in a different (also-read) schema are both omitted, and the line names the cross-schema column", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "widgets" },
				{ schema: "audit", table: "logs" },
			],
			[
				{ schema: "app", table: "widgets", name: "id" },
				{ schema: "audit", table: "logs", name: "id" },
				{
					schema: "audit",
					table: "logs",
					name: "kind",
					enumType: { schema: "app", name: "my-enum" },
				},
			],
			[{ schema: "app", name: "my-enum", labels: ["a", "b"] }],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app", "audit"],
			command: "import",
		});

		expect(enumIdentitiesIn(result).has("app.my-enum")).toBe(false);
		expect(columnIdentitiesIn(result, "audit.logs").has("kind")).toBe(false);
		// The cross-schema column must be named by the *enum's own* line
		// (not merely appear somewhere in the report, e.g. as an
		// unrelated type-loss line for a column this rule failed to
		// exclude before `inferTable` ever saw it).
		const enumLine = result.lossReport.find((line) =>
			line.includes('"app.my-enum"'),
		);
		if (enumLine === undefined) {
			throw new Error(
				`expected an "app.my-enum" enum-omission line:\n${result.lossReport.join("\n")}`,
			);
		}
		expect(enumLine).toContain('"audit.logs.kind"');
		expect(
			result.lossReport.some(
				(line) =>
					line.startsWith("Not inferred: column") &&
					line.includes("audit.logs.kind"),
			),
		).toBe(false);
	});

	it("E3: an undeclarable-name enum with no column typed by it is omitted with the no-columns line", async () => {
		const session = buildSession(
			[{ schema: "app", table: "widgets" }],
			[{ schema: "app", table: "widgets", name: "id" }],
			[{ schema: "app", name: "2nd", labels: ["a"] }],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(enumIdentitiesIn(result).has("app.2nd")).toBe(false);
		expect(
			result.lossReport.some(
				(line) =>
					line.includes('"app.2nd"') &&
					line.includes("No column is typed by it"),
			),
		).toBe(true);
	});

	it("E4: an enum name that round-trips but fails D36 is omitted the same as E1", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{
					schema: "app",
					table: "orders",
					name: "status",
					enumType: { schema: "app", name: "_x" },
				},
			],
			[{ schema: "app", name: "_x", labels: ["a", "b"] }],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(enumIdentitiesIn(result).has("app._x")).toBe(false);
		expect(columnIdentitiesIn(result, "app.orders").has("status")).toBe(false);
		const enumLine = result.lossReport.find((line) =>
			line.includes('"app._x"'),
		);
		if (enumLine === undefined) {
			throw new Error(
				`expected an "app._x" enum-omission line:\n${result.lossReport.join("\n")}`,
			);
		}
		expect(enumLine).toContain('"app.orders.status"');
		expect(
			result.lossReport.some(
				(line) =>
					line.startsWith("Not inferred: column") &&
					line.includes("app.orders.status"),
			),
		).toBe(false);
	});

	it("E5 (control): an ordinary enum and its column survive, with no enum-omission line", async () => {
		const session = buildSession(
			[{ schema: "app", table: "tasks" }],
			[
				{ schema: "app", table: "tasks", name: "id" },
				{
					schema: "app",
					table: "tasks",
					name: "status",
					enumType: { schema: "app", name: "status" },
				},
			],
			[{ schema: "app", name: "status", labels: ["open", "closed"] }],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(enumIdentitiesIn(result).has("app.status")).toBe(true);
		expect(columnIdentitiesIn(result, "app.tasks").has("status")).toBe(true);
		expect(result.lossReport.some((line) => line.includes("enum type"))).toBe(
			false,
		);
	});

	it("E6 (D2 boundary): a column whose own name is also undeclarable is reported only by its own line, never by the enum's", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{
					schema: "app",
					table: "orders",
					name: "Mood",
					enumType: { schema: "app", name: "Status2" },
				},
			],
			[{ schema: "app", name: "Status2", labels: ["a", "b"] }],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const enumLine = result.lossReport.find((line) =>
			line.includes('"app.Status2"'),
		);
		if (enumLine === undefined) {
			throw new Error(
				`expected an "app.Status2" enum-omission line:\n${result.lossReport.join("\n")}`,
			);
		}
		// The enum's own line never names "Mood" -- it has no column left to
		// take with it (D2: the column is already reported elsewhere).
		expect(enumLine.includes("Mood")).toBe(false);
		expect(enumLine.includes("No column is typed by it")).toBe(true);
		// "Mood"'s own undeclarable-name-column line names it instead.
		expect(
			result.lossReport.some(
				(line) =>
					line.includes('column "app.orders.Mood"') &&
					line.startsWith("Omitted: column"),
			),
		).toBe(true);
	});

	it("E7 (cross-cutting): a table carrying all five of this piece's own losses at once -- an enum-typed column's foreign key, a name-omitted column's foreign key, a non-derived primary key, and a surviving ordinary column and enum -- names every loss exactly once, on its own line", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "users" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{
					schema: "app",
					table: "orders",
					name: "status",
					enumType: { schema: "app", name: "Status" },
				},
				{
					schema: "app",
					table: "orders",
					name: "UserId",
				},
				{
					schema: "app",
					table: "orders",
					name: "state",
					enumType: { schema: "app", name: "status" },
				},
				{ schema: "app", table: "users", name: "id" },
			],
			[
				{ schema: "app", name: "Status", labels: ["open", "closed"] },
				{ schema: "app", name: "status", labels: ["open", "closed"] },
			],
			{
				primaryKeyNames: new Map([["orders", "pk_orders"]]),
				foreignKeys: [
					{
						schema: "app",
						table: "orders",
						name: "orders_status_fkey",
						columns: ["status"],
						targetSchema: "app",
						targetTable: "users",
						targetColumns: ["id"],
					},
					{
						schema: "app",
						table: "orders",
						name: "orders_userid_fkey",
						columns: ["UserId"],
						targetSchema: "app",
						targetTable: "users",
						targetColumns: ["id"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		// Pin ①: no crash, and the starter loads (#873's own repro).
		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);

		// Pin ②: the whole loss report, exactly -- order, presence, absence
		// and no duplicate announcement, all fixed in one assertion.
		expect(result.lossReport).toEqual([
			"Guessed: TypeScript keys from SQL names, the default numeric mode, and unknown array-element nullability (read as nullable).",
			"Not inferred: grants beyond their role name.",
			'Approximated: the primary key "app.orders.pk_orders" is declared under the derived name "orders_pkey" instead -- the DSL derives every primary-key name, so `generate`/`check` will name this constraint differently from the database. Rename the constraint to "orders_pkey" in the database; until you do, `check` reports the declared "orders_pkey" as missing on every run and lists "pk_orders" in its unmanaged-index inventory.',
			"Approximated: every default, check, generated, and index-predicate expression is carried as raw SQL text, not the typed builders a hand-written declaration would use.",
			'Omitted: enum type "app.Status" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it, and every column typed by it is left out with it: "app.orders.status". `check` keeps naming each of them as unmanaged until it is declared, and never names the type itself -- its inventory has no enum axis. Next: rename the type in the database, then re-run `hejbro import` into a fresh `--out` and merge the declarations, or declare them by hand.',
			'Omitted: foreign key "app.orders.orders_status_fkey" -- it is declared on column "app.orders.status", which this reading left out with the enum type "app.Status" that types it, so the key cannot be declared either. Next: rename the type in the database, then re-run `hejbro import` into a fresh `--out` and merge the declaration, or declare it by hand.',
			'Omitted: foreign key "app.orders.orders_userid_fkey" -- it is declared on column "app.orders.UserId", which this reading left out because no declaration can carry its name, so the key cannot be declared either. Next: rename the column in the database, then re-run `hejbro import` into a fresh `--out` and merge the declaration, or declare it by hand.',
			'Omitted: column "app.orders.UserId" -- no declaration key produces this SQL name back. The table "app.orders" is only partly declared, and `check` reports this column until it is renamed in the database and declared.',
			"The loss ends when you hand-edit the starter declarations.",
		]);
	});
});

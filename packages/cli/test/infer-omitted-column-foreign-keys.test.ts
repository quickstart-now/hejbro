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

type ColumnFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly notNull: boolean;
	readonly catalogType: string;
};

type ConstraintFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly type: "p" | "f";
	readonly columns: ReadonlyArray<string>;
};

type ForeignKeyDetailFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly targetSchema: string;
	readonly targetTable: string;
	readonly targetColumns: ReadonlyArray<string>;
};

/** `baseTypeName` (`pg_type.typname`) coincides with `catalogType` (`format_type` text) for every plain, unparameterized type this fixture uses (`uuid`, `text`) -- the two diverge only for parameterized/array/enum types, none of which this scenario needs. */
const columnRow = (column: ColumnFixture): DriverRow => ({
	schema: column.schema,
	table: column.table,
	name: column.name,
	notNull: column.notNull,
	catalogType: column.catalogType,
	baseTypeKind: null,
	baseTypeSchema: null,
	baseTypeName: column.catalogType,
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

const foreignKeyDetailRow = (fk: ForeignKeyDetailFixture): DriverRow => ({
	schema: fk.schema,
	table: fk.table,
	name: fk.name,
	targetSchema: fk.targetSchema,
	targetTable: fk.targetTable,
	targetColumns: fk.targetColumns,
	onDelete: "a",
	onUpdate: "a",
});

/**
 * #873: a foreign key referencing a column an undeclarable name omits
 * (either end) is still written into the starter declaration -- built
 * here from a scenario's own tables/columns/constraints/foreign-key
 * details, mirroring `infer-unique-on-omitted-table.test.ts`'s own fake
 * `DriverSession` (SQL-text dispatch against `CHECK_CATALOG_QUERIES`/
 * `INFER_CATALOG_QUERIES`), one independent fixture per input-table row
 * (D110) -- a crash on one row must never hide what the others observe.
 */
const buildSession = (
	tables: ReadonlyArray<{ readonly schema: string; readonly table: string }>,
	columns: ReadonlyArray<ColumnFixture>,
	constraints: ReadonlyArray<ConstraintFixture>,
	foreignKeyDetails: ReadonlyArray<ForeignKeyDetailFixture>,
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
		schemas: [{ schema: "app" }],
		tables: tables.map((table) => ({ ...table, rls: false })),
		columns: columns.map(columnRow),
		constraints: constraints.map((constraint) => ({ ...constraint })),
		indexes: [],
		enums: [],
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
		foreignKeyDetails: foreignKeyDetails.map(foreignKeyDetailRow),
		checkExpressions: [],
		indexDetails: [],
		enumLabels: [],
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

/** Writes every emitted file to a fresh directory, returning each file's absolute path. */
const writeFiles = (result: InferCatalogResult): ReadonlyArray<string> => {
	dir = mkdtempSync(join(__dirname, "_tmp-omitted-column-fk-"));
	return emitDeclarationFiles(result).map((file) => {
		const path = join(dir, `${file.fileBaseName}.schema.ts`);
		writeFileSync(path, file.source);
		return path;
	});
};

const foreignKeyNamesIn = (result: InferCatalogResult): ReadonlySet<string> =>
	new Set(
		Object.values(result.snapshot.objects).flatMap((node) => {
			const table = node as {
				readonly foreignKeys?: ReadonlyArray<{ readonly name: string }>;
			};
			return table.foreignKeys?.map((fk) => fk.name) ?? [];
		}),
	);

describe("inferFromCatalog / #873: a foreign key at an omitted column is itself omitted", () => {
	it("F1: a foreign key sourced from an undeclarable-name column is itself omitted, and the starter loads", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "users" },
			],
			[
				{
					schema: "app",
					table: "orders",
					name: "id",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "orders",
					name: "UserId",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "users",
					name: "id",
					notNull: true,
					catalogType: "uuid",
				},
			],
			[
				{
					schema: "app",
					table: "orders",
					name: "orders_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "orders",
					name: "orders_userid_fkey",
					type: "f",
					columns: ["UserId"],
				},
				{
					schema: "app",
					table: "users",
					name: "users_pkey",
					type: "p",
					columns: ["id"],
				},
			],
			[
				{
					schema: "app",
					table: "orders",
					name: "orders_userid_fkey",
					targetSchema: "app",
					targetTable: "users",
					targetColumns: ["id"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(foreignKeyNamesIn(result).has("orders_userid_fkey")).toBe(false);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("F2: a foreign key targeting an undeclarable-name column is itself omitted, and the starter loads", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "users" },
				{ schema: "app", table: "audits" },
			],
			[
				{
					schema: "app",
					table: "users",
					name: "id",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "users",
					name: "UserId",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "audits",
					name: "id",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "audits",
					name: "user_ref",
					notNull: true,
					catalogType: "uuid",
				},
			],
			[
				{
					schema: "app",
					table: "users",
					name: "users_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "audits",
					name: "audits_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "audits",
					name: "audits_user_ref_fkey",
					type: "f",
					columns: ["user_ref"],
				},
			],
			[
				{
					schema: "app",
					table: "audits",
					name: "audits_user_ref_fkey",
					targetSchema: "app",
					targetTable: "users",
					targetColumns: ["UserId"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(foreignKeyNamesIn(result).has("audits_user_ref_fkey")).toBe(false);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("F3 (control): an unrelated undeclarable column on the same table must not cost an ordinary foreign key", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "invoices" },
				{ schema: "app", table: "users" },
			],
			[
				{
					schema: "app",
					table: "invoices",
					name: "id",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "invoices",
					name: "OtherName",
					notNull: false,
					catalogType: "text",
				},
				{
					schema: "app",
					table: "invoices",
					name: "customer_id",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "users",
					name: "id",
					notNull: true,
					catalogType: "uuid",
				},
			],
			[
				{
					schema: "app",
					table: "invoices",
					name: "invoices_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "invoices",
					name: "invoices_customer_id_fkey",
					type: "f",
					columns: ["customer_id"],
				},
				{
					schema: "app",
					table: "users",
					name: "users_pkey",
					type: "p",
					columns: ["id"],
				},
			],
			[
				{
					schema: "app",
					table: "invoices",
					name: "invoices_customer_id_fkey",
					targetSchema: "app",
					targetTable: "users",
					targetColumns: ["id"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(foreignKeyNamesIn(result).has("invoices_customer_id_fkey")).toBe(
			true,
		);
	});

	it("F4: a foreign key targeting a table in a schema this run never read survives -- unread is not omitted", async () => {
		const session = buildSession(
			[{ schema: "app", table: "shipments" }],
			[
				{
					schema: "app",
					table: "shipments",
					name: "id",
					notNull: true,
					catalogType: "uuid",
				},
				{
					schema: "app",
					table: "shipments",
					name: "ext_customer_id",
					notNull: true,
					catalogType: "uuid",
				},
			],
			[
				{
					schema: "app",
					table: "shipments",
					name: "shipments_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "shipments",
					name: "shipments_ext_customer_id_fkey",
					type: "f",
					columns: ["ext_customer_id"],
				},
			],
			[
				{
					schema: "app",
					table: "shipments",
					name: "shipments_ext_customer_id_fkey",
					targetSchema: "ext",
					targetTable: "customers",
					targetColumns: ["id"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			foreignKeyNamesIn(result).has("shipments_ext_customer_id_fkey"),
		).toBe(true);
	});
});

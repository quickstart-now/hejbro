import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { CHECK_CATALOG_QUERIES } from "../src/check/catalog";
import { INFER_CATALOG_QUERIES } from "../src/infer/catalog";
import { inferFromCatalog } from "../src/infer/compose";

type CheckQueryKey = keyof typeof CHECK_CATALOG_QUERIES;
type InferQueryKey = keyof typeof INFER_CATALOG_QUERIES;

type ColumnFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
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

const columnRow = (column: ColumnFixture): DriverRow => ({
	schema: column.schema,
	table: column.table,
	name: column.name,
	notNull: true,
	catalogType: "uuid",
	baseTypeKind: null,
	baseTypeSchema: null,
	baseTypeName: "uuid",
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
 * #872/712-R7: a primary key whose catalog name is not the DSL's own
 * derived one (`"<table>_pkey"`) is announced as an approximation, named
 * by both names, with `check`'s own two-sided consequence (a failing
 * finding on the derived name, an informational inventory line on the
 * catalog's own) -- reproduced via the same fake `DriverSession`
 * `infer-unique-on-omitted-table.test.ts`/
 * `infer-omitted-column-foreign-keys.test.ts` use, one independent
 * fixture per input-table row (D110): a crash or false positive on one
 * row must never hide what the others observe.
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

const singleTablePkSession = (
	table: string,
	pkCatalogName: string,
): DriverSession =>
	buildSession(
		[{ schema: "app", table }],
		[{ schema: "app", table, name: "id" }],
		[{ schema: "app", table, name: pkCatalogName, type: "p", columns: ["id"] }],
		[],
	);

describe("inferFromCatalog / 712-R7: a dropped primary-key name is announced with the derived one", () => {
	it("G1: a non-derived primary-key name is announced, naming both the catalog and derived names, with check's two-sided consequence", async () => {
		const result = await inferFromCatalog({
			session: singleTablePkSession("orders", "pk_orders"),
			schemas: ["app"],
			command: "import",
		});

		expect(result.lossReport).toContain(
			'Approximated: the primary key "app.orders.pk_orders" is declared under the derived name "orders_pkey" instead -- the DSL derives every primary-key name, so `generate`/`check` will name this constraint differently from the database. Rename the constraint to "orders_pkey" in the database; until you do, `check` reports the declared "orders_pkey" as missing on every run and lists "pk_orders" in its unmanaged-index inventory.',
		);
	});

	it("G2: a primary-key name that already matches the derived one gets no line", async () => {
		const result = await inferFromCatalog({
			session: singleTablePkSession("invoices", "invoices_pkey"),
			schemas: ["app"],
			command: "import",
		});

		expect(result.lossReport.some((line) => line.includes("primary key"))).toBe(
			false,
		);
	});

	it("G3: a table with no primary key at all gets no line", async () => {
		const session = buildSession(
			[{ schema: "app", table: "widgets" }],
			[{ schema: "app", table: "widgets", name: "id" }],
			[],
			[],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(result.lossReport.some((line) => line.includes("primary key"))).toBe(
			false,
		);
	});

	it("G4 (control): an unrelated foreign-key-name approximation keeps its own wording, and a derived-name primary key on the same table gets no line", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "accounts" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "accounts", name: "id" },
				{ schema: "app", table: "accounts", name: "owner_id" },
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
					table: "accounts",
					name: "accounts_pkey",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "accounts",
					name: "Accounts_OwnerId_FK",
					type: "f",
					columns: ["owner_id"],
				},
			],
			[
				{
					schema: "app",
					table: "accounts",
					name: "Accounts_OwnerId_FK",
					targetSchema: "app",
					targetTable: "orders",
					targetColumns: ["id"],
				},
			],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		// The pre-existing foreign-key-name approximation line, in full --
		// this new primary-key line must never disturb its own wording.
		expect(result.lossReport).toContain(
			'Approximated: the foreign key "app.accounts.Accounts_OwnerId_FK" is declared under the derived name "accounts_owner_id_fk" instead -- its own catalog name is not a valid hejbro SQL identifier, so `generate`/`check` will name this constraint differently from the database.',
		);
		expect(result.lossReport.some((line) => line.includes("primary key"))).toBe(
			false,
		);
	});

	it("G5: two non-derived primary-key names are both announced, ordered by code point", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "legacy" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "legacy", name: "id" },
			],
			[
				{
					schema: "app",
					table: "orders",
					name: "pk_orders",
					type: "p",
					columns: ["id"],
				},
				{
					schema: "app",
					table: "legacy",
					name: "pk_legacy",
					type: "p",
					columns: ["id"],
				},
			],
			[],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const legacyLine =
			'Approximated: the primary key "app.legacy.pk_legacy" is declared under the derived name "legacy_pkey" instead -- the DSL derives every primary-key name, so `generate`/`check` will name this constraint differently from the database. Rename the constraint to "legacy_pkey" in the database; until you do, `check` reports the declared "legacy_pkey" as missing on every run and lists "pk_legacy" in its unmanaged-index inventory.';
		const ordersLine =
			'Approximated: the primary key "app.orders.pk_orders" is declared under the derived name "orders_pkey" instead -- the DSL derives every primary-key name, so `generate`/`check` will name this constraint differently from the database. Rename the constraint to "orders_pkey" in the database; until you do, `check` reports the declared "orders_pkey" as missing on every run and lists "pk_orders" in its unmanaged-index inventory.';

		expect(result.lossReport).toContain(legacyLine);
		expect(result.lossReport).toContain(ordersLine);
		expect(result.lossReport.indexOf(legacyLine)).toBeLessThan(
			result.lossReport.indexOf(ordersLine),
		);
	});
});

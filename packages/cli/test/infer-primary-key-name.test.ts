import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { CHECK_CATALOG_QUERIES } from "../src/check/catalog";
import { tablesInSnapshot } from "../src/contract/read-snapshot";
import { INFER_CATALOG_QUERIES } from "../src/infer/catalog";
import { inferFromCatalog } from "../src/infer/compose";

type CheckQueryKey = keyof typeof CHECK_CATALOG_QUERIES;
type InferQueryKey = keyof typeof INFER_CATALOG_QUERIES;

type ColumnFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	/** PP4 (712/R10 N#7): present when this column's type is an omitted enum, mirroring `infer-omitted-column-members.test.ts`'s own fixture. */
	readonly enumType?: { readonly schema: string; readonly name: string };
};

type EnumFixture = {
	readonly schema: string;
	readonly name: string;
	readonly labels: ReadonlyArray<string>;
};

type ConstraintFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly type: "p" | "f" | "u";
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

const catalogTypeFor = (column: ColumnFixture): string => {
	if (column.enumType === undefined) {
		return "uuid";
	}
	return `${column.enumType.schema}."${column.enumType.name}"`;
};

const baseTypeNameFor = (column: ColumnFixture): string => {
	if (column.enumType === undefined) {
		return "uuid";
	}
	return column.enumType.name;
};

const baseTypeKindFor = (column: ColumnFixture): string | null => {
	if (column.enumType === undefined) {
		return null;
	}
	return "e";
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

const enumLabelRows = (enumFixture: EnumFixture): ReadonlyArray<DriverRow> =>
	enumFixture.labels.map((label, index) => ({
		schema: enumFixture.schema,
		name: enumFixture.name,
		label,
		sortOrder: index + 1,
	}));

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
 * 712/R10 B#3, review round 2 LL1: a bare relation `derivedNameCollides`
 * must also see -- a sequence, a view or a plain index no constraint
 * backs, keyed by schema and name alone (`check/catalog.ts`'s own row
 * shapes for each).
 */
type ExtraCatalogFixtures = {
	readonly sequences?: ReadonlyArray<{
		readonly schema: string;
		readonly name: string;
	}>;
	readonly views?: ReadonlyArray<{
		readonly schema: string;
		readonly name: string;
	}>;
	readonly bareIndexes?: ReadonlyArray<{
		readonly schema: string;
		readonly table: string;
		readonly name: string;
	}>;
	readonly enums?: ReadonlyArray<EnumFixture>;
};

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
	extra: ExtraCatalogFixtures = {},
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
		constraints: constraints.map((constraint) => ({ ...constraint })),
		indexes: (extra.bareIndexes ?? []).map((index) => ({
			schema: index.schema,
			table: index.table,
			name: index.name,
			predicate: null,
			keys: [],
			constraintName: null,
		})),
		enums: (extra.enums ?? []).map((enumFixture) => ({
			schema: enumFixture.schema,
			name: enumFixture.name,
		})),
		sequences: (extra.sequences ?? []).map((row) => ({ ...row })),
		functions: [],
		views: (extra.views ?? []).map((row) => ({ ...row })),
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
		enumLabels: (extra.enums ?? []).flatMap(enumLabelRows),
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

	// 712/R10 B#3: the derived name a dropped primary-key name would move
	// to is already taken by another relation in the same schema -- the
	// rename the line proposes cannot actually be run yet.
	it("G6: the derived name collides with another relation in the same schema, so the line states it", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "archive" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "archive", name: "id" },
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
					table: "archive",
					name: "archive_pkey",
					type: "p",
					columns: ["id"],
				},
				// A UNIQUE constraint on an unrelated table already carries the
				// name "orders_pkey" -- deriving it for app.orders's own primary
				// key would collide with this constraint, not with anything the
				// declaration itself is about to create.
				{
					schema: "app",
					table: "archive",
					name: "orders_pkey",
					type: "u",
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

		expect(result.lossReport).toContain(
			'Approximated: the primary key "app.orders.pk_orders" is declared under the derived name "orders_pkey" instead -- the DSL derives every primary-key name, so `generate`/`check` will name this constraint differently from the database. Rename the constraint to "orders_pkey" in the database; that name is already taken by another relation in "app", so rename that one first. Until you do, `check` reports the declared "orders_pkey" as missing on every run and lists "pk_orders" in its unmanaged-index inventory.',
		);
	});

	it("G7 (control): no collision in the same schema keeps G1's own wording, unchanged", async () => {
		const result = await inferFromCatalog({
			session: singleTablePkSession("orders", "pk_orders"),
			schemas: ["app"],
			command: "import",
		});

		expect(result.lossReport).toContain(
			'Approximated: the primary key "app.orders.pk_orders" is declared under the derived name "orders_pkey" instead -- the DSL derives every primary-key name, so `generate`/`check` will name this constraint differently from the database. Rename the constraint to "orders_pkey" in the database; until you do, `check` reports the declared "orders_pkey" as missing on every run and lists "pk_orders" in its unmanaged-index inventory.',
		);
		expect(
			result.lossReport.some((line) => line.includes("rename that one first")),
		).toBe(false);
	});

	// Review round 2 LL1: the collision lookup used to check only an index
	// or a constraint -- a table, a sequence or a view already named the
	// derived name is the same `ERROR: relation … already exists` the
	// review's own live rename hit, and the old lookup stayed silent.
	it("G8: the derived name collides with a table in the same schema, so the line states it", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "orders_pkey" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders_pkey", name: "id" },
			],
			[
				{
					schema: "app",
					table: "orders",
					name: "pk_orders",
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

		expect(
			result.lossReport.some((line) => line.includes("rename that one first")),
		).toBe(true);
	});

	it("G9: the derived name collides with a sequence in the same schema, so the line states it", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[{ schema: "app", table: "orders", name: "id" }],
			[
				{
					schema: "app",
					table: "orders",
					name: "pk_orders",
					type: "p",
					columns: ["id"],
				},
			],
			[],
			{ sequences: [{ schema: "app", name: "orders_pkey" }] },
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			result.lossReport.some((line) => line.includes("rename that one first")),
		).toBe(true);
	});

	it("G10: the derived name collides with a view in the same schema, so the line states it", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[{ schema: "app", table: "orders", name: "id" }],
			[
				{
					schema: "app",
					table: "orders",
					name: "pk_orders",
					type: "p",
					columns: ["id"],
				},
			],
			[],
			{ views: [{ schema: "app", name: "orders_pkey" }] },
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			result.lossReport.some((line) => line.includes("rename that one first")),
		).toBe(true);
	});

	it("G11 (regression guard): the derived name still collides with a bare index no constraint backs", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "app", table: "archive" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "archive", name: "id" },
			],
			[
				{
					schema: "app",
					table: "orders",
					name: "pk_orders",
					type: "p",
					columns: ["id"],
				},
			],
			[],
			{
				bareIndexes: [{ schema: "app", table: "archive", name: "orders_pkey" }],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			result.lossReport.some((line) => line.includes("rename that one first")),
		).toBe(true);
	});

	it("G12 (control): a same-named relation in a different schema is not a collision", async () => {
		const session = buildSession(
			[
				{ schema: "app", table: "orders" },
				{ schema: "other", table: "orders_pkey" },
			],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "other", table: "orders_pkey", name: "id" },
			],
			[
				{
					schema: "app",
					table: "orders",
					name: "pk_orders",
					type: "p",
					columns: ["id"],
				},
			],
			[],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app", "other"],
			command: "import",
		});

		expect(
			result.lossReport.some((line) => line.includes("rename that one first")),
		).toBe(false);
	});
});

// Review round 2 N#7 (712/R10 execution): a primary key naming an
// omitted column stayed in the declarations as a *partial* key -- a
// different constraint than the catalog's own composite one -- so
// `baseline`'s SQL replayed the wrong primary key, silently. Excluded
// whole here instead: the table is declared with no primary key at all.
describe("inferFromCatalog / 712/R10 N#7: a primary key naming an omitted column is omitted whole", () => {
	it("Q1: a single-column primary key naming a name-omitted column is omitted whole", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t1" }],
			[{ schema: "app", table: "t1", name: "Weird" }],
			[
				{
					schema: "app",
					table: "t1",
					name: "t1_pkey",
					type: "p",
					columns: ["Weird"],
				},
			],
			[],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const table = tablesInSnapshot(result.snapshot).find(
			(node) => node.schema === "app" && node.name === "t1",
		);
		expect(table?.primaryKeyName).toBeUndefined();
		expect(result.lossReport).toContain(
			'Omitted: primary key "app.t1.t1_pkey" -- it names column "app.t1.Weird", which this reading left out because no declaration can carry its name, so the key cannot be declared either; the table is declared without a primary key. `check` keeps listing the index that backs it as unmanaged, naming "app.t1.t1_pkey", until that column and the key are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("Q2: a single-column primary key naming an enum-omitted column is omitted whole", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t2" }],
			[
				{
					schema: "app",
					table: "t2",
					name: "st",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[
				{
					schema: "app",
					table: "t2",
					name: "t2_pkey",
					type: "p",
					columns: ["st"],
				},
			],
			[],
			{
				enums: [{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const table = tablesInSnapshot(result.snapshot).find(
			(node) => node.schema === "app" && node.name === "t2",
		);
		expect(table?.primaryKeyName).toBeUndefined();
		expect(result.lossReport).toContain(
			'Omitted: primary key "app.t2.t2_pkey" -- it names column "app.t2.st", which this reading left out with the enum type "app.Status" that types it, so the key cannot be declared either; the table is declared without a primary key. `check` keeps listing the index that backs it as unmanaged, naming "app.t2.t2_pkey", until that column and the key are both declared. Next: rename the type in the database, then re-run `hejbro import`.',
		);
	});

	it("Q3: a composite primary key with one name-omitted member is omitted whole, keeping the surviving column", async () => {
		const session = buildSession(
			[{ schema: "app", table: "comp" }],
			[
				{ schema: "app", table: "comp", name: "id" },
				{ schema: "app", table: "comp", name: "Weird" },
			],
			[
				{
					schema: "app",
					table: "comp",
					name: "pk_comp",
					type: "p",
					columns: ["id", "Weird"],
				},
			],
			[],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const table = tablesInSnapshot(result.snapshot).find(
			(node) => node.schema === "app" && node.name === "comp",
		);
		expect(table?.primaryKeyName).toBeUndefined();
		expect(table?.columns.some((column) => column.name === "id")).toBe(true);
		expect(result.lossReport).toContain(
			'Omitted: primary key "app.comp.pk_comp" -- it names column "app.comp.Weird", which this reading left out because no declaration can carry its name, so the key cannot be declared either; the table is declared without a primary key. `check` keeps listing the index that backs it as unmanaged, naming "app.comp.pk_comp", until that column and the key are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("Q4: a composite primary key with one enum-omitted member is omitted whole, keeping the surviving column", async () => {
		const session = buildSession(
			[{ schema: "app", table: "comp2" }],
			[
				{ schema: "app", table: "comp2", name: "id" },
				{
					schema: "app",
					table: "comp2",
					name: "st",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[
				{
					schema: "app",
					table: "comp2",
					name: "pk_comp2",
					type: "p",
					columns: ["id", "st"],
				},
			],
			[],
			{
				enums: [{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		const table = tablesInSnapshot(result.snapshot).find(
			(node) => node.schema === "app" && node.name === "comp2",
		);
		expect(table?.primaryKeyName).toBeUndefined();
		expect(table?.columns.some((column) => column.name === "id")).toBe(true);
		expect(result.lossReport).toContain(
			'Omitted: primary key "app.comp2.pk_comp2" -- it names column "app.comp2.st", which this reading left out with the enum type "app.Status" that types it, so the key cannot be declared either; the table is declared without a primary key. `check` keeps listing the index that backs it as unmanaged, naming "app.comp2.pk_comp2", until that column and the key are both declared. Next: rename the type in the database, then re-run `hejbro import`.',
		);
	});

	it("Q5: a non-derived primary key naming an omitted member gets the omission line, never the name approximation", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t5" }],
			[
				{ schema: "app", table: "t5", name: "id" },
				{ schema: "app", table: "t5", name: "Weird" },
			],
			[
				{
					schema: "app",
					table: "t5",
					name: "pk_t5",
					type: "p",
					columns: ["id", "Weird"],
				},
			],
			[],
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			result.lossReport.some(
				(line) =>
					line.startsWith("Approximated: the primary key") &&
					line.includes("app.t5"),
			),
		).toBe(false);
		expect(
			result.lossReport.some(
				(line) =>
					line.startsWith("Omitted: primary key") && line.includes("app.t5"),
			),
		).toBe(true);
	});

	it("Q6 (control): a primary key whose every member survives is declared normally, with no omission line", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t6" }],
			[{ schema: "app", table: "t6", name: "id" }],
			[
				{
					schema: "app",
					table: "t6",
					name: "t6_pkey",
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

		const table = tablesInSnapshot(result.snapshot).find(
			(node) => node.schema === "app" && node.name === "t6",
		);
		expect(table?.primaryKeyName).toBe("t6_pkey");
		expect(
			result.lossReport.some((line) => line.startsWith("Omitted: primary key")),
		).toBe(false);
	});
});

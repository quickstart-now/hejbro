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

/** `pg_type.typname` -- the key `SIMPLE_TYPE_BUILDERS` looks a plain column's builder up by; an enum column's own base type is the enum's own name. */
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

type IndexFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	/** Bare column keys only (no expression elements) -- this piece's own rows never need one. */
	readonly columns: ReadonlyArray<string>;
	readonly isUnique?: boolean;
	/** The index's own partial predicate, raw SQL text (LL2, 712/R10 B#1). */
	readonly predicate?: string;
	/** Raw SQL text of any expression-only key elements (`column: null` in the catalog row) -- kept apart from `columns` since an expression element names no real column of its own. */
	readonly expressionKeys?: ReadonlyArray<string>;
	/**
	 * Every column this index depends on -- its key list plus any column
	 * its predicate or an expression key names, mirroring `pg_depend`'s
	 * own authoritative list (LL2, 712/R10 B#1: this fixture never runs
	 * real SQL, so it states directly what a live catalog would). Defaults
	 * to `columns` when omitted -- the shape every pre-LL2 row here still
	 * has.
	 */
	readonly referencedColumns?: ReadonlyArray<string>;
};

type CheckFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly expression: string;
	/** `pg_constraint.conkey`, decoded -- the columns this check actually depends on, independent of its own expression text (712/R10). */
	readonly columns: ReadonlyArray<string>;
};

type UniqueConstraintFixture = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
};

type BuildSessionOptions = {
	readonly primaryKeyNames?: ReadonlyMap<string, string>;
	readonly indexes?: ReadonlyArray<IndexFixture>;
	readonly checks?: ReadonlyArray<CheckFixture>;
	readonly uniqueConstraints?: ReadonlyArray<UniqueConstraintFixture>;
};

const indexDetailRow = (index: IndexFixture): DriverRow => ({
	schema: index.schema,
	table: index.table,
	name: index.name,
	isUnique: index.isUnique ?? false,
	method: "btree",
	predicate: index.predicate ?? null,
	columns: [
		...index.columns.map((column) => ({
			text: column,
			column,
			opclass: "",
			opclassIsDefault: true,
			descending: false,
			nullsFirst: false,
		})),
		...(index.expressionKeys ?? []).map((text) => ({
			text,
			column: null,
			opclass: "",
			opclassIsDefault: true,
			descending: false,
			nullsFirst: false,
		})),
	],
	referencedColumns: index.referencedColumns ?? index.columns,
});

/**
 * B#1 (live review, postgres 17.11): an index, check constraint or
 * UNIQUE constraint referencing a column this reading already omitted
 * (for its own name, or for the enum type that typed it) must be
 * omitted with it -- a surviving declaration must never name an object
 * the reading left out. Built from a scenario's own tables/columns/
 * enums/members, one independent fixture per input-table row (D110),
 * mirroring `infer-omitted-enum.test.ts`'s own fake `DriverSession`.
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

	const checks = options.checks ?? [];
	const uniqueConstraints = options.uniqueConstraints ?? [];
	const indexes = options.indexes ?? [];

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
			...uniqueConstraints.map((u) => ({
				schema: u.schema,
				table: u.table,
				name: u.name,
				type: "u" as const,
				columns: u.columns,
			})),
			...checks.map((c) => ({
				schema: c.schema,
				table: c.table,
				name: c.name,
				type: "c" as const,
				columns: c.columns,
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
		foreignKeyDetails: [],
		checkExpressions: checks.map((c) => ({
			schema: c.schema,
			table: c.table,
			name: c.name,
			expression: c.expression,
		})),
		indexDetails: indexes.map(indexDetailRow),
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
	dir = mkdtempSync(join(__dirname, "_tmp-omitted-column-members-"));
	return emitDeclarationFiles(result).map((file) => {
		const path = join(dir, `${file.fileBaseName}.schema.ts`);
		writeFileSync(path, file.source);
		return path;
	});
};

const indexNamesIn = (
	result: InferCatalogResult,
	tableIdentity: string,
): ReadonlySet<string> => {
	const node = result.snapshot.objects[`table:${tableIdentity}`] as
		| { readonly indexes?: ReadonlyArray<{ readonly name: string }> }
		| undefined;
	return new Set((node?.indexes ?? []).map((index) => index.name));
};

const checkNamesIn = (
	result: InferCatalogResult,
	tableIdentity: string,
): ReadonlySet<string> => {
	const node = result.snapshot.objects[`table:${tableIdentity}`] as
		| { readonly checks?: ReadonlyArray<{ readonly name: string }> }
		| undefined;
	return new Set((node?.checks ?? []).map((c) => c.name));
};

describe("inferFromCatalog / B#1: an index, check or UNIQUE at an omitted column is itself omitted", () => {
	it("J1: an index on an enum-omitted column is left out of the declaration", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t2" }],
			[
				{ schema: "app", table: "t2", name: "id" },
				{
					schema: "app",
					table: "t2",
					name: "state2",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			{
				indexes: [
					{
						schema: "app",
						table: "t2",
						name: "t2_state2_idx",
						columns: ["state2"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(indexNamesIn(result, "app.t2").has("t2_state2_idx")).toBe(false);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("J2: a check constraint referencing an enum-omitted column is left out of the declaration", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t2" }],
			[
				{ schema: "app", table: "t2", name: "id" },
				{
					schema: "app",
					table: "t2",
					name: "state2",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			{
				checks: [
					{
						schema: "app",
						table: "t2",
						name: "t2_state_chk",
						expression: "state2 is not null or id > 0",
						columns: ["state2", "id"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(checkNamesIn(result, "app.t2").has("t2_state_chk")).toBe(false);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("J3: a UNIQUE constraint on an enum-omitted column is left out, and announces no approximation for it", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t3" }],
			[
				{ schema: "app", table: "t3", name: "id" },
				{
					schema: "app",
					table: "t3",
					name: "st",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			{
				uniqueConstraints: [
					{ schema: "app", table: "t3", name: "t3_st_key", columns: ["st"] },
				],
				indexes: [
					{
						schema: "app",
						table: "t3",
						name: "t3_st_key",
						columns: ["st"],
						isUnique: true,
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(indexNamesIn(result, "app.t3").has("t3_st_key")).toBe(false);
		// KK5 (712/R10 B#1): the omission itself is now announced (an
		// "Omitted: unique constraint …" line, naming the object and its
		// cause) -- what must never appear is the old "Approximated: the
		// UNIQUE constraint … is inferred as a unique index" line, which
		// the delta forbids for anything the reading omitted outright.
		expect(
			result.lossReport.some(
				(line) =>
					line.startsWith("Approximated:") && line.includes("t3_st_key"),
			),
		).toBe(false);
		expect(
			result.lossReport.some(
				(line) => line.startsWith("Omitted:") && line.includes("t3_st_key"),
			),
		).toBe(true);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("J4: an index and a check on a name-omitted column are both left out of the declaration", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders", name: "UserId" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "orders",
						name: "orders_userid_idx",
						columns: ["UserId"],
					},
				],
				checks: [
					{
						schema: "app",
						table: "orders",
						name: "orders_userid_chk",
						expression: '"UserId" is not null',
						columns: ["UserId"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(indexNamesIn(result, "app.orders").has("orders_userid_idx")).toBe(
			false,
		);
		expect(checkNamesIn(result, "app.orders").has("orders_userid_chk")).toBe(
			false,
		);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("J5 (control): an index and a check naming only surviving columns are kept", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders", name: "amount" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "orders",
						name: "orders_amount_idx",
						columns: ["amount"],
					},
				],
				checks: [
					{
						schema: "app",
						table: "orders",
						name: "orders_amount_chk",
						expression: "amount > 0",
						columns: ["amount"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(indexNamesIn(result, "app.orders").has("orders_amount_idx")).toBe(
			true,
		);
		expect(checkNamesIn(result, "app.orders").has("orders_amount_chk")).toBe(
			true,
		);
	});

	it("J6: a composite index with only one key on an omitted column is dropped whole", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders", name: "amount" },
				{ schema: "app", table: "orders", name: "UserId" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "orders",
						name: "orders_amount_userid_idx",
						columns: ["amount", "UserId"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			indexNamesIn(result, "app.orders").has("orders_amount_userid_idx"),
		).toBe(false);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("J7: the migration SQL that creates this reading's own snapshot never names an omitted column, however the index or check reaches it (key, predicate or expression -- the review's own replay failure, fixed at the source)", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t2" }],
			[
				{ schema: "app", table: "t2", name: "id" },
				{
					schema: "app",
					table: "t2",
					name: "state2",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			{
				indexes: [
					{
						schema: "app",
						table: "t2",
						name: "t2_state2_idx",
						columns: ["state2"],
					},
					// LL3: widens this test's own input to the predicate/
					// expression axes LL2 adds, matching its title's universal
					// claim ("never names an omitted column", not only via a key).
					{
						schema: "app",
						table: "t2",
						name: "t2_id_partial_state2_idx",
						columns: ["id"],
						predicate: "state2 is not null",
						referencedColumns: ["id", "state2"],
					},
					{
						schema: "app",
						table: "t2",
						name: "t2_lower_state2_idx",
						columns: [],
						expressionKeys: ["lower(state2::text)"],
						referencedColumns: ["state2"],
					},
				],
				checks: [
					{
						schema: "app",
						table: "t2",
						name: "t2_state_chk",
						expression: "state2 is not null or id > 0",
						columns: ["state2", "id"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(result.sql).not.toContain("state2");
		expect(result.sql).not.toContain("t2_state2_idx");
		expect(result.sql).not.toContain("t2_id_partial_state2_idx");
		expect(result.sql).not.toContain("t2_lower_state2_idx");
		expect(result.sql).not.toContain("t2_state_chk");
	});

	// 712/R10: the false positive a text match would make -- a check
	// constraint's own expression reads the *same bare text* as an
	// omitted column's own name, but names a different column entirely
	// (`kind = 'state2'` is a string literal, not a reference to
	// `state2`). `pg_constraint.conkey` (this fixture's own `columns`)
	// is the authoritative list a text match would have gotten wrong.
	it("J8 (false-positive control): a check whose expression reads an omitted column's own name as a string literal, without referencing it, is kept", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t2" }],
			[
				{ schema: "app", table: "t2", name: "id" },
				{ schema: "app", table: "t2", name: "kind" },
				{
					schema: "app",
					table: "t2",
					name: "state2",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			{
				checks: [
					{
						schema: "app",
						table: "t2",
						name: "t2_kind_chk",
						expression: "kind = 'state2'",
						columns: ["kind"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(checkNamesIn(result, "app.t2").has("t2_kind_chk")).toBe(true);
	});

	// Review round 2 LL2: the exclusion used to scan only an index's own
	// key list, never a partial predicate or an expression key's own
	// text -- the review's own live replay found each of these still
	// left in the declaration, replaying against an empty database with
	// `column "…" does not exist`. Row labels (m_i5/m_i6/m_i10/m_i12)
	// match the review's own reproduction database.
	it("m_i5: a partial index whose predicate names a name-omitted column is dropped whole, even though its own key survives", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders", name: "amount" },
				{ schema: "app", table: "orders", name: "UserId" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "orders",
						name: "orders_amount_partial_idx",
						columns: ["amount"],
						predicate: '"UserId" is not null',
						referencedColumns: ["amount", "UserId"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			indexNamesIn(result, "app.orders").has("orders_amount_partial_idx"),
		).toBe(false);
		// MM3 (lead-approved wording): a column found only through the
		// predicate is not "declared on" the index the way a key column is.
		expect(result.lossReport).toContain(
			'Omitted: index "app.orders.orders_amount_partial_idx" -- its predicate names column "app.orders.UserId", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("m_i6: an expression index whose expression names a name-omitted column is dropped", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders", name: "UserId" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "orders",
						name: "orders_lower_userid_idx",
						columns: [],
						expressionKeys: ['lower("UserId")'],
						referencedColumns: ["UserId"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			indexNamesIn(result, "app.orders").has("orders_lower_userid_idx"),
		).toBe(false);
		// MM3: a column found only through an expression key -- the same
		// wording a check constraint's own expression already uses.
		expect(result.lossReport).toContain(
			'Omitted: index "app.orders.orders_lower_userid_idx" -- its expression names column "app.orders.UserId", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("m_i10: a partial index whose predicate names an enum-omitted column is dropped whole, even though its own key survives", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t2" }],
			[
				{ schema: "app", table: "t2", name: "id" },
				{
					schema: "app",
					table: "t2",
					name: "state2",
					enumType: { schema: "app", name: "Status" },
				},
			],
			[{ schema: "app", name: "Status", labels: ["open", "closed"] }],
			{
				indexes: [
					{
						schema: "app",
						table: "t2",
						name: "t2_id_partial_state2_idx",
						columns: ["id"],
						predicate: "state2 is not null",
						referencedColumns: ["id", "state2"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(indexNamesIn(result, "app.t2").has("t2_id_partial_state2_idx")).toBe(
			false,
		);
		expect(result.lossReport).toContain(
			'Omitted: index "app.t2.t2_id_partial_state2_idx" -- its predicate names column "app.t2.state2", which this reading left out with the enum type "app.Status" that types it, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the type in the database, then re-run `hejbro import`.',
		);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	// A column that loses the TypeScript-key collision it shares with
	// another (spec: "Two SQL names that collide on one key are both
	// described") is a name-omitted column the same way an exotic SQL
	// name is -- this row (m_i12) is that same predicate axis, on that
	// cause.
	it("m_i12: a partial index whose predicate names a key-collision-omitted column is dropped whole", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t4" }],
			[
				{ schema: "app", table: "t4", name: "id" },
				{ schema: "app", table: "t4", name: "user_id" },
				{ schema: "app", table: "t4", name: "USER_ID" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "t4",
						name: "t4_id_partial_useridcol_idx",
						columns: ["id"],
						predicate: '"USER_ID" is not null',
						referencedColumns: ["id", "USER_ID"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			indexNamesIn(result, "app.t4").has("t4_id_partial_useridcol_idx"),
		).toBe(false);
		expect(result.lossReport).toContain(
			'Omitted: index "app.t4.t4_id_partial_useridcol_idx" -- its predicate names column "app.t4.USER_ID", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);

		const paths = writeFiles(result);
		await Promise.all(
			paths.map((path) => expect(importAsEntry(path)).resolves.toBeDefined()),
		);
	});

	it("m_i5 control: a partial index whose predicate names only surviving columns is kept", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders", name: "amount" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "orders",
						name: "orders_amount_active_idx",
						columns: ["amount"],
						predicate: "amount > 0",
						referencedColumns: ["amount"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			indexNamesIn(result, "app.orders").has("orders_amount_active_idx"),
		).toBe(true);
	});

	// The same false-positive control J8 makes for a check, on a partial
	// index's own predicate: `pg_depend` (this fixture's own
	// `referencedColumns`) never names a string literal, so a predicate
	// that merely reads an omitted column's own name as text is kept.
	it("m_i5 control (false positive): a partial index whose predicate reads an omitted column's own name as a string literal is kept", async () => {
		const session = buildSession(
			[{ schema: "app", table: "orders" }],
			[
				{ schema: "app", table: "orders", name: "id" },
				{ schema: "app", table: "orders", name: "kind" },
				{ schema: "app", table: "orders", name: "UserId" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "orders",
						name: "orders_kind_literal_idx",
						columns: ["kind"],
						predicate: "kind = 'UserId'",
						referencedColumns: ["kind"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(
			indexNamesIn(result, "app.orders").has("orders_kind_literal_idx"),
		).toBe(true);
	});

	// Review round 2 NN2: an index carrying both an expression key and a
	// predicate at once -- `pg_depend` never tags which of the two
	// clauses actually names a given referenced column, so when the
	// offending column is neither's key, the line must name both
	// clauses rather than guess one (712/R8's own B#2 guard against
	// misattributing a cause, carried to which clause is named).
	it("P1: an index with both an expression and a predicate, offending column on the expression side, names both clauses", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t5" }],
			[
				{ schema: "app", table: "t5", name: "id" },
				{ schema: "app", table: "t5", name: "A" },
				{ schema: "app", table: "t5", name: "B" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "t5",
						name: "t5_expr_pred_idx",
						columns: [],
						expressionKeys: ['lower("A")'],
						predicate: '"B" is not null',
						referencedColumns: ["A", "B"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(indexNamesIn(result, "app.t5").has("t5_expr_pred_idx")).toBe(false);
		expect(result.lossReport).toContain(
			'Omitted: index "app.t5.t5_expr_pred_idx" -- its expression or predicate names column "app.t5.A", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("P2: an index with both an expression and a predicate, offending column on the predicate side, names both clauses", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t5" }],
			[
				{ schema: "app", table: "t5", name: "id" },
				{ schema: "app", table: "t5", name: "keep" },
				{ schema: "app", table: "t5", name: "B" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "t5",
						name: "t5_expr_pred2_idx",
						columns: [],
						expressionKeys: ["lower(keep)"],
						predicate: '"B" is not null',
						referencedColumns: ["keep", "B"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(indexNamesIn(result, "app.t5").has("t5_expr_pred2_idx")).toBe(false);
		expect(result.lossReport).toContain(
			'Omitted: index "app.t5.t5_expr_pred2_idx" -- its expression or predicate names column "app.t5.B", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("P3 (control): an index with an expression but no predicate keeps the expression-only wording", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t5" }],
			[
				{ schema: "app", table: "t5", name: "id" },
				{ schema: "app", table: "t5", name: "A" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "t5",
						name: "t5_expr_only_idx",
						columns: [],
						expressionKeys: ['lower("A")'],
						referencedColumns: ["A"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(result.lossReport).toContain(
			'Omitted: index "app.t5.t5_expr_only_idx" -- its expression names column "app.t5.A", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("P4 (control): an index with a predicate but no expression keeps the predicate-only wording", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t5" }],
			[
				{ schema: "app", table: "t5", name: "id" },
				{ schema: "app", table: "t5", name: "keep" },
				{ schema: "app", table: "t5", name: "B" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "t5",
						name: "t5_pred_only_idx",
						columns: ["keep"],
						predicate: '"B" is not null',
						referencedColumns: ["keep", "B"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(result.lossReport).toContain(
			'Omitted: index "app.t5.t5_pred_only_idx" -- its predicate names column "app.t5.B", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});

	it("P5 (control): the plain key case keeps its own wording, unaffected by the new synthesis clause", async () => {
		const session = buildSession(
			[{ schema: "app", table: "t5" }],
			[
				{ schema: "app", table: "t5", name: "id" },
				{ schema: "app", table: "t5", name: "A" },
			],
			[],
			{
				indexes: [
					{
						schema: "app",
						table: "t5",
						name: "t5_key_idx",
						columns: ["A"],
						referencedColumns: ["A"],
					},
				],
			},
		);

		const result = await inferFromCatalog({
			session,
			schemas: ["app"],
			command: "import",
		});

		expect(result.lossReport).toContain(
			'Omitted: index "app.t5.t5_key_idx" -- it is declared on column "app.t5.A", which this reading left out because no declaration can carry its name, so the index cannot be declared either. `check` keeps listing the index as unmanaged until that column and the index are both declared. Next: rename the column in the database, then re-run `hejbro import`.',
		);
	});
});

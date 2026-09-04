import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { CHECK_CATALOG_QUERIES } from "../src/check/catalog";
import { INFER_CATALOG_QUERIES } from "../src/infer/catalog";
import { inferFromCatalog } from "../src/infer/compose";

type CheckQueryKey = keyof typeof CHECK_CATALOG_QUERIES;
type InferQueryKey = keyof typeof INFER_CATALOG_QUERIES;

/**
 * D106 R5-N3(measurement)/#711: another team's live measurement on dev
 * (`8d096cab`, the built CLI) found that a `UNIQUE` constraint on a
 * table whose own catalog name is not a valid hejbro SQL identifier
 * (`shop."Widgets"`) made the whole `import` reading abort with
 * `error[invalid-sql-name]: Widgets`, exit 1 -- the same table with no
 * `UNIQUE` constraint is omitted cleanly. R5-N2 was disposed as
 * NON-BLOCKING on the assumption this was a *wrong approximation line*,
 * not an abort; this fixture reproduces the real live shape (no
 * Docker, the same fake single-connection `DriverSession` `readCatalog`/
 * `readInferenceCatalog`'s own unit tests use) to settle what this
 * branch's fix actually does about it.
 */
const CHECK_FIXTURE_ROWS: {
	readonly [K in CheckQueryKey]: ReadonlyArray<DriverRow>;
} = {
	schemas: [{ schema: "shop" }],
	tables: [{ schema: "shop", table: "Widgets", rls: false }],
	columns: [
		{
			schema: "shop",
			table: "Widgets",
			name: "id",
			notNull: true,
			catalogType: "uuid",
			baseTypeKind: null,
			baseTypeSchema: null,
			baseTypeName: null,
			catalogDefault: null,
			catalogGenerated: null,
		},
	],
	constraints: [
		{
			schema: "shop",
			table: "Widgets",
			name: "widgets_id_key",
			type: "u",
			columns: ["id"],
		},
	],
	indexes: [
		{
			schema: "shop",
			table: "Widgets",
			name: "widgets_id_key",
			predicate: null,
			keys: [],
		},
	],
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

const INFER_FIXTURE_ROWS: {
	readonly [K in InferQueryKey]: ReadonlyArray<DriverRow>;
} = {
	columnDetails: [
		{
			schema: "shop",
			table: "Widgets",
			name: "id",
			position: 1,
			identityKind: "",
			generatedKind: "",
		},
	],
	foreignKeyDetails: [],
	checkExpressions: [],
	indexDetails: [
		{
			schema: "shop",
			table: "Widgets",
			name: "widgets_id_key",
			isUnique: true,
			method: "btree",
			predicate: null,
			columns: [
				{
					text: "id",
					column: "id",
					opclass: "uuid_ops",
					opclassIsDefault: true,
					descending: false,
					nullsFirst: false,
				},
			],
		},
	],
	enumLabels: [],
	sequenceOwnership: [],
};

/** Dispatches by exact SQL text against both `readCatalog`'s and `readInferenceCatalog`'s own query tables -- `inferFromCatalog` runs both reads concurrently over one session (`Promise.all`). */
const makeFakeSession = (): DriverSession => ({
	execute: async (compiled: CompileResult) => {
		const checkEntry = (
			Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
				[CheckQueryKey, string]
			>
		).find(([, sql]) => sql === compiled.sql);
		if (checkEntry !== undefined) {
			return CHECK_FIXTURE_ROWS[checkEntry[0]];
		}
		const inferEntry = (
			Object.entries(INFER_CATALOG_QUERIES) as ReadonlyArray<
				[InferQueryKey, string]
			>
		).find(([, sql]) => sql === compiled.sql);
		if (inferEntry !== undefined) {
			return INFER_FIXTURE_ROWS[inferEntry[0]];
		}
		throw new Error(
			`unexpected query sent to inferFromCatalog: ${compiled.sql}`,
		);
	},
});

describe("inferFromCatalog / D106 R5-N2 measurement (#711)", () => {
	it("does not abort on a UNIQUE constraint over an omitted table, names only the omission", async () => {
		const result = await inferFromCatalog({
			session: makeFakeSession(),
			schemas: ["shop"],
			command: "import",
		});

		// Pin ①: no abort -- reaching this line at all is the assertion;
		// a thrown `invalid-sql-name` would fail the test before it does.
		expect(result.omittedSchemaNames).toEqual([]);

		// Pin ②: no UNIQUE-constraint approximation line for the omitted
		// table -- it would name the same object the next line says was
		// never inferred. (The blanket expression-approximation line is
		// unconditional and unrelated to this table; it is not what this
		// pin is about.)
		expect(
			result.lossReport.some((line) =>
				line.includes('Approximated: the UNIQUE constraint "shop.Widgets'),
			),
		).toBe(false);

		// Pin ③: the omission itself is the only thing named.
		expect(
			result.lossReport.some((line) =>
				line.includes('Omitted: table "shop.Widgets"'),
			),
		).toBe(true);
	});
});

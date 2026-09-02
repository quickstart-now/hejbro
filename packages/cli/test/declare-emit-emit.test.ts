import type { Snapshot, TableSnapshot } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { emitDeclarationFiles } from "../src/declare-emit/emit";
import type { InferCatalogResult } from "../src/infer/compose";

const widgetsTable: TableSnapshot = {
	schema: "app",
	name: "widgets",
	columns: [
		{
			name: "id",
			typeNode: { typeName: "uuid" },
			notNull: true,
			primaryKey: true,
		},
		{ name: "label", typeNode: { typeName: "text" }, notNull: true },
	],
	indexes: [],
	foreignKeys: [],
	primaryKeyName: "widgets_pkey",
};

const snapshotWith = (tables: ReadonlyArray<TableSnapshot>): Snapshot => ({
	formatVersion: 8,
	dialect: "postgres",
	objects: Object.fromEntries(
		tables.map((table) => [`table:${table.schema}.${table.name}`, table]),
	),
});

const resultFor = (
	tables: ReadonlyArray<TableSnapshot>,
): InferCatalogResult => ({
	snapshot: snapshotWith(tables),
	description: {
		tables: tables.map((table) => ({
			schema: table.schema,
			table: table.name,
			columns: table.columns.map((column) => ({
				sqlName: column.name,
				tsKey: column.name,
			})),
		})),
		roleNames: [],
	},
	lossReport: [],
});

describe("emitDeclarationFiles / 2.1", () => {
	it("emits one file for one schema, importing only the symbols it uses", () => {
		const files = emitDeclarationFiles(resultFor([widgetsTable]));

		expect(files).toHaveLength(1);
		const [file] = files;
		if (file === undefined) {
			throw new Error("expected one file");
		}
		expect(file.schema).toBe("app");
		expect(file.fileBaseName).toBe("app");
		expect(file.source).toContain(
			'import { schema, table, text, uuid } from "hejbro";',
		);
		expect(file.source).toContain('export const app = schema("app");');
		expect(file.source).toContain("export const widgets = table(");
		expect(file.source).toContain("id: uuid().notNull().primaryKey(),");
		expect(file.source).toContain("label: text().notNull(),");
		// no engine symbol ever appears in a generated import (#471).
		expect(file.source).not.toContain("generateMigration");
		expect(file.source).not.toContain("buildSnapshot");
	});

	it("names a table `check` without shadowing the imported `check` function (CI-G2-R1-06 Q2)", () => {
		const checkTable: TableSnapshot = {
			schema: "app",
			name: "check",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			checks: [
				{
					name: "check_id_not_null",
					expression: { nodeKind: "raw-sql", sql: "id is not null" },
				},
			],
			primaryKeyName: "check_pkey",
		};
		const files = emitDeclarationFiles(resultFor([checkTable]));
		const [file] = files;
		if (file === undefined) {
			throw new Error("expected one file");
		}
		// the table's own identifier must be suffixed (bare `check` is the
		// imported function) -- and the import line still names `check`
		// exactly once, for the function, not the table.
		expect(file.source).toContain("export const check2 = table(");
		expect(file.source).not.toContain("export const check = table(");
		const importLine = file.source
			.split("\n")
			.find(
				(line) => line.startsWith("import { ") && line.includes('"hejbro"'),
			);
		expect(importLine).toBeDefined();
		expect((importLine ?? "").match(/\bcheck\b/g)).toHaveLength(1);
	});

	it("is deterministic: a reversed table order produces the same file text (CI-G2-R1-05)", () => {
		const a: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "a_pkey",
		};
		const b: TableSnapshot = {
			schema: "app",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
			],
			indexes: [],
			foreignKeys: [],
			primaryKeyName: "b_pkey",
		};
		const forward = emitDeclarationFiles(resultFor([a, b]));
		const reversed = emitDeclarationFiles(resultFor([b, a]));
		expect(forward).toEqual(reversed);
	});

	it('is deterministic: the same input run twice emits byte-identical files (cli-commands delta: "a second import writes the same bytes")', () => {
		const result = resultFor([widgetsTable]);
		const first = emitDeclarationFiles(result);
		const second = emitDeclarationFiles(result);
		expect(first).toEqual(second);
	});

	it("wires a foreign key that crosses schemas as a real cross-file named import, and closes the cross-schema cycle on exactly one edge (CI-G2-R1-06 Q3)", () => {
		const appA: TableSnapshot = {
			schema: "app",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "b_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "a_b_id_fkey",
					columns: ["b_id"],
					referencesTable: "billing.b",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "a_pkey",
		};
		const billingB: TableSnapshot = {
			schema: "billing",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "a_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "b_a_id_fkey",
					columns: ["a_id"],
					referencesTable: "app.a",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "b_pkey",
		};

		const files = emitDeclarationFiles(resultFor([appA, billingB]));
		expect(files).toHaveLength(2);
		const appFile = files.find((file) => file.schema === "app");
		const billingFile = files.find((file) => file.schema === "billing");
		if (appFile === undefined || billingFile === undefined) {
			throw new Error("expected one file per schema");
		}

		// visiting starts at "app.a" (identity order): app.a -> billing.b is
		// followed first, so billing.b -> app.a is the edge that closes the
		// cycle -- table `b`'s own FK becomes the column-level thunk, and
		// table `a`'s FK to `b` stays a normal cross-file extras reference.
		expect(appFile.source).toContain('import { b } from "./billing.schema";');
		expect(appFile.source).toContain(
			"references: { table: b, columns: [b.id] }",
		);
		expect(appFile.source).not.toContain(".references(() =>");

		expect(billingFile.source).toContain('import { a } from "./app.schema";');
		expect(billingFile.source).toContain(".references(() => a.id)");
		expect(billingFile.source).not.toContain("foreignKeys:");
	});
});

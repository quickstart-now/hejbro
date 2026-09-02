import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot, TableSnapshot } from "@hejbro/core";
import { createJiti } from "jiti";
import { afterEach, describe, expect, it } from "vitest";
import { emitDeclarationFiles } from "../src/declare-emit/emit";
import type { InferCatalogResult } from "../src/infer/compose";

/**
 * D106 B1 (CI-D106-R2-02): the schema-graph fix only proves anything if the
 * files it emits actually *load* through a real ESM/CJS module graph in
 * both possible entry orders -- a rendered-source-text assertion alone
 * (`declare-emit-emit.test.ts`'s own style) can't observe a live import
 * cycle, which is exactly what crashed before this round (Group 2's own
 * measured `ReferenceError`/TDZ crashes on the FK side). Every file here
 * is written to a real directory inside this package (not `os.tmpdir()`)
 * so `@hejbro/core`/`hejbro`'s own node_modules resolution finds this
 * workspace's real packages, and loaded with the same `jiti` the
 * production loader (`src/loader.ts`) itself uses.
 */

type EnumFactLike = {
	readonly schema: string;
	readonly name: string;
	readonly values: ReadonlyArray<string>;
};

const snapshotWith = (
	tables: ReadonlyArray<TableSnapshot>,
	enumFacts: ReadonlyArray<EnumFactLike>,
): Snapshot => ({
	formatVersion: 8,
	dialect: "postgres",
	objects: Object.fromEntries([
		...tables.map(
			(table) => [`table:${table.schema}.${table.name}`, table] as const,
		),
		...enumFacts.map((row) => [`enum:${row.schema}.${row.name}`, row] as const),
	]),
});

const resultFor = (
	tables: ReadonlyArray<TableSnapshot>,
	enumFacts: ReadonlyArray<EnumFactLike>,
): InferCatalogResult => ({
	snapshot: snapshotWith(tables, enumFacts),
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
	sql: "",
});

let dir = "";

afterEach(() => {
	if (dir !== "") {
		rmSync(dir, { recursive: true, force: true });
		dir = "";
	}
});

/** Writes every emitted file to a fresh directory inside this package, returning each file's absolute path by schema name. */
const writeFiles = (
	result: InferCatalogResult,
): ReadonlyMap<string, string> => {
	dir = mkdtempSync(join(__dirname, "_tmp-enum-cycle-load-"));
	const files = emitDeclarationFiles(result);
	return new Map(
		files.map((file) => {
			const path = join(dir, `${file.fileBaseName}.schema.ts`);
			writeFileSync(path, file.source);
			return [file.schema, path] as const;
		}),
	);
};

const importAsEntry = async (path: string): Promise<unknown> => {
	const jiti = createJiti(path, { fsCache: false });
	return jiti.import(path);
};

describe("emitDeclarationFiles / D106 B1 (CI-D106-R2-02): the reviewer's own fixture actually loads, in both entry orders", () => {
	/** `evaluation.md`'s own repro: `app.users.kind` types against `audit.event_kind` (enum crossing, app -> audit), `audit.logs.user_id` references `app.users` (FK crossing, audit -> app). */
	const usersTable: TableSnapshot = {
		schema: "app",
		name: "users",
		columns: [
			{
				name: "id",
				typeNode: { typeName: "uuid" },
				notNull: true,
				primaryKey: true,
			},
			{
				name: "kind",
				typeNode: {
					typeName: "enum",
					enumSchema: "audit",
					enumName: "event_kind",
				},
				notNull: true,
			},
		],
		indexes: [],
		foreignKeys: [],
		primaryKeyName: "users_pkey",
	};
	const logsTable: TableSnapshot = {
		schema: "audit",
		name: "logs",
		columns: [
			{
				name: "id",
				typeNode: { typeName: "uuid" },
				notNull: true,
				primaryKey: true,
			},
			{ name: "user_id", typeNode: { typeName: "uuid" }, notNull: true },
		],
		indexes: [],
		foreignKeys: [
			{
				name: "logs_user_id_fkey",
				columns: ["user_id"],
				referencesTable: "app.users",
				referencesColumns: ["id"],
			},
		],
		primaryKeyName: "logs_pkey",
	};
	const eventKind: EnumFactLike = {
		schema: "audit",
		name: "event_kind",
		values: ["created", "updated"],
	};

	it("loads cleanly starting from app.schema.ts", async () => {
		const paths = writeFiles(resultFor([usersTable, logsTable], [eventKind]));
		const appPath = paths.get("app");
		if (appPath === undefined) {
			throw new Error("expected an app.schema.ts to have been written");
		}
		await expect(importAsEntry(appPath)).resolves.toBeDefined();
	});

	it("loads cleanly starting from audit.schema.ts (the other entry order)", async () => {
		const paths = writeFiles(resultFor([usersTable, logsTable], [eventKind]));
		const auditPath = paths.get("audit");
		if (auditPath === undefined) {
			throw new Error("expected an audit.schema.ts to have been written");
		}
		await expect(importAsEntry(auditPath)).resolves.toBeDefined();
	});
});

describe("emitDeclarationFiles / D106 B1 (CI-D106-R2-02): an enum-only cycle (no foreign key to prefer instead) also loads, in both entry orders", () => {
	/** No FK anywhere -- `app.a.kind` types against `audit.status`, `audit.b.otherKind` types against `app.category`: candidate A alone can't close this, only B can. */
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
			{
				name: "kind",
				typeNode: { typeName: "enum", enumSchema: "audit", enumName: "status" },
				notNull: true,
			},
		],
		indexes: [],
		foreignKeys: [],
		primaryKeyName: "a_pkey",
	};
	const auditB: TableSnapshot = {
		schema: "audit",
		name: "b",
		columns: [
			{
				name: "id",
				typeNode: { typeName: "uuid" },
				notNull: true,
				primaryKey: true,
			},
			{
				name: "other_kind",
				typeNode: { typeName: "enum", enumSchema: "app", enumName: "category" },
				notNull: true,
			},
		],
		indexes: [],
		foreignKeys: [],
		primaryKeyName: "b_pkey",
	};
	const enumFacts: ReadonlyArray<EnumFactLike> = [
		{ schema: "audit", name: "status", values: ["created", "updated"] },
		{ schema: "app", name: "category", values: ["x", "y"] },
	];

	it("loads cleanly starting from app.schema.ts", async () => {
		const paths = writeFiles(resultFor([appA, auditB], enumFacts));
		const appPath = paths.get("app");
		if (appPath === undefined) {
			throw new Error("expected an app.schema.ts to have been written");
		}
		await expect(importAsEntry(appPath)).resolves.toBeDefined();
	});

	it("loads cleanly starting from audit.schema.ts (the other entry order)", async () => {
		const paths = writeFiles(resultFor([appA, auditB], enumFacts));
		const auditPath = paths.get("audit");
		if (auditPath === undefined) {
			throw new Error("expected an audit.schema.ts to have been written");
		}
		await expect(importAsEntry(auditPath)).resolves.toBeDefined();
	});
});

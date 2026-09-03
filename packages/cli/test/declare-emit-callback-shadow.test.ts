import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot, TableSnapshot } from "@hejbro/core";
import { createJiti } from "jiti";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { emitDeclarationFiles } from "../src/declare-emit/emit";
import type { InferCatalogResult } from "../src/infer/compose";
import { assertBuiltCli } from "./support/cli-runner";

/**
 * D106 R7-B1 (#722): `renderExtrasBlock` (`declare-emit/emit.ts`)
 * hardcodes the extras callback's own parameter name, and before this
 * fix the file-level identifier namespace did not reserve it -- a
 * table whose identifier is that same name kept it, and every
 * reference to it from inside an extras callback resolved to the
 * callback's own column proxy instead of the table, so the file loaded
 * as nothing. These fixtures import `"hejbro"` through the real `jiti`
 * loader (not vitest's own aliased module graph), so a stale `dist`
 * would surface here as an import failure rather than as "stale
 * build" -- `assertBuiltCli` guards that (mirrors `loader-cycle.test.ts`).
 */
beforeAll(assertBuiltCli);

const CLI_PACKAGE_ROOT = join(import.meta.dirname, "..");
const TSC_PATH = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"node_modules",
	".bin",
	"tsc",
);

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
	sql: "",
	omittedSchemaNames: [],
});

let dir = "";

afterEach(() => {
	if (dir !== "") {
		rmSync(dir, { recursive: true, force: true });
		dir = "";
	}
});

/** Writes every emitted file to a fresh directory inside this package (so `@hejbro/core`/`hejbro`'s own node_modules resolution finds this workspace's real packages), returning each file's absolute path by schema name. */
const writeFiles = (
	result: InferCatalogResult,
): ReadonlyMap<string, string> => {
	dir = mkdtempSync(join(import.meta.dirname, "_tmp-callback-shadow-"));
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

// Mirrors `live-witness.integration.test.ts`'s own `run`/`exitCodeFrom` --
// neither is exported from `support/cli-runner.ts`, so this is a copy of
// that same shape rather than a new one (CI-719-R6-05's own precedent).
const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

const run = (
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
): Promise<{ readonly exitCode: number; readonly stdout: string }> =>
	new Promise((resolve) => {
		execFile(command, args, { cwd }, (error, stdout) => {
			if (error === null) {
				resolve({ exitCode: 0, stdout });
				return;
			}
			resolve({ exitCode: exitCodeFrom(error), stdout });
		});
	});

const typeCheck = (
	path: string,
): Promise<{ readonly exitCode: number; readonly stdout: string }> =>
	run(
		TSC_PATH,
		[
			"--noEmit",
			"--strict",
			"--moduleResolution",
			"bundler",
			"--module",
			"esnext",
			"--target",
			"es2022",
			path,
		],
		CLI_PACKAGE_ROOT,
	);

describe("emitDeclarationFiles / D106 R7-B1: a table named like the extras callback's own parameter still loads", () => {
	it("loads a file whose own table is named like the callback's parameter", async () => {
		const t: TableSnapshot = {
			schema: "m1",
			name: "t",
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
			primaryKeyName: "t_pkey",
		};
		const orders: TableSnapshot = {
			schema: "m1",
			name: "orders",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "t_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "orders_t_id_fkey",
					columns: ["t_id"],
					referencesTable: "m1.t",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "orders_pkey",
		};

		const paths = writeFiles(resultFor([t, orders]));
		const path = paths.get("m1");
		if (path === undefined) {
			throw new Error("expected an m1.schema.ts to have been written");
		}

		await expect(importAsEntry(path)).resolves.toBeDefined();

		const typeCheckResult = await typeCheck(path);
		expect(typeCheckResult.stdout).toBe("");
		expect(typeCheckResult.exitCode).toBe(0);
	});

	it("loads a file that imports a table named like the callback's parameter", async () => {
		const t: TableSnapshot = {
			schema: "k1",
			name: "t",
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
			primaryKeyName: "t_pkey",
		};
		const orders: TableSnapshot = {
			schema: "k2",
			name: "orders",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "t_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "orders_t_id_fkey",
					columns: ["t_id"],
					referencesTable: "k1.t",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "orders_pkey",
		};

		const paths = writeFiles(resultFor([t, orders]));
		const k1Path = paths.get("k1");
		const k2Path = paths.get("k2");
		if (k1Path === undefined || k2Path === undefined) {
			throw new Error("expected k1.schema.ts and k2.schema.ts to be written");
		}

		await expect(importAsEntry(k2Path)).resolves.toBeDefined();

		const k1Check = await typeCheck(k1Path);
		expect(k1Check.stdout).toBe("");
		expect(k1Check.exitCode).toBe(0);
		const k2Check = await typeCheck(k2Path);
		expect(k2Check.stdout).toBe("");
		expect(k2Check.exitCode).toBe(0);
	});

	it("loads both files of a cut cycle when the cut side's table is named like the callback's parameter", async () => {
		// h1.a and h1.b both reference h2.t (the forward edges, real
		// cross-file imports); h2.t references h1.a back (the schema
		// graph's own back edge, cut via an existingTable handle in
		// h2.schema.ts). h1.schema.ts therefore imports `t` bare from
		// h2.schema.ts, and both of h1's own tables render an extras
		// callback whose own parameter is also `t`.
		const a: TableSnapshot = {
			schema: "h1",
			name: "a",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "t_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "a_t_id_fkey",
					columns: ["t_id"],
					referencesTable: "h2.t",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "a_pkey",
		};
		const b: TableSnapshot = {
			schema: "h1",
			name: "b",
			columns: [
				{
					name: "id",
					typeNode: { typeName: "uuid" },
					notNull: true,
					primaryKey: true,
				},
				{ name: "t_id", typeNode: { typeName: "uuid" }, notNull: true },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "b_t_id_fkey",
					columns: ["t_id"],
					referencesTable: "h2.t",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "b_pkey",
		};
		const t: TableSnapshot = {
			schema: "h2",
			name: "t",
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
					name: "t_a_id_fkey",
					columns: ["a_id"],
					referencesTable: "h1.a",
					referencesColumns: ["id"],
				},
			],
			primaryKeyName: "t_pkey",
		};

		const paths = writeFiles(resultFor([a, b, t]));
		const h1Path = paths.get("h1");
		const h2Path = paths.get("h2");
		if (h1Path === undefined || h2Path === undefined) {
			throw new Error("expected h1.schema.ts and h2.schema.ts to be written");
		}

		await expect(importAsEntry(h1Path)).resolves.toBeDefined();
		const forwardCheck = await typeCheck(h1Path);
		expect(forwardCheck.stdout).toBe("");
		expect(forwardCheck.exitCode).toBe(0);

		// The other entry order -- the delta's own claim is that loading
		// does not depend on which file the loader reaches first.
		const secondDir = mkdtempSync(
			join(import.meta.dirname, "_tmp-callback-shadow-reverse-"),
		);
		try {
			const secondFiles = emitDeclarationFiles(resultFor([a, b, t]));
			const secondPaths = new Map(
				secondFiles.map((file) => {
					const path = join(secondDir, `${file.fileBaseName}.schema.ts`);
					writeFileSync(path, file.source);
					return [file.schema, path] as const;
				}),
			);
			const secondH2Path = secondPaths.get("h2");
			if (secondH2Path === undefined) {
				throw new Error("expected h2.schema.ts to have been written");
			}
			await expect(importAsEntry(secondH2Path)).resolves.toBeDefined();
			const backwardCheck = await typeCheck(secondH2Path);
			expect(backwardCheck.stdout).toBe("");
			expect(backwardCheck.exitCode).toBe(0);
		} finally {
			rmSync(secondDir, { recursive: true, force: true });
		}
	});
});

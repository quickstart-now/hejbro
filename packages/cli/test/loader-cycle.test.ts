import { join } from "node:path";
import type { HejbroInput, Table } from "@hejbro/core";
import { getTableMeta, isTable } from "@hejbro/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig, loadDeclarations } from "../src/loader";
import { assertBuiltCli } from "./support/cli-runner";

// D106 R1 NB1: these fixtures import "hejbro", which jiti resolves
// through real Node module resolution to packages/cli/dist ->
// packages/core/dist -- not the source under test. vitest's own
// resolve.alias only rewrites imports inside vitest's module graph;
// jiti is a separate loader and is unaffected by it. Without this guard
// a stale dist surfaces as an import failure here, not as "stale build".
beforeAll(assertBuiltCli);

const fixturesDir = join(import.meta.dirname, "fixtures");

const tableNamed = (
	declarations: ReadonlyArray<HejbroInput>,
	tableName: string,
): Table => {
	const found = declarations.find(
		(declaration) =>
			isTable(declaration) &&
			getTableMeta(declaration as Table).tableName === tableName,
	);
	if (found === undefined) {
		throw new Error(`fixture is missing table "${tableName}"`);
	}
	return found as Table;
};

// #669: two schema files whose tables `.references()` each other used to
// crash the real loader with "Cannot read properties of undefined" (a
// live ESM import cycle, `foldColumnReferences` calling the thunk
// synchronously inside `table()`, before the other file's module body had
// finished running). The thunk is now resolved lazily, on each
// declaration's first `foreignKeys` read -- well after `loadDeclarations`
// has already finished importing every file.
describe("loadDeclarations: cross-file .references() cycles (#669)", () => {
	it("loads both files when the alphabetically-first file is the one with the forward reference", async () => {
		const cwd = join(fixturesDir, "reference-cycle-forward");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);

		const authors = tableNamed(declarations, "authors");
		const comments = tableNamed(declarations, "comments");
		expect(getTableMeta(authors).foreignKeys).toEqual([
			{
				columns: ["latest_comment_id"],
				references: {
					schemaName: "blog",
					tableName: "comments",
					columns: ["id"],
				},
				name: null,
				onDelete: null,
				onUpdate: null,
			},
		]);
		expect(getTableMeta(comments).foreignKeys).toEqual([
			{
				columns: ["author_id"],
				references: {
					schemaName: "app",
					tableName: "authors",
					columns: ["id"],
				},
				name: null,
				onDelete: null,
				onUpdate: null,
			},
		]);
	});

	it("loads both files when the alphabetically-first file is the other half of the same cycle", async () => {
		const cwd = join(fixturesDir, "reference-cycle-reverse");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);

		const authors = tableNamed(declarations, "authors");
		const comments = tableNamed(declarations, "comments");
		expect(getTableMeta(authors).foreignKeys).toEqual([
			{
				columns: ["latest_comment_id"],
				references: {
					schemaName: "blog",
					tableName: "comments",
					columns: ["id"],
				},
				name: null,
				onDelete: null,
				onUpdate: null,
			},
		]);
		expect(getTableMeta(comments).foreignKeys).toEqual([
			{
				columns: ["author_id"],
				references: {
					schemaName: "app",
					tableName: "authors",
					columns: ["id"],
				},
				name: null,
				onDelete: null,
				onUpdate: null,
			},
		]);
	});
});

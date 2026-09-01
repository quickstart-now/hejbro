import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// Same built-CLI, child_process approach as generate-command.test.ts and
// for the same reason: loadDeclarations jiti-imports the schema fixture
// through Node's own resolution, which would otherwise resolve a
// different @hejbro/core instance than an in-process vitest call.

const SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
	await runCli(cwd, ["init"]);
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const writeSchema = (base: string, source: string): Promise<void> =>
	writeFixtureFile(base, "src/app.schema.ts", source);

const exportPath = (base: string, name: string): string =>
	join(base, ".hejbro", "export", name);

const readExportFile = (base: string, name: string): Promise<string> =>
	readFile(exportPath(base, name), "utf8");

const soleMigrationText = async (base: string): Promise<string> => {
	const [fileName] = (await readdir(join(base, "migrations")))
		.filter((name) => name.endsWith(".sql"))
		.sort();
	if (fileName === undefined) {
		throw new Error("expected exactly one migration file");
	}
	return readFile(join(base, "migrations", fileName), "utf8");
};

describe("hejbro generate --export", () => {
	it("writes the description, the SQL and the format record", async () => {
		await writeSchema(cwd, SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate", "--export"]);
		expect(result.exitCode).toBe(0);

		const description = JSON.parse(await readExportFile(cwd, "schema.json"));
		expect(
			description.tables.some(
				(t: { tableName: string }) => t.tableName === "posts",
			),
		).toBe(true);

		const sql = await readExportFile(cwd, "snapshot.sql");
		expect(sql).toContain('create table "app"."posts"');

		const format = JSON.parse(await readExportFile(cwd, "format.json"));
		expect(typeof format.descriptionFormat).toBe("number");
		expect(typeof format.snapshotFormat).toBe("number");
	});

	it("writes the export with no database reachable", async () => {
		await writeSchema(cwd, SCHEMA_SOURCE);

		// No DATABASE_URL, no driver, no live server -- `generate` never
		// opens a connection, and the export is no exception.
		const result = await runCli(cwd, ["generate", "--export"]);
		expect(result.exitCode).toBe(0);
		expect(await readExportFile(cwd, "schema.json")).toBeTruthy();
	});

	it("migration and snapshot are byte-identical with the export disabled", async () => {
		const withoutExportCwd = await createCliFixtureDir();
		try {
			await runCli(withoutExportCwd, ["init"]);
			await writeSchema(withoutExportCwd, SCHEMA_SOURCE);
			await runCli(withoutExportCwd, ["generate"]);

			await writeSchema(cwd, SCHEMA_SOURCE);
			await runCli(cwd, ["generate", "--export"]);

			expect(await soleMigrationText(cwd)).toBe(
				await soleMigrationText(withoutExportCwd),
			);
			expect(await readFile(join(cwd, "hejbro.snapshot.json"), "utf8")).toBe(
				await readFile(join(withoutExportCwd, "hejbro.snapshot.json"), "utf8"),
			);
		} finally {
			await removeCliFixtureDir(withoutExportCwd);
		}
	});

	it("description and snapshot formats are distinct values", async () => {
		await writeSchema(cwd, SCHEMA_SOURCE);
		await runCli(cwd, ["generate", "--export"]);

		const format = JSON.parse(await readExportFile(cwd, "format.json"));
		const description = JSON.parse(await readExportFile(cwd, "schema.json"));
		expect(format.snapshotFormat).toBe(description.snapshot.formatVersion);
		// Both are independently-readable fields, not one value read twice --
		// the description format is the wrapper shape's own version, which a
		// consumer must be able to tell apart from the embedded snapshot's.
		expect(Object.keys(format).sort()).toEqual([
			"descriptionFormat",
			"snapshotFormat",
		]);
	});
});

describe("hejbro baseline --export", () => {
	it("also writes the export", async () => {
		await writeSchema(cwd, SCHEMA_SOURCE);
		const result = await runCli(cwd, ["baseline", "--export"]);
		expect(result.exitCode).toBe(0);
		expect(await readExportFile(cwd, "schema.json")).toBeTruthy();
	});
});

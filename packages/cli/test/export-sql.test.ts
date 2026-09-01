import { readdir } from "node:fs/promises";
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

describe("the export's SQL is not a migration", () => {
	it("listing migrations does not yield the export's SQL", async () => {
		await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate", "--export"]);
		expect(result.exitCode).toBe(0);

		const migrationFiles = await readdir(join(cwd, "migrations"));
		expect(migrationFiles).not.toContain("snapshot.sql");
		expect(migrationFiles.some((name) => name.startsWith(".hejbro"))).toBe(
			false,
		);

		const exportFiles = await readdir(join(cwd, ".hejbro", "export"));
		expect(exportFiles.sort()).toEqual([
			"format.json",
			"schema.json",
			"snapshot.sql",
		]);
	});
});

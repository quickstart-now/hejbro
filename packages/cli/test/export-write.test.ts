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

const FUNCTION_SCHEMA_SOURCE = `import { bigint, defineFunction, schema, select, sql, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const totalPosts = defineFunction(
	app,
	"total_posts",
	{ returns: bigint() },
	(ctx) => {
		ctx.return(sql\`1\`);
	},
);

export const postById = defineFunction(
	app,
	"post_by_id",
	{ args: { postId: uuid() }, returns: posts },
	(ctx, args) => {
		ctx.return(select(posts).where(sql\`\${posts.id} = \${args.postId}\`));
	},
);
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

	it("carries a function's argument keys and return shape through a real write", async () => {
		await writeSchema(cwd, FUNCTION_SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate", "--export"]);
		expect(result.exitCode).toBe(0);

		const description = JSON.parse(await readExportFile(cwd, "schema.json"));
		const scalarFact = description.functions.find(
			(f: { functionName: string }) => f.functionName === "total_posts",
		);
		expect(scalarFact.args).toEqual([]);
		expect(scalarFact.returns).toEqual({
			kind: "scalar",
			typeNode: { typeName: "bigint" },
			mode: "bigint",
		});

		const tableFact = description.functions.find(
			(f: { functionName: string }) => f.functionName === "post_by_id",
		);
		expect(tableFact.args).toEqual([
			{
				key: "postId",
				sqlName: "post_id",
				typeNode: { typeName: "uuid" },
				mode: null,
				notNullElements: false,
			},
		]);
		expect(tableFact.returns).toEqual({
			kind: "table",
			schemaName: "app",
			tableName: "posts",
		});
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

	it("writes a first export even when declarations already match the snapshot (D106 M2)", async () => {
		await writeSchema(cwd, SCHEMA_SOURCE);
		// Establishes a snapshot with no export enabled -- the shape an
		// already-adopted repository is in the day it decides to start
		// exporting: its declarations already match its snapshot, so a
		// plain `generate --export` run finds no difference at all.
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["generate", "--export"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("no changes");
		expect(await readExportFile(cwd, "schema.json")).toBeTruthy();
		expect(await readExportFile(cwd, "snapshot.sql")).toBeTruthy();
		expect(await readExportFile(cwd, "format.json")).toBeTruthy();
	});

	it("refreshes an existing export on a no-difference run, not just a first one", async () => {
		await writeSchema(cwd, SCHEMA_SOURCE);
		await runCli(cwd, ["generate", "--export"]);
		const before = await readExportFile(cwd, "schema.json");

		// Hand-edit the export to something stale, then confirm the very
		// next no-difference run restores it -- "refresh", not merely
		// "create the first one and never touch it again".
		await writeFixtureFile(cwd, ".hejbro/export/schema.json", "{}");
		const result = await runCli(cwd, ["generate", "--export"]);
		expect(result.exitCode).toBe(0);

		expect(await readExportFile(cwd, "schema.json")).toBe(before);
	});

	it("carries an existing table marked as such (add-unmanaged-objects, 2.1)", async () => {
		const schemaWithExisting = `import { existingTable, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const authUsers = existingTable("auth", "users", { id: uuid() });

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;
		await writeSchema(cwd, schemaWithExisting);
		const result = await runCli(cwd, ["generate", "--export"]);
		expect(result.exitCode).toBe(0);

		const description = JSON.parse(await readExportFile(cwd, "schema.json"));
		const authUsersFact = description.tables.find(
			(t: { tableName: string }) => t.tableName === "users",
		);
		expect(authUsersFact).toBeDefined();
		expect(authUsersFact.existing).toBe(true);

		// The field is always present (export/description.ts's own "no
		// omitted key" convention, unlike the snapshot's compact rule) --
		// a managed table's entry carries an explicit `false`, not an
		// absent key a reader would have to default itself.
		const postsFact = description.tables.find(
			(t: { tableName: string }) => t.tableName === "posts",
		);
		expect(postsFact).toBeDefined();
		expect(postsFact.existing).toBe(false);
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

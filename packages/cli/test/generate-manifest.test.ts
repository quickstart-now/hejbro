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

const SECOND_COLUMN_SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	status: text().notNull(),
});
`;

const MANIFEST_PAYLOAD_TERMINATOR = "$hejbro_manifest$";

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
	await runCli(cwd, ["init"]);
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const writeSchema = (source: string): Promise<void> =>
	writeFixtureFile(cwd, "src/app.schema.ts", source);

const sqlFileNames = async (): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(join(cwd, "migrations"));
	return entries.filter((name) => name.endsWith(".sql")).sort();
};

const soleMigrationText = async (): Promise<string> => {
	const [fileName] = await sqlFileNames();
	if (fileName === undefined) {
		throw new Error("expected exactly one migration file");
	}
	return readFile(join(cwd, "migrations", fileName), "utf8");
};

/** The payload JSON between the two `$hejbro_manifest$` markers of a migration's manifest insert. */
const extractManifestPayload = (migrationText: string): unknown => {
	const [, afterFirst] = migrationText.split(MANIFEST_PAYLOAD_TERMINATOR);
	if (afterFirst === undefined) {
		throw new Error("migration text carries no manifest payload");
	}
	return JSON.parse(afterFirst);
};

describe("hejbro generate --manifest", () => {
	it("enabled emission appends the statements to the difference", async () => {
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate", "--manifest"]);
		expect(result.exitCode).toBe(0);

		const migrationText = await soleMigrationText();
		const createIndex = migrationText.indexOf('create table "app"."posts"');
		const bootstrapIndex = migrationText.indexOf(
			'create table if not exists "hejbro"."schema_manifest"',
		);
		const insertIndex = migrationText.indexOf(
			'insert into "hejbro"."schema_manifest"',
		);
		expect(createIndex).toBeGreaterThanOrEqual(0);
		expect(bootstrapIndex).toBeGreaterThan(createIndex);
		expect(insertIndex).toBeGreaterThan(bootstrapIndex);
		expect(migrationText).toContain("-- hejbro-manifest: 1");
	});

	it("disabled emission is byte-identical", async () => {
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);

		const migrationText = await soleMigrationText();
		expect(migrationText).not.toContain("hejbro-manifest");
		expect(migrationText).not.toContain("schema_manifest");
	});

	it("the payload embeds the snapshot the run writes to disk", async () => {
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate", "--manifest"]);
		expect(result.exitCode).toBe(0);

		const migrationText = await soleMigrationText();
		const payload = extractManifestPayload(migrationText) as {
			readonly snapshot: unknown;
		};
		const snapshotFileText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		expect(payload.snapshot).toEqual(JSON.parse(snapshotFileText));
	});

	it("the inserted snapshot hash is the one the banner records", async () => {
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate", "--manifest"]);
		expect(result.exitCode).toBe(0);

		const migrationText = await soleMigrationText();
		const bannerMatch = migrationText.match(/-- snapshot: (sha256:[0-9a-f]+)/);
		const insertMatch = migrationText.match(
			/insert into "hejbro"\."schema_manifest" \([^)]*\) values \(\d+, \d+, '([^']+)'/,
		);
		expect(bannerMatch?.[1]).toBeDefined();
		expect(insertMatch?.[1]).toBe(bannerMatch?.[1]);
	});

	it("no difference writes nothing", async () => {
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate", "--manifest"]);

		const result = await runCli(cwd, ["generate", "--manifest"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);
		expect(await sqlFileNames()).toHaveLength(1);
	});

	it("a change after an enabled migration still carries the statements", async () => {
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate", "--manifest"]);
		await writeSchema(SECOND_COLUMN_SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate", "--manifest"]);
		expect(result.exitCode).toBe(0);
		expect(await sqlFileNames()).toHaveLength(2);
	});

	it("refuses a later change without --manifest once the chain carries one (wiring for manifest-chain.ts)", async () => {
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate", "--manifest"]);
		await writeSchema(SECOND_COLUMN_SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("manifest-emission-required");
		expect(await sqlFileNames()).toHaveLength(1);
	});
});

describe("hejbro baseline --manifest", () => {
	it("a baseline carries no manifest statements", async () => {
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["baseline", "--manifest"]);
		expect(result.exitCode).toBe(0);

		const migrationText = await soleMigrationText();
		expect(migrationText).not.toContain("hejbro-manifest");
		expect(migrationText).not.toContain("schema_manifest");
	});

	it("the baseline report names the absent row", async () => {
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["baseline", "--manifest"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("No manifest row will exist");
	});

	it("a baseline without --manifest says nothing about manifests", async () => {
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["baseline"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("manifest");
	});
});

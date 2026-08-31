import { readdir, readFile, writeFile } from "node:fs/promises";
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

// Same built-CLI approach as generate-manifest.test.ts, for the same
// reason (real jiti-loaded schema fixtures).

const SCHEMA_V1 = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

const SCHEMA_V2 = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	status: text().notNull(),
});
`;

const SCHEMA_V3 = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	status: text().notNull(),
	summary: text().notNull(),
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

const writeSchema = (source: string): Promise<void> =>
	writeFixtureFile(cwd, "src/app.schema.ts", source);

const sqlFileNames = async (): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(join(cwd, "migrations"));
	return entries.filter((name) => name.endsWith(".sql")).sort();
};

/** Removes a migration's manifest banner line and its manifest
 * statements (the schema-manifest delta's own "removed by hand"
 * scenario) — every other line, including the other banner lines and
 * the change's own statements, is left untouched. */
const stripManifestByHand = (migrationText: string): string => {
	const withoutBannerLine = migrationText
		.split("\n")
		.filter((line) => !line.startsWith("-- hejbro-manifest: "))
		.join("\n");
	const [beforeBootstrap] = withoutBannerLine.split(
		'create schema if not exists "hejbro";',
	);
	return beforeBootstrap ?? withoutBannerLine;
};

describe("hejbro verify (manifest monotonicity)", () => {
	it("reports a chain that stopped carrying its manifests", async () => {
		await writeSchema(SCHEMA_V1);
		await runCli(cwd, ["generate", "--manifest"]);
		await writeSchema(SCHEMA_V2);
		await runCli(cwd, ["generate", "--manifest"]);
		await writeSchema(SCHEMA_V3);
		await runCli(cwd, ["generate", "--manifest"]);

		const [first, second, third] = await sqlFileNames();
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(third).toBeDefined();

		// Hand-edit the middle migration only — the first and last are
		// untouched and still carry their own manifest statements, so this
		// is exactly "removed from a migration in a chain whose later
		// migrations carry them" (schema-manifest delta).
		const secondPath = join(cwd, "migrations", second as string);
		const original = await readFile(secondPath, "utf8");
		expect(original).toContain("-- hejbro-manifest: 1");
		await writeFile(secondPath, stripManifestByHand(original));

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("manifest-chain-interrupted");
		expect(result.stderr).toContain(second);
	});

	it("passes when every migration from the first manifest onward keeps carrying one", async () => {
		await writeSchema(SCHEMA_V1);
		await runCli(cwd, ["generate", "--manifest"]);
		await writeSchema(SCHEMA_V2);
		await runCli(cwd, ["generate", "--manifest"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
	});

	it("passes when the chain never carried a manifest at all", async () => {
		await writeSchema(SCHEMA_V1);
		await runCli(cwd, ["generate"]);
		await writeSchema(SCHEMA_V2);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
	});

	it("a chain that begins carrying manifests midway is not reported", async () => {
		// M1 has no manifest, M2 and M3 do — adopting emission partway
		// through a chain's history is legitimate (schema-manifest delta,
		// "A chain that starts carrying midway is not a gap"): the leading
		// absence is indistinguishable from where emission was turned on,
		// so reporting it would call a normal adoption a regression.
		await writeSchema(SCHEMA_V1);
		await runCli(cwd, ["generate"]);
		await writeSchema(SCHEMA_V2);
		await runCli(cwd, ["generate", "--manifest"]);
		await writeSchema(SCHEMA_V3);
		await runCli(cwd, ["generate", "--manifest"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
	});
});

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// #385: adopting a database hejbro did not create. The whole point is the
// FIRST migration -- everything after it is an ordinary `generate`.

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

const SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

// D106 R1, N6: `baseline` shares its diff path with `generate`
// (`commands/generate.ts`'s `runGenerate`, both modes call the identical
// `generateMigrations`) -- this fixture pins the observable half of that
// claim directly, since no ADDED requirement named `baseline` at all
// (evaluation.md).
const SCHEMA_WITH_EXISTING_SOURCE = `import { existingTable, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const legacyCustomers = existingTable("app", "legacy_customers", {
	id: uuid(),
});

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

const soleMigration = async (cwd: string): Promise<string> => {
	const names = (await readdir(join(cwd, "migrations"))).filter((name) =>
		name.endsWith(".sql"),
	);
	const [only] = names;
	if (names.length !== 1 || only === undefined) {
		throw new Error(`expected exactly one migration, found ${names.length}`);
	}
	return readFile(join(cwd, "migrations", only), "utf8");
};

describe("hejbro baseline", () => {
	it("writes a first migration marked as already applied, and says what to do with it", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);

			const result = await runCli(cwd, ["baseline"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hejbro baseline");
			expect(result.stdout).toContain(
				"This migration describes objects your database already has.",
			);
			// [task 4.8] The report names hejbro's own apply command, not a
			// step the reader has to arrange in an external pipeline.
			expect(result.stdout).toContain("hejbro migrate");
			expect(result.stdout).toContain("hejbro check");

			const sql = await soleMigration(cwd);
			expect(sql).toContain(
				"-- baseline: these objects already exist — register this migration as applied, do not run it",
			);
			// it is a real migration otherwise: the DDL and the hash chain are
			// exactly what `generate` would have produced.
			expect(sql).toContain('create table "app"."posts"');
			expect(sql).toContain("-- parent-snapshot: sha256:");
			expect(sql).toContain("-- snapshot: sha256:");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("an existing declaration contributes nothing to the baseline migration (D106 R1, N6)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(
				cwd,
				"src/app.schema.ts",
				SCHEMA_WITH_EXISTING_SOURCE,
			);
			await runCli(cwd, ["init"]);

			const result = await runCli(cwd, ["baseline"]);
			expect(result.exitCode).toBe(0);

			const sql = await soleMigration(cwd);
			// The managed table still baselines normally...
			expect(sql).toContain('create table "app"."posts"');
			// ...and the existing declaration contributes no statement and no
			// banner note naming it -- baseline shares generate's diff path,
			// and generate emits nothing for an existing table (group 1).
			expect(sql.toLowerCase()).not.toContain("legacy_customers");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("verify accepts the chain a baseline starts", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["baseline"]);

			const verify = await runCli(cwd, ["verify"]);
			expect(verify.exitCode).toBe(0);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("the next change is an ordinary generate, with no baseline marker", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["baseline"]);

			await writeFixtureFile(
				cwd,
				"src/app.schema.ts",
				`${SCHEMA_SOURCE}\nexport const tags = table(app, "tags", { id: uuid().primaryKey() });\n`,
			);
			const generated = await runCli(cwd, ["generate"]);
			expect(generated.exitCode).toBe(0);
			expect(generated.stdout).toContain("hejbro generate");

			const names = (await readdir(join(cwd, "migrations"))).filter((name) =>
				name.endsWith(".sql"),
			);
			expect(names.length).toBe(2);
			const second = await readFile(
				join(cwd, "migrations", names.sort()[1] as string),
				"utf8",
			);
			expect(second).not.toContain("-- baseline:");
			// and it emits only the delta, never the tables the baseline covered.
			expect(second).toContain('create table "app"."tags"');
			expect(second).not.toContain('create table "app"."posts"');
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("refuses to adopt when declarations load but export nothing, and writes no files (#445/D2)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			// matches the entry glob and loads cleanly, but exports nothing
			// hejbro recognizes as a declaration -- the exact D2 shape.
			await writeFixtureFile(
				cwd,
				"src/app.schema.ts",
				"export const notADeclaration = 1;\n",
			);
			await runCli(cwd, ["init"]);
			const snapshotPath = join(cwd, "hejbro.snapshot.json");
			const snapshotBefore = await readFile(snapshotPath, "utf8");

			const result = await runCli(cwd, ["baseline"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[baseline-nothing-to-adopt]");
			expect(result.stdout).toBe("");

			const migrationFiles = (await readdir(join(cwd, "migrations"))).filter(
				(name) => name.endsWith(".sql"),
			);
			expect(migrationFiles).toHaveLength(0);
			// the snapshot init left behind is byte-untouched -- baseline wrote
			// nothing at all, not even an empty rewrite.
			const snapshotAfter = await readFile(snapshotPath, "utf8");
			expect(snapshotAfter).toBe(snapshotBefore);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("refuses --rename before anything is written (#445, nit)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);

			const result = await runCli(cwd, [
				"baseline",
				"--rename",
				"app.old=posts",
			]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[baseline-flag-not-applicable]");
			expect(result.stderr).toContain("hejbro generate");

			const migrationFiles = (await readdir(join(cwd, "migrations"))).filter(
				(name) => name.endsWith(".sql"),
			);
			expect(migrationFiles).toHaveLength(0);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("refuses --confirm-drop before anything is written (#445, nit)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);

			const result = await runCli(cwd, [
				"baseline",
				"--confirm-drop",
				"app.posts",
			]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[baseline-flag-not-applicable]");

			const migrationFiles = (await readdir(join(cwd, "migrations"))).filter(
				(name) => name.endsWith(".sql"),
			);
			expect(migrationFiles).toHaveLength(0);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("the diagnostic header names the config, not the solution command (#445 review B5)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);

			const result = await runCli(cwd, [
				"baseline",
				"--rename",
				"app.old=posts",
			]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"error[baseline-flag-not-applicable]: hejbro.config.ts",
			);
			// not the solution command -- identityFromMessage takes the
			// first quoted substring as the diagnostic's own subject, and a
			// double-quoted "hejbro generate" in the message used to win
			// that slot instead of the config path.
			expect(result.stderr).not.toContain(
				"error[baseline-flag-not-applicable]: hejbro generate",
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("refuses the flag before any config or declaration loads (#445 review R-a)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			// no hejbro.config.ts at all -- if the flag intercept ever moved
			// to after config/declaration loading, this would surface
			// config-not-found instead, breaking the delta's "before any
			// declaration is loaded" guarantee silently.
			const result = await runCli(cwd, [
				"baseline",
				"--rename",
				"app.old=posts",
			]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[baseline-flag-not-applicable]");
			expect(result.stderr).not.toContain("config-not-found");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("refuses --rename=<value> (equals form) the same as the space form (#445 review R-c)", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);

			const result = await runCli(cwd, ["baseline", "--rename=app.old=posts"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[baseline-flag-not-applicable]");

			const migrationFiles = (await readdir(join(cwd, "migrations"))).filter(
				(name) => name.endsWith(".sql"),
			);
			expect(migrationFiles).toHaveLength(0);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("refuses to run over a chain that already exists", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);

			const result = await runCli(cwd, ["baseline"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[baseline-not-first]");
			expect(result.stderr).toContain("hejbro generate");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});

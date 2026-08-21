import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// #125: a config or declaration file whose own import fails used to crash
// with a raw, uncaught Node error instead of a §7 diagnostic. Two distinct
// failure shapes reproduce it (phase8-loader-diagnostics item 1):
// (a) a package that isn't installed at all, (b) an installed package
// whose "exports" entry doesn't resolve to a real file (the shape
// phase8-packaging's smoke test produces when a package's exports break).
// Both surface from jiti as a plain `Error` with `code: "MODULE_NOT_FOUND"`
// (confirmed by direct reproduction — no "ERR_" prefix, unlike the
// ERR_MODULE_NOT_FOUND-shaped case errors.test.ts already covers) — see
// this PR's report to planner for the exact captured error objects.

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

const CONFIG_IMPORTING_MISSING_PACKAGE = `import { defineConfig } from "hejbro";
import "totally-not-installed-package";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

const SCHEMA_IMPORTING_MISSING_PACKAGE = `import { schema } from "hejbro";
import "totally-not-installed-package";

export const app = schema("app");
`;

/** A DSL validation error thrown during a declaration file's own module
 * evaluation (not a load failure) — this must keep rendering as its own
 * diagnostic (code + declaredAt), never get swallowed into a generic
 * declaration-load-failed (phase8-loader-diagnostics items 12/13). */
const SCHEMA_WITH_INVALID_TABLE_NAME = `import { existingTable, uuid } from "hejbro";

export const bad = existingTable("app", "Bad Table Name", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

const CONFIG_IMPORTING_BROKEN_PACKAGE = `import { defineConfig } from "hejbro";
import "broken-pkg";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

describe("loader diagnostics (#125)", () => {
	it("(a) config importing a package that isn't installed becomes a diagnostic, not a raw crash", async () => {
		await writeFixtureFile(
			cwd,
			"hejbro.config.ts",
			CONFIG_IMPORTING_MISSING_PACKAGE,
		);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[config-load-failed]");
		expect(result.stderr).toContain("hejbro.config.ts");
		expect(result.stderr).toContain("totally-not-installed-package");
		expect(result.stderr).toContain("Next:");
		expect(result.stderr).not.toContain(cwd);
		// The raw crash shape this replaces: an uncaught Node stack trace
		// with its own "at ..." frames, never hejbro's §7 grammar.
		expect(result.stderr).not.toContain("node:internal/modules");
	});

	it("(b) config importing an installed package whose exports doesn't resolve becomes a diagnostic, not a raw crash", async () => {
		await writeFixtureFile(
			cwd,
			"node_modules/broken-pkg/package.json",
			JSON.stringify({
				name: "broken-pkg",
				version: "1.0.0",
				type: "module",
				exports: { ".": "./dist/index.js" },
			}),
		);
		await writeFixtureFile(
			cwd,
			"hejbro.config.ts",
			CONFIG_IMPORTING_BROKEN_PACKAGE,
		);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[config-load-failed]");
		expect(result.stderr).toContain("hejbro.config.ts");
		expect(result.stderr).toContain("broken-pkg");
		expect(result.stderr).toContain("Next:");
		expect(result.stderr).not.toContain(cwd);
		expect(result.stderr).not.toContain("node:internal/modules");
	});

	it("a declaration file importing a package that isn't installed becomes a diagnostic naming the file", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"src/app.schema.ts",
			SCHEMA_IMPORTING_MISSING_PACKAGE,
		);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[declaration-load-failed]");
		expect(result.stderr).toContain("app.schema.ts");
		expect(result.stderr).toContain("totally-not-installed-package");
		expect(result.stderr).toContain("Next:");
		expect(result.stderr).not.toContain(cwd);
	});

	it("a DSL error thrown while a declaration file evaluates renders as its own diagnostic, not declaration-load-failed", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"src/app.schema.ts",
			SCHEMA_WITH_INVALID_TABLE_NAME,
		);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-sql-name]");
		expect(result.stderr).not.toContain("declaration-load-failed");
		expect(result.stderr).toContain('table name "Bad Table Name"');
		// declaredAt must survive: existingTable captures it, and the
		// rendered diagnostic's "at" tail comes from it.
		expect(result.stderr).toContain("at src/app.schema.ts:");
		expect(result.stderr).not.toContain(cwd);
	});
});

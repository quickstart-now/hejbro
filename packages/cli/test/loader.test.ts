import { join } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { loadConfig, loadDeclarations } from "../src/loader";

const schemaNameOf = (declaration: HejbroInput): string | null => {
	if (typeof declaration !== "object" || declaration === null) {
		return null;
	}
	if (
		"schemaName" in declaration &&
		typeof declaration.schemaName === "string"
	) {
		return declaration.schemaName;
	}
	return null;
};

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("loadConfig", () => {
	it('loads the default export via jiti.import(path, { default: true }) — also exercises the U2 self-import cycle (hejbro.config.ts importing from "hejbro")', async () => {
		const cwd = join(fixturesDir, "basic");
		const { config, configPath } = await loadConfig(cwd, undefined);
		expect(configPath).toBe(join(cwd, "hejbro.config.ts"));
		expect(config).toEqual({
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
		});
	});

	it("resolves --config relative to cwd", async () => {
		const cwd = fixturesDir;
		const { configPath } = await loadConfig(cwd, "basic/hejbro.config.ts");
		expect(configPath).toBe(join(fixturesDir, "basic", "hejbro.config.ts"));
	});

	it("throws config-not-found with the resolved path when no config file exists", async () => {
		const cwd = join(fixturesDir, "entry-not-found", "no-such-dir");
		try {
			await loadConfig(cwd, undefined);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-found" });
			expect((error as { message: string }).message).toContain(cwd);
		}
	});
});

describe("loadDeclarations", () => {
	it("collects every exported hejbro declaration, ignoring non-declaration exports", async () => {
		const cwd = join(fixturesDir, "basic");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		expect(declarations).toHaveLength(2);
		const [schemaInput, tableInput] = declarations;
		expect(schemaInput).toMatchObject({
			declarationKind: "schema",
			schemaName: "app",
		});
		// Checked structurally, not via isTable()/getTableMeta() imported
		// here: jiti loads fixtures through Node's native import(), while
		// vitest transforms this test file (and src/loader.ts) through its
		// own SSR module graph, so a "@hejbro/core" imported in *this* file
		// isn't guaranteed to be the same module instance jiti's fixture
		// resolved — `Table`'s hidden metadata symbol wouldn't match across
		// that boundary even though loader.ts's own (cross-instance-safe)
		// detection already proved this is a table (see loader.ts's
		// `hasTableMetaSymbol`).
		expect(tableInput).toMatchObject({
			id: { sqlName: "id" },
			title: { sqlName: "title" },
		});
	});

	it("throws entry-not-found when no files match the entry patterns", async () => {
		const cwd = join(fixturesDir, "entry-not-found");
		const { config, configPath } = await loadConfig(cwd, undefined);
		try {
			await loadDeclarations(configPath, config);
			throw new Error("expected loadDeclarations to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "entry-not-found" });
			const message = (error as { message: string }).message;
			expect(message).toContain("schema, table, uuid, text");
			expect(message).toContain('from "hejbro"');
		}
	});

	it("orders declarations deterministically by sorted file path, not directory-listing order", async () => {
		const cwd = join(fixturesDir, "ordering");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		expect(declarations.map(schemaNameOf)).toEqual(["a_schema", "z_schema"]);
	});
});

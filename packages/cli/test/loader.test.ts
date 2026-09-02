import { join } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import { isTable } from "@hejbro/core";
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
			presets: [],
		});
	});

	it("resolves --config relative to cwd", async () => {
		const cwd = fixturesDir;
		const { configPath } = await loadConfig(cwd, "basic/hejbro.config.ts");
		expect(configPath).toBe(join(fixturesDir, "basic", "hejbro.config.ts"));
	});

	it("throws config-not-found with the owner-approved text verbatim (no absolute paths)", async () => {
		const cwd = join(fixturesDir, "entry-not-found", "no-such-dir");
		try {
			await loadConfig(cwd, undefined);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({
				code: "config-not-found",
				message:
					"no hejbro.config.ts was found. Next: run `hejbro init` to scaffold hejbro.config.ts, a migrations directory, and an empty snapshot file, then add a declaration file and rerun `hejbro generate`.",
			});
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
		// jiti loads fixtures through Node's native import(), while vitest
		// transforms this test file (and src/loader.ts) through its own SSR
		// module graph — a "@hejbro/core" imported in *this* file isn't
		// guaranteed to be the same module instance jiti's fixture resolved.
		// This is a real instance of the cross-instance-symbol case
		// (phase8-symbol-for, #138), not a synthetic one: before `tableMeta`
		// switched to `Symbol.for`, `isTable()` here was expected to
		// disagree across that boundary (that's why this assertion used to
		// check structurally instead). Asserted directly now to lock the
		// fix in — if it ever regresses, this goes red for the same reason
		// generate/verify's declaration collection would.
		expect(isTable(tableInput)).toBe(true);
		expect(tableInput).toMatchObject({
			id: { sqlName: "id" },
			title: { sqlName: "title" },
		});
	});

	it("throws entry-not-found with the owner-approved single-pattern text verbatim", async () => {
		const cwd = join(fixturesDir, "entry-not-found");
		const { config, configPath } = await loadConfig(cwd, undefined);
		try {
			await loadDeclarations(configPath, config);
			throw new Error("expected loadDeclarations to throw");
		} catch (error) {
			expect(error).toMatchObject({
				code: "entry-not-found",
				message:
					'hejbro.config.ts\'s entry pattern "src/**/*.schema.ts" matched 0 files. Next: if this is a new project, create a declaration file (see the example below) and rerun `hejbro generate`; if you already have declarations, check the "entry" pattern in hejbro.config.ts for a typo.',
			});
		}
	});

	it("uses the count-based plural 'entry patterns' phrasing for 2+ patterns", async () => {
		const cwd = join(fixturesDir, "entry-not-found");
		const { configPath } = await loadConfig(cwd, undefined);
		try {
			await loadDeclarations(configPath, {
				entry: ["src/a.schema.ts", "src/b.schema.ts"],
				migrationsDir: "migrations",
				snapshotPath: "hejbro.snapshot.json",
				prefixStrategy: "timestamp",
				presets: [],
			});
			throw new Error("expected loadDeclarations to throw");
		} catch (error) {
			expect(error).toMatchObject({
				code: "entry-not-found",
				message:
					'hejbro.config.ts\'s entry patterns "src/a.schema.ts", "src/b.schema.ts" matched 0 files. Next: if this is a new project, create a declaration file (see the example below) and rerun `hejbro generate`; if you already have declarations, check the "entry" pattern in hejbro.config.ts for a typo.',
			});
		}
	});

	it("orders declarations deterministically by sorted file path, not directory-listing order", async () => {
		const cwd = join(fixturesDir, "ordering");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		expect(declarations.map(schemaNameOf)).toEqual(["a_schema", "z_schema"]);
	});

	it("preserves the module export name for each table", async () => {
		const cwd = join(fixturesDir, "basic");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		const tableInput = declarations.find(isTable);
		expect(tableInput).toBeDefined();
		expect(declarations.exportNames.get(tableInput as HejbroInput)).toBe(
			"posts",
		);
		// still an ordinary array — the addition is additive, not a new shape.
		expect(Array.isArray(declarations)).toBe(true);
		expect(declarations).toHaveLength(2);
	});

	// Characterization pin, green on arrival (add-unmanaged-objects, 2.2):
	// group 1 already landed the loader-relevant half of this change --
	// `loadDeclarations` collects every `isTable()` export regardless of
	// managed/existing, so this scenario required no loader code change
	// at all. Load-bearing anyway (proven by mutant, not by red): see this
	// file's own `.filter` in `loadDeclarations` (`src/loader.ts`).
	it("an exported existing table is loaded as a declaration", async () => {
		const cwd = join(fixturesDir, "existing-table");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		expect(declarations).toHaveLength(1);
		const [authUsersInput] = declarations;
		expect(isTable(authUsersInput as HejbroInput)).toBe(true);
		expect(declarations.exportNames.get(authUsersInput as HejbroInput)).toBe(
			"authUsers",
		);
	});
});

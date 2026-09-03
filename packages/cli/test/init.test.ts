import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
} from "./support/cli-runner";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-init-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const configPath = () => join(cwd, "hejbro.config.ts");
const snapshotPath = () => join(cwd, "hejbro.snapshot.json");

describe("runInit", () => {
	it("creates all three artifacts in a fresh directory and reports them created", async () => {
		const result = await runInit(cwd);
		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"created hejbro.config.ts",
			"created migrations/",
			"created hejbro.snapshot.json",
		]);
	});

	it("writes a hejbro.config.ts using defineConfig with the documented defaults", async () => {
		await runInit(cwd);
		const content = await readFile(configPath(), "utf8");
		expect(content).toContain('import { defineConfig } from "hejbro";');
		expect(content).toContain('entry: ["src/**/*.schema.ts"]');
		expect(content).toContain('migrationsDir: "migrations"');
		expect(content).toContain('snapshotPath: "hejbro.snapshot.json"');
		expect(content).toContain('prefixStrategy: "timestamp"');
		expect(content).toContain("presets: []");
	});

	it("writes the empty snapshot via renderSnapshot(emptySnapshot)", async () => {
		await runInit(cwd);
		const content = await readFile(snapshotPath(), "utf8");
		expect(content).toContain('"formatVersion": 8');
		expect(content).toContain('"objects": {}');
	});

	// The template init writes imports "hejbro", resolved by real Node
	// resolution -- this fixture needs a resolvable node_modules/hejbro,
	// as a real project has.
	describe("round-trip against the real scaffolded template", () => {
		beforeAll(assertBuiltCli);

		let cwd: string;
		const configPath = () => join(cwd, "hejbro.config.ts");
		const snapshotPath = () => join(cwd, "hejbro.snapshot.json");

		beforeEach(async () => {
			cwd = await createCliFixtureDir();
		});

		afterEach(async () => {
			await removeCliFixtureDir(cwd);
		});

		it("second run reports three skips, exits 0, and leaves files byte-identical", async () => {
			await runInit(cwd);
			const [configBefore, snapshotBefore] = await Promise.all([
				readFile(configPath(), "utf8"),
				readFile(snapshotPath(), "utf8"),
			]);

			const second = await runInit(cwd);
			expect(second.exitCode).toBe(0);
			expect(second.report).toEqual([
				"skipped hejbro.config.ts (exists)",
				"skipped migrations/ (exists)",
				"skipped hejbro.snapshot.json (exists)",
			]);

			const [configAfter, snapshotAfter] = await Promise.all([
				readFile(configPath(), "utf8"),
				readFile(snapshotPath(), "utf8"),
			]);
			expect(configAfter).toBe(configBefore);
			expect(snapshotAfter).toBe(snapshotBefore);
		});

		it("fills only the missing artifacts when some already exist", async () => {
			await runInit(cwd);
			await rm(snapshotPath());

			const result = await runInit(cwd);
			expect(result.exitCode).toBe(0);
			expect(result.report).toEqual([
				"skipped hejbro.config.ts (exists)",
				"skipped migrations/ (exists)",
				"created hejbro.snapshot.json",
			]);
		});
	});
});

describe("runInit / configured paths (#687)", () => {
	type ConfiguredDirRow = {
		readonly label: string;
		readonly configContent: string | null;
		readonly expectedRelativeDir: string;
		readonly expectedReportLine: string;
	};

	// D110 input table: absent config, config present but the field
	// omitted (falls back), a nested value, the same value with a
	// trailing slash, and a leading slash -- both spellings still land
	// under `join(cwd, value)` (D2 pin), never treated as absolute.
	const migrationsDirRows: ReadonlyArray<ConfiguredDirRow> = [
		{
			label: "no hejbro.config.ts",
			configContent: null,
			expectedRelativeDir: "migrations",
			expectedReportLine: "created migrations/",
		},
		{
			label: "config present, migrationsDir omitted",
			configContent: `export default { entry: ["src/**/*.schema.ts"] };\n`,
			expectedRelativeDir: "migrations",
			expectedReportLine: "created migrations/",
		},
		{
			label: 'migrationsDir: "db/migrations"',
			configContent: `export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/migrations" };\n`,
			expectedRelativeDir: "db/migrations",
			expectedReportLine: "created db/migrations/",
		},
		{
			label: 'migrationsDir: "db/migrations/"',
			configContent: `export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/migrations/" };\n`,
			expectedRelativeDir: "db/migrations",
			expectedReportLine: "created db/migrations/",
		},
		{
			label: 'migrationsDir: "/db/migrations"',
			configContent: `export default { entry: ["src/**/*.schema.ts"], migrationsDir: "/db/migrations" };\n`,
			expectedRelativeDir: "db/migrations",
			expectedReportLine: "created db/migrations/",
		},
	];

	it.each(migrationsDirRows)(
		"creates the migrations directory and reports it at the configured path ($label)",
		async ({ configContent, expectedRelativeDir, expectedReportLine }) => {
			if (configContent !== null) {
				await writeFile(configPath(), configContent);
			}
			const result = await runInit(cwd);
			expect(result.report).toContain(expectedReportLine);
			expect(existsSync(join(cwd, expectedRelativeDir))).toBe(true);
		},
	);

	type ConfiguredFileRow = {
		readonly label: string;
		readonly configContent: string | null;
		readonly expectedRelativeFile: string;
		readonly expectedReportLine: string;
	};

	const snapshotPathRows: ReadonlyArray<ConfiguredFileRow> = [
		{
			label: "no hejbro.config.ts",
			configContent: null,
			expectedRelativeFile: "hejbro.snapshot.json",
			expectedReportLine: "created hejbro.snapshot.json",
		},
		{
			label: "config present, snapshotPath omitted",
			configContent: `export default { entry: ["src/**/*.schema.ts"] };\n`,
			expectedRelativeFile: "hejbro.snapshot.json",
			expectedReportLine: "created hejbro.snapshot.json",
		},
		{
			label: 'snapshotPath: "db/hejbro.snapshot.json"',
			configContent: `export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/hejbro.snapshot.json" };\n`,
			expectedRelativeFile: "db/hejbro.snapshot.json",
			expectedReportLine: "created db/hejbro.snapshot.json",
		},
		{
			label: 'snapshotPath: "snap/state.json"',
			configContent: `export default { entry: ["src/**/*.schema.ts"], snapshotPath: "snap/state.json" };\n`,
			expectedRelativeFile: "snap/state.json",
			expectedReportLine: "created snap/state.json",
		},
		{
			label: 'snapshotPath: "/snap/state.json"',
			configContent: `export default { entry: ["src/**/*.schema.ts"], snapshotPath: "/snap/state.json" };\n`,
			expectedRelativeFile: "snap/state.json",
			expectedReportLine: "created snap/state.json",
		},
	];

	it.each(snapshotPathRows)(
		"creates the snapshot file and reports it at the configured path ($label)",
		async ({ configContent, expectedRelativeFile, expectedReportLine }) => {
			if (configContent !== null) {
				await writeFile(configPath(), configContent);
			}
			const result = await runInit(cwd);
			expect(result.report).toContain(expectedReportLine);
			expect(existsSync(join(cwd, expectedRelativeFile))).toBe(true);
		},
	);
});

describe("runInit / unreadable configuration (#687)", () => {
	type UnreadableConfigRow = {
		readonly label: string;
		readonly configContent: string;
		readonly expectedCode: string;
	};

	// Lead ruling (sealed): a configuration that exists but cannot be
	// read fails with the same coded diagnostic loadConfig already
	// raises for every other command -- no default-path fallback (that
	// would recreate #687's own defect through a different door) and no
	// new code minted.
	const rows: ReadonlyArray<UnreadableConfigRow> = [
		{
			label: "an import that does not resolve",
			configContent:
				'import { defineConfig } from "a-package-that-does-not-exist";\n\nexport default defineConfig({ entry: ["src/**/*.schema.ts"] });\n',
			expectedCode: "config-load-failed",
		},
		{
			label: "a default export that does not match the configuration shape",
			configContent: "export default { entry: 42 };\n",
			expectedCode: "invalid-config",
		},
	];

	it.each(rows)(
		"creates nothing when the configuration beside it cannot be read ($label)",
		async ({ configContent, expectedCode }) => {
			await writeFile(configPath(), configContent);
			const result = await runInit(cwd);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(`error[${expectedCode}]`);
			expect(existsSync(join(cwd, "migrations"))).toBe(false);
			expect(existsSync(snapshotPath())).toBe(false);
		},
	);
});

describe("runInit / repairs a partially present project at configured paths (#687)", () => {
	it("creates only the configured snapshot when the configured migrations directory exists", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/migrations", snapshotPath: "db/hejbro.snapshot.json", presets: [] };\n',
		);
		const migrationsDirPath = join(cwd, "db", "migrations");
		await mkdir(migrationsDirPath, { recursive: true });
		await writeFile(
			join(migrationsDirPath, "0001_a.sql"),
			"-- hejbro migration\n",
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"skipped hejbro.config.ts (exists)",
			"skipped db/migrations/ (exists)",
			"created db/hejbro.snapshot.json",
		]);
		expect(await readFile(join(migrationsDirPath, "0001_a.sql"), "utf8")).toBe(
			"-- hejbro migration\n",
		);
		const snapshotContent = await readFile(
			join(cwd, "db", "hejbro.snapshot.json"),
			"utf8",
		);
		expect(snapshotContent).toContain('"formatVersion": 8');
	});
});

import { existsSync, statSync } from "node:fs";
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

	// D110 input table: absent config (falls back to the default), a
	// nested value, the same value with a trailing slash, and a leading
	// slash -- both spellings still land under `join(cwd, value)` (D2
	// pin), never treated as absolute. "Config present, field omitted"
	// moved to the "not configured" describe below (D3 revision, 1.4).
	const migrationsDirRows: ReadonlyArray<ConfiguredDirRow> = [
		{
			label: "no hejbro.config.ts",
			configContent: null,
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

	// "Config present, field omitted" moved to the "not configured"
	// describe below (D3 revision, 1.4).
	const snapshotPathRows: ReadonlyArray<ConfiguredFileRow> = [
		{
			label: "no hejbro.config.ts",
			configContent: null,
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

describe("runInit / path-kind conflicts and unconfigured fields (#687)", () => {
	it("refuses when the configured snapshot path holds a directory", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/state.json" };\n',
		);
		await mkdir(join(cwd, "db", "state.json"), { recursive: true });

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[init-path-conflict]");
		// Nothing this run would have created exists -- the config file
		// itself is the fixture's own pre-existing setup, untouched.
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
		expect(statSync(join(cwd, "db", "state.json")).isDirectory()).toBe(true);
	});

	it("refuses when the configured migrations directory holds a file", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/migrations" };\n',
		);
		await mkdir(join(cwd, "db"), { recursive: true });
		await writeFile(join(cwd, "db", "migrations"), "not a directory");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[init-path-conflict]");
		expect(existsSync(snapshotPath())).toBe(false);
		expect(await readFile(join(cwd, "db", "migrations"), "utf8")).toBe(
			"not a directory",
		);
	});

	it("refuses when a snapshotPath spelled with a trailing slash holds a directory", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/" };\n',
		);
		await mkdir(join(cwd, "db"), { recursive: true });

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[init-path-conflict]");
	});

	it("refuses an empty snapshotPath, which resolves to the project directory itself", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[init-path-conflict]");
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
	});

	// Regression pin (reviewer-observed on 1bc19b32): an empty relative
	// label rendered as a bare "" in the refusal, leaving an empty
	// identifier and an unfollowable "move or remove ... at """ line --
	// the same D1 "./" fold the report line already applies must reach
	// the refusal label too.
	it.each(["", "."])(
		"names the project directory as ./ in the refusal, never a bare empty string (snapshotPath: %j)",
		async (emptyValue) => {
			await writeFile(
				configPath(),
				`export default { entry: ["src/**/*.schema.ts"], snapshotPath: ${JSON.stringify(emptyValue)} };\n`,
			);

			const result = await runInit(cwd);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("./");
			expect(result.stderr).not.toContain('""');
		},
	);

	it("refuses a snapshotPath spelled as a directory even when nothing sits there yet", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[init-path-conflict]");
		expect(existsSync(join(cwd, "db"))).toBe(false);
	});

	// Regression pin: before checkPathKind's pre-check, this exact
	// configuration reached createArtifact's writeFileSync and crashed
	// with a raw, unformatted ENOENT naming the absolute path -- runInit
	// now refuses it with the coded diagnostic instead, and that
	// diagnostic never names an absolute path (D57/Task 14 convention).
	it("this configuration no longer reaches the raw writeFileSync crash, and names no absolute path", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[init-path-conflict]");
		expect(result.stderr).not.toContain("ENOENT");
		expect(result.stderr).not.toContain(cwd);
	});

	it("a matching directory at the configured migrations path is skipped as today (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/migrations" };\n',
		);
		await mkdir(join(cwd, "db", "migrations"), { recursive: true });

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("skipped db/migrations/ (exists)");
	});

	it("a matching file at the configured snapshot path is skipped, byte-untouched (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/state.json" };\n',
		);
		await mkdir(join(cwd, "db"), { recursive: true });
		await writeFile(join(cwd, "db", "state.json"), "pre-existing content");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("skipped db/state.json (exists)");
		expect(await readFile(join(cwd, "db", "state.json"), "utf8")).toBe(
			"pre-existing content",
		);
	});

	it.each(["", "."])(
		"an empty migrationsDir (%j) resolves to the project directory itself, reported ./",
		async (emptyValue) => {
			await writeFile(
				configPath(),
				`export default { entry: ["src/**/*.schema.ts"], migrationsDir: ${JSON.stringify(emptyValue)} };\n`,
			);

			const result = await runInit(cwd);

			expect(result.exitCode).toBe(0);
			expect(result.report).toContain("skipped ./ (exists)");
		},
	);

	it("migrationsDir omitted from a present configuration creates nothing and reports not configured", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "hejbro.snapshot.json" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("migrationsDir not configured");
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
	});

	it("snapshotPath omitted from a present configuration creates nothing and reports not configured", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "migrations" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("snapshotPath not configured");
		expect(existsSync(snapshotPath())).toBe(false);
	});

	// No config file at all: both fields fall back to the defaults, as
	// the top-level "creates all three artifacts" test already pins --
	// restated here as the input table's own control row.
	it("with no config file at all, both artifacts are created at the defaults (control)", async () => {
		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"created hejbro.config.ts",
			"created migrations/",
			"created hejbro.snapshot.json",
		]);
	});
});

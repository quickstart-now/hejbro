import { existsSync, statSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
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

// D106 R1 B1: a configured migrations directory spelled with a trailing
// separator hid the file sitting there from checkPathKind's presence
// check (existsSync("mig/") on a file at "mig" is false), so the run
// reached mkdirSync's raw ENOTDIR crash instead of the coded refusal.
describe("runInit / a trailing separator does not hide the node at a configured path (D106 R1 B1)", () => {
	it.each(["mig/", "mig//"])(
		"refuses a configured migrations directory spelled %j when a file sits at mig",
		async (configuredValue) => {
			await writeFile(
				configPath(),
				`export default { entry: ["src/**/*.schema.ts"], migrationsDir: ${JSON.stringify(configuredValue)} };\n`,
			);
			await writeFile(join(cwd, "mig"), "not a directory");

			const result = await runInit(cwd);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(
				'error[init-path-conflict]: mig/\n  "mig/" was expected to be a directory for migrationsDir, but a file is there. Next: move or remove the existing file at "mig", then rerun `hejbro init`.',
			);
			expect(existsSync(snapshotPath())).toBe(false);
		},
	);

	it("refuses a configured migrations directory spelled with a trailing slash when a file sits at the nested path", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/mig/" };\n',
		);
		await mkdir(join(cwd, "db"), { recursive: true });
		await writeFile(join(cwd, "db", "mig"), "not a directory");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: db/mig/\n  "db/mig/" was expected to be a directory for migrationsDir, but a file is there. Next: move or remove the existing file at "db/mig", then rerun `hejbro init`.',
		);
		expect(existsSync(snapshotPath())).toBe(false);
	});

	it("still creates a configured migrations directory spelled with a trailing slash when nothing sits there (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig/" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("created mig/");
		expect(statSync(join(cwd, "mig")).isDirectory()).toBe(true);
	});

	it("still skips a configured migrations directory spelled with a trailing slash that already exists (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig/" };\n',
		);
		await mkdir(join(cwd, "mig"), { recursive: true });

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("skipped mig/ (exists)");
	});

	it("keeps the plain-spelled refusal message text unchanged (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig" };\n',
		);
		await writeFile(join(cwd, "mig"), "not a directory");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'"mig/" was expected to be a directory for migrationsDir, but a file is there.',
		);
	});
});

// D106 R1 N1: a file sitting in a configured path's ancestor chain (not
// the leaf itself) let mkdirSync's raw stack through, and in the
// snapshot-field variant had already created migrations/ before that
// crash -- the ancestor's own kind is now checked, before anything is
// created and before the leaf's own kind check (3.1), naming the actual
// blocking ancestor instead of the leaf.
describe("runInit / a file in a configured path's ancestor chain stops the run (D106 R1 N1)", () => {
	it("refuses when the configured snapshot path's own directory is a file", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/snap.json" };\n',
		);
		await writeFile(join(cwd, "db"), "not a directory");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: db\n  "db" was expected to be a directory to hold snapshotPath, but a file is there. Next: move or remove the existing file at "db", then rerun `hejbro init`.',
		);
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
	});

	it("refuses when the configured migrations directory's own parent is a file", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/mig" };\n',
		);
		await writeFile(join(cwd, "db"), "not a directory");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: db\n  "db" was expected to be a directory to hold migrationsDir, but a file is there. Next: move or remove the existing file at "db", then rerun `hejbro init`.',
		);
		expect(existsSync(snapshotPath())).toBe(false);
	});

	it("names the first non-directory ancestor on the way, not the leaf, when the file sits further up", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "a/b/c/snap.json" };\n',
		);
		await writeFile(join(cwd, "a"), "not a directory");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: a\n  "a" was expected to be a directory to hold snapshotPath, but a file is there. Next: move or remove the existing file at "a", then rerun `hejbro init`.',
		);
	});

	it("creates nothing at all when one field's ancestor is a file, even though the other field's own path is fine", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "migrations", snapshotPath: "db/snap.json" };\n',
		);
		await writeFile(join(cwd, "db"), "not a directory");

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
		expect(existsSync(join(cwd, "db", "snap.json"))).toBe(false);
	});

	it("a directory sitting at the configured snapshot path's own parent is unaffected (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/snap.json" };\n',
		);
		await mkdir(join(cwd, "db"), { recursive: true });

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("created db/snap.json");
	});

	it("an escaping path whose own ancestor is real and outside the project is unaffected (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "../out/mig" };\n',
		);

		try {
			const result = await runInit(cwd);

			expect(result.exitCode).toBe(0);
			expect(result.report).toContain("created ../out/mig/");
		} finally {
			await rm(join(cwd, "..", "out"), { recursive: true, force: true });
		}
	});
});

// D106 R1 N2: two configured fields resolving to the same path let the
// run create one artifact and then report the other as already present
// -- a repair run reading a broken project as whole. Resolved paths are
// compared before anything is created, not the raw spellings.
describe("runInit / a configuration whose fields resolve to the same path (D106 R1 N2)", () => {
	it("refuses a configuration whose fields resolve to the same path", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "migrations", snapshotPath: "migrations" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: migrations\n  "migrations" is named by both migrationsDir and snapshotPath. Next: point them at two different paths, then rerun `hejbro init`.',
		);
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
	});

	it("refuses the same shared path even when one field's spelling carries a trailing slash", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig/", snapshotPath: "mig" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: mig\n  "mig" is named by both migrationsDir and snapshotPath. Next: point them at two different paths, then rerun `hejbro init`.',
		);
	});

	it("refuses a snapshotPath that resolves to the configuration file itself", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "hejbro.config.ts" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: hejbro.config.ts\n  "hejbro.config.ts" is named by both hejbro.config.ts and snapshotPath. Next: point them at two different paths, then rerun `hejbro init`.',
		);
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
	});

	it("creates both artifacts when their configured paths differ (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "migrations", snapshotPath: "hejbro.snapshot.json" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("created migrations/");
		expect(result.report).toContain("created hejbro.snapshot.json");
	});

	it("reports both fields not configured when neither is set (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"] };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"skipped hejbro.config.ts (exists)",
			"migrationsDir not configured",
			"snapshotPath not configured",
		]);
	});
});

// D106 R1 N3: a directory sitting where hejbro.config.ts belongs reached
// the loader before its own kind was checked, so it failed as
// config-load-failed (an import-resolution diagnostic) instead of this
// command's own init-path-conflict.
describe("runInit / a directory sitting where the configuration file belongs (D106 R1 N3)", () => {
	it("refuses a directory sitting where the configuration file belongs", async () => {
		await mkdir(configPath(), { recursive: true });

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: hejbro.config.ts\n  "hejbro.config.ts" was expected to be a file for hejbro.config.ts, but a directory is there. Next: move or remove the existing directory at "hejbro.config.ts", then rerun `hejbro init`.',
		);
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
		expect(existsSync(snapshotPath())).toBe(false);
	});

	it("loads a readable configuration as today (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/migrations" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("created db/migrations/");
	});

	it("keeps config-load-failed unchanged for an unresolvable import (control)", async () => {
		await writeFile(
			configPath(),
			'import "nope-pkg-xyz";\nexport default { entry: ["src/**/*.schema.ts"] };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[config-load-failed]");
	});

	it("scaffolds as today when nothing sits at the configuration path (control)", async () => {
		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("created hejbro.config.ts");
	});
});

// #741, D1: init honours --config exactly as generate does -- the file it
// names is the one init reads (or writes), and the migrations directory
// and the snapshot stay resolved from the working directory regardless of
// where that file lives.
describe("runInit / --config (#741)", () => {
	it("honours --config: reads the configuration it names and scaffolds where its fields say (omitted, hejbro.config.ts present -- control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "migrations", snapshotPath: "hejbro.snapshot.json" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"skipped hejbro.config.ts (exists)",
			"created migrations/",
			"created hejbro.snapshot.json",
		]);
	});

	it("honours --config: --config hejbro.config.ts is identical to the omitted flag", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "migrations", snapshotPath: "hejbro.snapshot.json" };\n',
		);

		const result = await runInit(cwd, ["--config", "hejbro.config.ts"]);

		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"skipped hejbro.config.ts (exists)",
			"created migrations/",
			"created hejbro.snapshot.json",
		]);
	});

	it("honours --config: reads the configuration named by --config and scaffolds its fields under cwd, not under the flag's own directory", async () => {
		await mkdir(join(cwd, "sub"), { recursive: true });
		await writeFile(
			join(cwd, "sub", "hejbro.config.ts"),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/mig", snapshotPath: "db/state.json" };\n',
		);

		const result = await runInit(cwd, ["--config", "sub/hejbro.config.ts"]);

		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"skipped sub/hejbro.config.ts (exists)",
			"created db/mig/",
			"created db/state.json",
		]);
		expect(existsSync(join(cwd, "db", "mig"))).toBe(true);
		expect(existsSync(join(cwd, "db", "state.json"))).toBe(true);
		expect(existsSync(join(cwd, "sub", "migrations"))).toBe(false);
		expect(existsSync(join(cwd, "sub", "db"))).toBe(false);
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
		expect(existsSync(join(cwd, "hejbro.snapshot.json"))).toBe(false);
	});

	it("honours --config: writes the configuration at the named path when nothing sits there, and scaffolds the defaults under cwd", async () => {
		const result = await runInit(cwd, ["--config", "sub/hejbro.config.ts"]);

		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"created sub/hejbro.config.ts",
			"created migrations/",
			"created hejbro.snapshot.json",
		]);
		expect(existsSync(join(cwd, "sub", "hejbro.config.ts"))).toBe(true);
		expect(existsSync(configPath())).toBe(false);
	});

	it("honours --config: a relative --config that escapes cwd is read from there and reported by its own spelling", async () => {
		const otherDir = join(cwd, "..", "other");
		try {
			await mkdir(otherDir, { recursive: true });
			await writeFile(
				join(otherDir, "hejbro.config.ts"),
				'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig" };\n',
			);

			const result = await runInit(cwd, [
				"--config",
				"../other/hejbro.config.ts",
			]);

			expect(result.exitCode).toBe(0);
			expect(result.report).toContain(
				"skipped ../other/hejbro.config.ts (exists)",
			);
			expect(result.report).toContain("created mig/");
			expect(existsSync(join(cwd, "mig"))).toBe(true);
		} finally {
			await rm(otherDir, { recursive: true, force: true });
		}
	});

	it("honours --config: an escaping --config path with nothing there is written there, and the defaults still land under cwd", async () => {
		const otherDir = join(cwd, "..", "other");
		try {
			const result = await runInit(cwd, [
				"--config",
				"../other/hejbro.config.ts",
			]);

			expect(result.exitCode).toBe(0);
			expect(result.report).toEqual([
				"created ../other/hejbro.config.ts",
				"created migrations/",
				"created hejbro.snapshot.json",
			]);
			expect(existsSync(join(otherDir, "hejbro.config.ts"))).toBe(true);
		} finally {
			await rm(otherDir, { recursive: true, force: true });
		}
	});

	it("honours --config: an absolute --config path is honoured, and every report line names it relative to cwd", async () => {
		await mkdir(join(cwd, "sub"), { recursive: true });
		const absoluteConfigPath = join(cwd, "sub", "hejbro.config.ts");
		await writeFile(
			absoluteConfigPath,
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig" };\n',
		);

		const result = await runInit(cwd, ["--config", absoluteConfigPath]);

		expect(result.exitCode).toBe(0);
		expect(result.report).toContain("skipped sub/hejbro.config.ts (exists)");
		expect(result.report.join("\n")).not.toContain(cwd);
	});

	it("honours --config: a directory at the named path refuses with init-path-conflict, naming it, nothing created", async () => {
		await mkdir(join(cwd, "sub", "hejbro.config.ts"), { recursive: true });

		const result = await runInit(cwd, ["--config", "sub/hejbro.config.ts"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[init-path-conflict]");
		expect(result.stderr).toContain("sub/hejbro.config.ts");
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
		expect(existsSync(join(cwd, "hejbro.snapshot.json"))).toBe(false);
	});

	describe("subprocess rows (built CLI)", () => {
		beforeAll(assertBuiltCli);

		it("honours --config: matches generate's config-load-failed stderr byte-for-byte for the same unreadable file", async () => {
			await mkdir(join(cwd, "sub"), { recursive: true });
			await writeFile(
				join(cwd, "sub", "hejbro.config.ts"),
				'import "a-package-that-does-not-exist";\nexport default { entry: ["src/**/*.schema.ts"] };\n',
			);

			const initRun = await runCli(cwd, [
				"init",
				"--config",
				"sub/hejbro.config.ts",
			]);
			const generateRun = await runCli(cwd, [
				"generate",
				"--config",
				"sub/hejbro.config.ts",
			]);

			expect(initRun.exitCode).toBe(1);
			expect(initRun.stderr).toContain("error[config-load-failed]");
			expect(initRun.stderr).toBe(generateRun.stderr);
		});

		it("honours --config: --config=<path> is identical to the space form", async () => {
			await mkdir(join(cwd, "sub"), { recursive: true });
			await writeFile(
				join(cwd, "sub", "hejbro.config.ts"),
				'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/mig" };\n',
			);

			const equalsRun = await runCli(cwd, [
				"init",
				"--config=sub/hejbro.config.ts",
			]);

			expect(equalsRun.exitCode).toBe(0);
			expect(equalsRun.stdout).toContain(
				"skipped sub/hejbro.config.ts (exists)",
			);
			expect(equalsRun.stdout).toContain("created db/mig/");
		});

		it("honours --config: init then generate --config act on the same files (round-trip pin)", async () => {
			const fixtureCwd = await createCliFixtureDir();
			try {
				await mkdir(join(fixtureCwd, "sub"), { recursive: true });
				// `entry` resolves from the configuration file's own directory
				// (unaffected by this change, D1 fact -- #819), so the
				// declaration file lives beside it, in sub/.
				await writeFile(
					join(fixtureCwd, "sub", "hejbro.config.ts"),
					`import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["*.schema.ts"],
	migrationsDir: "db/mig",
	snapshotPath: "db/state.json",
	prefixStrategy: "timestamp",
	presets: [],
});
`,
				);
				await writeFile(
					join(fixtureCwd, "sub", "app.schema.ts"),
					`import { schema, table, uuid, text } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`,
				);

				const initRun = await runCli(fixtureCwd, [
					"init",
					"--config",
					"sub/hejbro.config.ts",
				]);
				expect(initRun.exitCode).toBe(0);

				const generateRun = await runCli(fixtureCwd, [
					"generate",
					"--config",
					"sub/hejbro.config.ts",
				]);
				expect(generateRun.exitCode).toBe(0);

				const migFiles = await readdir(join(fixtureCwd, "db", "mig"));
				expect(migFiles.length).toBeGreaterThan(0);
				const snapshotContent = await readFile(
					join(fixtureCwd, "db", "state.json"),
					"utf8",
				);
				expect(snapshotContent).toContain('"formatVersion"');
			} finally {
				await removeCliFixtureDir(fixtureCwd);
			}
		});
	});
});

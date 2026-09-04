import { existsSync, statSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
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
	// nested value, and the same value with a trailing slash. An
	// absolute-looking value is refused at config-read time instead
	// (#743, D2) -- see "runInit / an absolute-looking configured path
	// is refused" below. "Config present, field omitted" moved to the
	// "not configured" describe below (D3 revision, 1.4).
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

// #743, D2: an absolute-looking migrationsDir/snapshotPath used to be
// silently joined under cwd (`join(cwd, "/db/migrations")` swallows the
// leading "/"); parseConfig now refuses it before init creates anything.
describe("runInit / an absolute-looking configured path is refused (#743)", () => {
	it.each([
		{
			field: "migrationsDir",
			configContent: `export default { entry: ["src/**/*.schema.ts"], migrationsDir: "/db/migrations" };\n`,
		},
		{
			field: "snapshotPath",
			configContent: `export default { entry: ["src/**/*.schema.ts"], snapshotPath: "/snap/state.json" };\n`,
		},
	])(
		"refuses an absolute-looking configured path before creating anything ($field)",
		async ({ field, configContent }) => {
			await writeFile(configPath(), configContent);

			const result = await runInit(cwd);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[invalid-config]");
			expect(result.stderr).toContain(field);
			expect(existsSync(join(cwd, "migrations"))).toBe(false);
			expect(existsSync(join(cwd, "db"))).toBe(false);
			expect(existsSync(snapshotPath())).toBe(false);
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

	// #846 D1: a snapshotPath spelled as a directory is now refused when
	// the configuration is read (invalid-config), before init ever looks
	// at what sits on disk -- moved from init-path-conflict.
	it("refuses a snapshotPath spelled with a trailing slash at config read, before looking at disk", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/" };\n',
		);
		await mkdir(join(cwd, "db"), { recursive: true });

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-config]");
	});

	// #846 D1: moved from init-path-conflict -- an empty snapshotPath is
	// refused at config read, before any artifact is planned.
	it("refuses an empty snapshotPath at config read, before any artifact is planned", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-config]");
		expect(existsSync(join(cwd, "migrations"))).toBe(false);
	});

	// Regression pin (reviewer-observed on 1bc19b32): an empty relative
	// label used to render as a bare "" in the refusal, leaving an
	// unfollowable "move or remove ... at """ line. #846 D1 moves both
	// values to the config-read refusal (invalid-config) before runInit
	// ever builds a label from them, so that code path is unreachable for
	// these two inputs now -- the pin stays here as the same regression's
	// guard, just aimed at config.ts's own message instead.
	it.each(["", "."])(
		"refuses at config read without ever printing a bare empty string (snapshotPath: %j)",
		async (emptyValue) => {
			await writeFile(
				configPath(),
				`export default { entry: ["src/**/*.schema.ts"], snapshotPath: ${JSON.stringify(emptyValue)} };\n`,
			);

			const result = await runInit(cwd);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[invalid-config]");
			expect(result.stderr).toContain("snapshotPath");
			expect(result.stderr).toContain("Next:");
			expect(result.stderr).not.toContain('""');
		},
	);

	// #846 D1: moved from init-path-conflict, same reasoning as the row
	// above -- the spelling is refused at config read regardless of what
	// (if anything) sits on disk.
	it("refuses a snapshotPath spelled as a directory at config read even when nothing sits there yet", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-config]");
		expect(existsSync(join(cwd, "db"))).toBe(false);
	});

	// Regression pin: before this refusal existed, this exact
	// configuration reached createArtifact's writeFileSync and crashed
	// with a raw, unformatted ENOENT naming the absolute path -- runInit
	// now refuses it with the coded diagnostic instead (#846 D1: at
	// config read, invalid-config), and that diagnostic never names an
	// absolute path (D57/Task 14 convention).
	it("this configuration no longer reaches the raw writeFileSync crash, and names no absolute path", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "db/" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-config]");
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

// #768, D4: `stat`'s EACCES/EPERM is always a directory on the way, never
// the leaf a mode-000 node can still be stat'd. The refusal used to name
// the leaf (or the first ancestor segment walked), which for a deeper
// path (nx/a/mig, nx mode 000) named nx/a -- an innocent, existing
// directory -- instead of nx, the one whose permissions actually block
// the look-up.
describe.skipIf(process.getuid?.() === 0)(
	"runInit / names the ancestor whose permissions block the check, never the missing leaf (#768)",
	() => {
		// Registered in this describe so it runs before the file-level
		// afterEach's `rm(cwd, ...)` (vitest unwinds afterEach hooks
		// inside-out) -- a still-mode-000 `nx` would otherwise make its own
		// removal fail.
		afterEach(async () => {
			await Promise.all(
				["nx", "ro", "mig"].map(async (name) => {
					const candidate = join(cwd, name);
					if (!existsSync(candidate)) {
						return;
					}
					await chmod(candidate, 0o755);
				}),
			);
		});

		type PermissionRow = {
			readonly label: string;
			readonly configContent: string;
			readonly setup: (fixtureCwd: string) => Promise<void>;
			readonly assert: (result: Awaited<ReturnType<typeof runInit>>) => void;
		};

		const expectBlockedRefusal = (
			result: Awaited<ReturnType<typeof runInit>>,
			culprit: string,
		): void => {
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[init-path-conflict]");
			expect(result.stderr).toContain(`(EACCES): "${culprit}" does not`);
			expect(result.stderr).toContain(
				`Next: check permissions on "${culprit}", then rerun \`hejbro init\`.`,
			);
		};

		const rows: ReadonlyArray<PermissionRow> = [
			{
				label: 'migrationsDir: "nx/mig", nx mode 000',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "nx/mig" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "nx"), { recursive: true });
					await chmod(join(fixtureCwd, "nx"), 0o000);
				},
				assert: (result) => expectBlockedRefusal(result, "nx"),
			},
			{
				label:
					'migrationsDir: "nx/a/mig", nx mode 000 (the walk continues past the EACCES at nx/a)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "nx/a/mig" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "nx", "a"), { recursive: true });
					await chmod(join(fixtureCwd, "nx"), 0o000);
				},
				assert: (result) => expectBlockedRefusal(result, "nx"),
			},
			{
				label: 'snapshotPath: "nx/state.json", nx mode 000',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "nx/state.json" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "nx"), { recursive: true });
					await chmod(join(fixtureCwd, "nx"), 0o000);
				},
				assert: (result) => expectBlockedRefusal(result, "nx"),
			},
			{
				label:
					'migrationsDir: "nx/mig", nx/mig created then nx mode 000 (an existing leaf is no different)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "nx/mig" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "nx", "mig"), { recursive: true });
					await chmod(join(fixtureCwd, "nx"), 0o000);
				},
				assert: (result) => expectBlockedRefusal(result, "nx"),
			},
			{
				label:
					'migrationsDir: "ro/mig", ro mode 555 holding mig (control: read-only is inspectable)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "ro/mig" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "ro", "mig"), { recursive: true });
					await chmod(join(fixtureCwd, "ro"), 0o555);
				},
				assert: (result) => {
					expect(result.exitCode).toBe(0);
					expect(result.report).toContain("skipped ro/mig/ (exists)");
				},
			},
			{
				label:
					'migrationsDir: "loop/mig", loop a symlink to itself (control: a non-permission code keeps the failing node)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "loop/mig" };\n',
				setup: async (fixtureCwd) => {
					await symlink("loop", join(fixtureCwd, "loop"));
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					// D8 (#767 review, non-blocking 3, approved): a loop is not
					// a permission -- the non-permission branch of
					// throwStatFailed's Next: now says "check what ... points
					// at", not "check permissions on".
					expect(result.stderr).toBe(
						'error[init-path-conflict]: loop\n  "loop" could not be checked for migrationsDir (ELOOP). Next: check what "loop" points at, then rerun `hejbro init`.',
					);
				},
			},
			{
				label:
					'migrationsDir: "mig", a regular file at mig, mode 000 (control: stat needs no permission on the node itself)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig" };\n',
				setup: async (fixtureCwd) => {
					await writeFile(join(fixtureCwd, "mig"), "not a directory");
					await chmod(join(fixtureCwd, "mig"), 0o000);
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain(
						'"mig/" was expected to be a directory for migrationsDir, but a file is there.',
					);
				},
			},
		];

		it.each(rows)(
			"names the ancestor whose permissions block the check, never the missing leaf ($label)",
			async ({ configContent, setup, assert }) => {
				await writeFile(configPath(), configContent);
				await setup(cwd);

				const result = await runInit(cwd);

				assert(result);
			},
		);

		it("pins the exact message for the canonical case (nx/a/mig, nx mode 000)", async () => {
			await writeFile(
				configPath(),
				'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "nx/a/mig" };\n',
			);
			await mkdir(join(cwd, "nx", "a"), { recursive: true });
			await chmod(join(cwd, "nx"), 0o000);

			const result = await runInit(cwd);

			expect(result.stderr).toBe(
				'error[init-path-conflict]: nx/a/mig/\n  "nx/a/mig/" could not be checked for migrationsDir (EACCES): "nx" does not let this process look inside it. Next: check permissions on "nx", then rerun `hejbro init`.',
			);
		});
	},
);

// #767 review round 1, D8: `statSync` follows a symbolic link -- a
// dangling one stats ENOENT and reads as absent, so init used to write
// straight through it instead of refusing. `lstatSync` sees the link
// itself; a link to a real node keeps today's behaviour, judged by the
// target's kind.
describe("runInit / a dangling symbolic link at an artifact path (#767, D8)", () => {
	type DanglingLinkRow = {
		readonly label: string;
		readonly configContent: string;
		readonly setup: (fixtureCwd: string) => Promise<void>;
		readonly assert: (
			result: Awaited<ReturnType<typeof runInit>>,
			fixtureCwd: string,
		) => Promise<void> | void;
	};

	const rows: ReadonlyArray<DanglingLinkRow> = [
		{
			label: 'snapshotPath: "state.json" -> nowhere (absent)',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "state.json" };\n',
			setup: async (fixtureCwd) => {
				await symlink("nowhere", join(fixtureCwd, "state.json"));
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[init-path-conflict]");
				expect(result.stderr).toContain("state.json");
				expect(result.stderr).toContain("nowhere");
				expect(result.report).toEqual([]);
				expect(existsSync(join(fixtureCwd, "nowhere"))).toBe(false);
			},
		},
		{
			label: 'migrationsDir: "mig" -> nowhere',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig" };\n',
			setup: async (fixtureCwd) => {
				await symlink("nowhere", join(fixtureCwd, "mig"));
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[init-path-conflict]");
				expect(result.stderr).toContain("mig/");
				expect(result.stderr).toContain("nowhere");
				expect(existsSync(join(fixtureCwd, "nowhere"))).toBe(false);
			},
		},
		{
			label: 'snapshotPath: "lnk/state.json", lnk -> nowhere (ancestor)',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "lnk/state.json" };\n',
			setup: async (fixtureCwd) => {
				await symlink("nowhere", join(fixtureCwd, "lnk"));
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[init-path-conflict]");
				expect(result.stderr).toContain("lnk");
				expect(result.stderr).toContain("nowhere");
				expect(existsSync(join(fixtureCwd, "nowhere"))).toBe(false);
			},
		},
		{
			label:
				'snapshotPath: "state.json" -> real.json (control: a link to a regular file is honoured)',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "state.json" };\n',
			setup: async (fixtureCwd) => {
				await writeFile(join(fixtureCwd, "real.json"), "pre-existing content");
				await symlink("real.json", join(fixtureCwd, "state.json"));
			},
			assert: async (result, fixtureCwd) => {
				expect(result.exitCode).toBe(0);
				expect(result.report).toContain("skipped state.json (exists)");
				expect(await readFile(join(fixtureCwd, "real.json"), "utf8")).toBe(
					"pre-existing content",
				);
			},
		},
		{
			label:
				'snapshotPath: "state.json" -> realdir/ (control: wrong-kind refusal unchanged)',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "state.json" };\n',
			setup: async (fixtureCwd) => {
				await mkdir(join(fixtureCwd, "realdir"), { recursive: true });
				await symlink("realdir", join(fixtureCwd, "state.json"));
			},
			assert: (result) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(
					"was expected to be a file for snapshotPath, but a directory is there.",
				);
			},
		},
		{
			label:
				'migrationsDir: "mig" -> realdir/ (control: a link to a real directory is honoured)',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig" };\n',
			setup: async (fixtureCwd) => {
				await mkdir(join(fixtureCwd, "realdir"), { recursive: true });
				await symlink("realdir", join(fixtureCwd, "mig"));
			},
			assert: (result) => {
				expect(result.exitCode).toBe(0);
				expect(result.report).toContain("skipped mig/ (exists)");
			},
		},
		{
			label:
				'migrationsDir: "mig" -> real.json (control: wrong-kind refusal unchanged)',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig" };\n',
			setup: async (fixtureCwd) => {
				await writeFile(join(fixtureCwd, "real.json"), "not a directory");
				await symlink("real.json", join(fixtureCwd, "mig"));
			},
			assert: (result) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(
					"was expected to be a directory for migrationsDir, but a file is there.",
				);
			},
		},
		{
			label:
				'migrationsDir: "loop", loop -> loop (control: a loop is not a permission)',
			configContent:
				'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "loop" };\n',
			setup: async (fixtureCwd) => {
				await symlink("loop", join(fixtureCwd, "loop"));
			},
			assert: (result) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("(ELOOP)");
				expect(result.stderr).toContain('Next: check what "loop/" points at');
				expect(result.stderr).not.toContain("permissions");
			},
		},
	];

	it.each(rows)(
		"refuses a dangling symbolic link at an artifact path instead of writing through it ($label)",
		async ({ configContent, setup, assert }) => {
			await writeFile(configPath(), configContent);
			await setup(cwd);

			const result = await runInit(cwd);

			await assert(result, cwd);
		},
	);

	it("pins the exact message for a dangling link at the artifact's own leaf", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "state.json" };\n',
		);
		await symlink("nowhere", join(cwd, "state.json"));

		const result = await runInit(cwd);

		expect(result.stderr).toBe(
			'error[init-path-conflict]: state.json\n  "state.json" was expected to be a file for snapshotPath, but a dangling symbolic link is there, pointing at "nowhere". Next: remove the link or create its target, then rerun `hejbro init`.',
		);
	});

	it("pins the exact message for a dangling link sitting in the ancestor chain", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "lnk/state.json" };\n',
		);
		await symlink("nowhere", join(cwd, "lnk"));

		const result = await runInit(cwd);

		expect(result.stderr).toBe(
			'error[init-path-conflict]: lnk\n  "lnk" was expected to be a directory to hold snapshotPath, but a dangling symbolic link is there, pointing at "nowhere". Next: remove the link or create its target, then rerun `hejbro init`.',
		);
	});
});

// #767 review round 1, D6 (check side): the check stage stats; the create
// stage had no diagnostic at all -- a parent with mode 555 passed every
// stat and `writeFileSync`/`mkdirSync` threw a raw EACCES, sometimes
// after another artifact was already created. A refused run must create
// nothing.
describe.skipIf(process.getuid?.() === 0)(
	"runInit / refuses a parent the process cannot write into, and creates nothing (#767, D6)",
	() => {
		// Registered here so it runs before the file-level afterEach's own
		// `rm(cwd, ...)` (vitest unwinds afterEach hooks inside-out) -- a
		// still-mode-555 directory (or cwd itself) would otherwise make
		// that removal fail.
		afterEach(async () => {
			await Promise.all(
				["ro", "nx"].map(async (name) => {
					const candidate = join(cwd, name);
					if (!existsSync(candidate)) {
						return;
					}
					await chmod(candidate, 0o755);
				}),
			);
			await chmod(cwd, 0o755);
		});

		type NotWritableRow = {
			readonly label: string;
			readonly configContent: string | null;
			readonly setup: (fixtureCwd: string) => Promise<void>;
			readonly assert: (
				result: Awaited<ReturnType<typeof runInit>>,
				fixtureCwd: string,
			) => void;
		};

		const rows: ReadonlyArray<NotWritableRow> = [
			{
				label:
					'migrationsDir: "mig", snapshotPath: "ro/state.json", ro mode 555',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig", snapshotPath: "ro/state.json" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "ro"), { recursive: true });
					await chmod(join(fixtureCwd, "ro"), 0o555);
				},
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[init-path-conflict]");
					expect(result.stderr).toContain("(EACCES)");
					expect(result.stderr).toContain(
						'"ro" does not let this process write into it',
					);
					expect(result.stderr).toContain('Next: check permissions on "ro"');
					expect(result.stderr).not.toContain(fixtureCwd);
					expect(existsSync(join(fixtureCwd, "mig"))).toBe(false);
				},
			},
			{
				label: 'migrationsDir: "nx/a/mig", nx mode 555 (deepest existing dir)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "nx/a/mig" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "nx"), { recursive: true });
					await chmod(join(fixtureCwd, "nx"), 0o555);
				},
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[init-path-conflict]");
					expect(result.stderr).toContain("(EACCES)");
					expect(result.stderr).toContain(
						'"nx" does not let this process write into it',
					);
					expect(result.stderr).toContain('Next: check permissions on "nx"');
					expect(result.stderr).not.toContain(fixtureCwd);
					expect(existsSync(join(fixtureCwd, "nx", "a"))).toBe(false);
				},
			},
			{
				label:
					'snapshotPath: "ro/state.json", ro 555 and ro/state.json present (control: nothing to create)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "ro/state.json" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "ro"), { recursive: true });
					await writeFile(
						join(fixtureCwd, "ro", "state.json"),
						"pre-existing content",
					);
					await chmod(join(fixtureCwd, "ro"), 0o555);
				},
				assert: (result) => {
					expect(result.exitCode).toBe(0);
					expect(result.report).toContain("skipped ro/state.json (exists)");
				},
			},
			{
				label: "no config, cwd mode 555",
				configContent: null,
				setup: async (fixtureCwd) => {
					await chmod(fixtureCwd, 0o555);
				},
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[init-path-conflict]");
					expect(result.stderr).toContain("(EACCES)");
					expect(result.stderr).toContain(
						'"./" does not let this process write into it',
					);
					expect(result.stderr).toContain('Next: check permissions on "./"');
					expect(existsSync(join(fixtureCwd, "hejbro.config.ts"))).toBe(false);
					expect(existsSync(join(fixtureCwd, "migrations"))).toBe(false);
				},
			},
			{
				label: 'migrationsDir: "rw/mig", rw mode 755 (control)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "rw/mig" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "rw"), { recursive: true });
				},
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(0);
					expect(result.report).toContain("created rw/mig/");
					expect(existsSync(join(fixtureCwd, "rw", "mig"))).toBe(true);
				},
			},
		];

		it.each(rows)(
			"refuses a parent the process cannot write into, and creates nothing ($label)",
			async ({ configContent, setup, assert }) => {
				if (configContent !== null) {
					await writeFile(configPath(), configContent);
				}
				await setup(cwd);

				const result = await runInit(cwd);

				assert(result, cwd);
			},
		);
	},
);

// #767 review round 1, D6 (create side): `access` can be wrong (ACLs,
// immutable flags, a disk that fills, a race) -- the check pass above
// cannot prove a node that doesn't exist yet will stay writable once
// this run creates it. `process.umask(0o277)` makes a directory
// `mkdirSync` creates unwritable by its own owner, deterministically
// reproducing exactly that gap.
describe.skipIf(process.getuid?.() === 0)(
	"runInit / undoes what it created when a creation fails part-way, and reports it coded (#767, D6)",
	() => {
		// A fixed restore, not "whatever it was before": every row sets
		// its own umask explicitly, so there is nothing to remember.
		afterEach(() => {
			process.umask(0o022);
		});

		type RollbackRow = {
			readonly label: string;
			readonly configContent: string;
			readonly setup: (fixtureCwd: string) => Promise<void>;
			readonly umask: number;
			readonly assert: (
				result: Awaited<ReturnType<typeof runInit>>,
				fixtureCwd: string,
			) => Promise<void> | void;
		};

		const rows: ReadonlyArray<RollbackRow> = [
			{
				label: 'migrationsDir: "x/mig" (nothing exists)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "x/mig" };\n',
				setup: async () => {},
				umask: 0o277,
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[init-path-conflict]");
					expect(result.stderr).toContain("(EACCES)");
					expect(result.stderr).toContain(
						'"x" does not let this process write into it',
					);
					expect(result.stderr).toContain('Next: check permissions on "x"');
					expect(result.stderr).not.toContain(fixtureCwd);
					expect(existsSync(join(fixtureCwd, "x"))).toBe(false);
				},
			},
			{
				label:
					'migrationsDir: "mig", snapshotPath: "y/state.json" (mig/ created fine, y fails)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig", snapshotPath: "y/state.json" };\n',
				setup: async () => {},
				umask: 0o277,
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[init-path-conflict]");
					expect(result.stderr).toContain("(EACCES)");
					expect(existsSync(join(fixtureCwd, "mig"))).toBe(false);
					expect(existsSync(join(fixtureCwd, "y"))).toBe(false);
				},
			},
			{
				label:
					'migrationsDir: "mig" already present holding 0001_x.sql, snapshotPath: "y/state.json"',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig", snapshotPath: "y/state.json" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "mig"), { recursive: true });
					await writeFile(
						join(fixtureCwd, "mig", "0001_x.sql"),
						"-- hejbro migration\n",
					);
				},
				umask: 0o277,
				assert: async (result, fixtureCwd) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[init-path-conflict]");
					expect(existsSync(join(fixtureCwd, "y"))).toBe(false);
					expect(existsSync(join(fixtureCwd, "mig"))).toBe(true);
					expect(
						await readFile(join(fixtureCwd, "mig", "0001_x.sql"), "utf8"),
					).toBe("-- hejbro migration\n");
				},
			},
			{
				label:
					'migrationsDir: "db/mig/inner", db already present (db/mig created then inner fails, db stays)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "db/mig/inner" };\n',
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "db"), { recursive: true });
				},
				umask: 0o277,
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[init-path-conflict]");
					expect(result.stderr).toContain("(EACCES)");
					expect(existsSync(join(fixtureCwd, "db", "mig"))).toBe(false);
					expect(existsSync(join(fixtureCwd, "db"))).toBe(true);
				},
			},
			{
				label: 'umask 0o022, migrationsDir: "x/mig" (control)',
				configContent:
					'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "x/mig" };\n',
				setup: async () => {},
				umask: 0o022,
				assert: (result, fixtureCwd) => {
					expect(result.exitCode).toBe(0);
					expect(result.report).toContain("created x/mig/");
					expect(existsSync(join(fixtureCwd, "x", "mig"))).toBe(true);
				},
			},
		];

		it.each(rows)(
			"undoes what it created when a creation fails part-way, and reports it coded ($label)",
			async ({ configContent, setup, umask, assert }) => {
				await writeFile(configPath(), configContent);
				await setup(cwd);
				process.umask(umask);

				const result = await runInit(cwd);

				await assert(result, cwd);
			},
		);
	},
);

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

// #766, D3: checkNoDuplicatePaths only ever compared for equality, so a
// planned file that is a strict ancestor of another planned path (the
// migrations directory nested inside the snapshot file's own path)
// passed every pre-creation check -- init created the directory, then
// reported the snapshot as already present (the directory it just made).
// The nesting fault is in the configuration itself, so it answers before
// any disk-based check, whatever already sits on disk (rows 8/9 below).
describe("runInit / a planned file that would have to hold another planned path (#766)", () => {
	type NestedPathRow = {
		readonly label: string;
		readonly migrationsDir: string;
		readonly snapshotPath: string;
		readonly onDisk: "nothing" | "dir-at-mig" | "file-at-mig";
		readonly outcome: "nested-refusal" | "created-both" | "duplicate-refusal";
	};

	const nestedPathRows: ReadonlyArray<NestedPathRow> = [
		{
			label: 'migrationsDir: "mig/sub", snapshotPath: "mig"',
			migrationsDir: "mig/sub",
			snapshotPath: "mig",
			onDisk: "nothing",
			outcome: "nested-refusal",
		},
		{
			label: 'migrationsDir: "snap.json/mig", snapshotPath: "snap.json"',
			migrationsDir: "snap.json/mig",
			snapshotPath: "snap.json",
			onDisk: "nothing",
			outcome: "nested-refusal",
		},
		{
			label: 'migrationsDir: "a/b/c", snapshotPath: "a" (any depth)',
			migrationsDir: "a/b/c",
			snapshotPath: "a",
			onDisk: "nothing",
			outcome: "nested-refusal",
		},
		{
			// #846 D1: snapshotPath can no longer be spelled with a trailing
			// separator at all (refused at config read before this check
			// runs) -- migrationsDir keeps that spelling, so its own
			// normalization is still the row's point.
			label:
				'migrationsDir: "mig/sub/", snapshotPath: "mig" (migrationsDir spelling, not string)',
			migrationsDir: "mig/sub/",
			snapshotPath: "mig",
			onDisk: "nothing",
			outcome: "nested-refusal",
		},
		{
			label: 'migrationsDir: "./mig/sub", snapshotPath: "mig"',
			migrationsDir: "./mig/sub",
			snapshotPath: "mig",
			onDisk: "nothing",
			outcome: "nested-refusal",
		},
		{
			label:
				'migrationsDir: "mig", snapshotPath: "mig/state.json" (control: a directory holds a file)',
			migrationsDir: "mig",
			snapshotPath: "mig/state.json",
			onDisk: "nothing",
			outcome: "created-both",
		},
		{
			label:
				'migrationsDir: "migrations", snapshotPath: "migrations-state.json" (control: a shared prefix is not nesting)',
			migrationsDir: "migrations",
			snapshotPath: "migrations-state.json",
			onDisk: "nothing",
			outcome: "created-both",
		},
		{
			label:
				'migrationsDir: "mig/sub", snapshotPath: "mig", a directory at mig (the configuration is at fault whatever sits on disk)',
			migrationsDir: "mig/sub",
			snapshotPath: "mig",
			onDisk: "dir-at-mig",
			outcome: "nested-refusal",
		},
		{
			label:
				'migrationsDir: "mig/sub", snapshotPath: "mig", a regular file at mig (before the ancestor check)',
			migrationsDir: "mig/sub",
			snapshotPath: "mig",
			onDisk: "file-at-mig",
			outcome: "nested-refusal",
		},
		{
			label:
				'migrationsDir: "same", snapshotPath: "same" (control: the duplicate refusal, unchanged)',
			migrationsDir: "same",
			snapshotPath: "same",
			onDisk: "nothing",
			outcome: "duplicate-refusal",
		},
	];

	it.each(nestedPathRows)(
		"refuses a configuration whose snapshot path would have to hold the migrations directory ($label)",
		async ({
			migrationsDir,
			snapshotPath: snapshotPathValue,
			onDisk,
			outcome,
		}) => {
			await writeFile(
				configPath(),
				`export default { entry: ["src/**/*.schema.ts"], migrationsDir: ${JSON.stringify(migrationsDir)}, snapshotPath: ${JSON.stringify(snapshotPathValue)} };\n`,
			);
			if (onDisk === "dir-at-mig") {
				await mkdir(join(cwd, "mig"), { recursive: true });
			}
			if (onDisk === "file-at-mig") {
				await writeFile(join(cwd, "mig"), "not a directory");
			}

			const result = await runInit(cwd);

			if (outcome === "created-both") {
				expect(result.exitCode).toBe(0);
				return;
			}
			expect(result.exitCode).toBe(1);
			// A refusal's report is always [] (runInit's own catch) -- this
			// doubles as "nothing created" and "no skipped line" for every
			// refusal row in this table.
			expect(result.report).toEqual([]);
			if (outcome === "duplicate-refusal") {
				expect(result.stderr).toBe(
					'error[init-path-conflict]: same\n  "same" is named by both migrationsDir and snapshotPath. Next: point them at two different paths, then rerun `hejbro init`.',
				);
				return;
			}
			expect(result.stderr).toContain("error[init-path-conflict]");
			expect(result.stderr).toContain("migrationsDir");
			expect(result.stderr).toContain("snapshotPath");
			expect(result.stderr).toContain("cannot hold a directory");
		},
	);

	it("names the exact labels and both fields for the canonical nested case", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "mig/sub", snapshotPath: "mig" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: mig\n  "mig" is named by snapshotPath, and migrationsDir ("mig/sub") would have to be created inside it — a file cannot hold a directory. Next: point snapshotPath at a file outside migrationsDir, then rerun `hejbro init`.',
		);
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
			'error[init-path-conflict]: hejbro.config.ts\n  "hejbro.config.ts" is the configuration path, but a directory is there — the configuration is a file hejbro reads. Next: move or remove the existing directory at "hejbro.config.ts", or name another file with --config, then rerun `hejbro init`.',
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

// #846 D5 phrasing/D6 (#831, NB5): the configuration path's own name
// used to appear twice ("... for hejbro.config.ts"), and a planned file
// that would have to hold another planned artifact always said "a file
// cannot hold a directory", wrong whenever the held artifact was itself
// a file (the configuration, or a snapshotPath nested inside it).
describe("runInit / the configuration path's own messages (#846 D5 phrasing, D6)", () => {
	it("describes a directory at --config as the configuration path, naming it once", async () => {
		await mkdir(join(cwd, "sub", "h.ts"), { recursive: true });

		const result = await runInit(cwd, ["--config", "sub/h.ts"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: sub/h.ts\n  "sub/h.ts" is the configuration path, but a directory is there — the configuration is a file hejbro reads. Next: move or remove the existing directory at "sub/h.ts", or name another file with --config, then rerun `hejbro init`.',
		);
	});

	it("refuses a snapshotPath nested inside the configuration path, naming the held kind (file)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "hejbro.config.ts/state.json" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: hejbro.config.ts\n  "hejbro.config.ts" is the configuration path, and snapshotPath ("hejbro.config.ts/state.json") would have to be created inside it — a file cannot hold a file. Next: point snapshotPath outside "hejbro.config.ts", then rerun `hejbro init`.',
		);
	});

	it("refuses a migrationsDir nested inside the configuration path, naming the held kind (directory)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "hejbro.config.ts/mig" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: hejbro.config.ts\n  "hejbro.config.ts" is the configuration path, and migrationsDir ("hejbro.config.ts/mig") would have to be created inside it — a file cannot hold a directory. Next: point migrationsDir outside "hejbro.config.ts", then rerun `hejbro init`.',
		);
	});

	it("refuses the configuration path nested inside snapshotPath, naming --config and snapshotPath in Next:", async () => {
		// The configuration file itself must be readable to know its own
		// snapshotPath field -- "state.json" is a real directory holding
		// it, which is exactly the nesting this run refuses.
		await mkdir(join(cwd, "state.json"), { recursive: true });
		await writeFile(
			join(cwd, "state.json", "h.ts"),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "state.json" };\n',
		);

		const result = await runInit(cwd, ["--config", "state.json/h.ts"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: state.json\n  "state.json" is named by snapshotPath, and the configuration path ("state.json/h.ts") would have to be created inside it — a file cannot hold a file. Next: name a configuration file outside snapshotPath with --config, or point snapshotPath elsewhere, then rerun `hejbro init`.',
		);
	});

	// Control: neither side is the configuration artifact -- the existing
	// sentence (D106 R1 N1) stays byte-unchanged.
	it("keeps the existing nested sentence byte-unchanged when neither side is the configuration artifact (control)", async () => {
		await writeFile(
			configPath(),
			'export default { entry: ["src/**/*.schema.ts"], snapshotPath: "mig", migrationsDir: "mig/sub" };\n',
		);

		const result = await runInit(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			'error[init-path-conflict]: mig\n  "mig" is named by snapshotPath, and migrationsDir ("mig/sub") would have to be created inside it — a file cannot hold a directory. Next: point snapshotPath at a file outside migrationsDir, then rerun `hejbro init`.',
		);
	});

	describe("subprocess rows (built CLI) — parity with generate's config-not-a-file", () => {
		beforeAll(assertBuiltCli);

		it("matches generate's first sentence for a directory at the default configuration path", async () => {
			await mkdir(join(cwd, "hejbro.config.ts"), { recursive: true });

			const initRun = await runCli(cwd, ["init"]);
			const generateRun = await runCli(cwd, ["generate"]);

			expect(initRun.exitCode).toBe(1);
			expect(generateRun.exitCode).toBe(1);
			expect(initRun.stderr).toContain("error[init-path-conflict]");
			expect(generateRun.stderr).toContain("error[config-not-a-file]");
			const firstSentence =
				'"hejbro.config.ts" is the configuration path, but a directory is there — the configuration is a file hejbro reads.';
			expect(initRun.stderr).toContain(firstSentence);
			expect(generateRun.stderr).toContain(firstSentence);
		});

		it("matches generate's first sentence for a dangling link at --config", async () => {
			await symlink("nowhere", join(cwd, "h.ts"));

			const initRun = await runCli(cwd, ["init", "--config", "h.ts"]);
			const generateRun = await runCli(cwd, ["generate", "--config", "h.ts"]);

			expect(initRun.exitCode).toBe(1);
			expect(generateRun.exitCode).toBe(1);
			const firstSentence =
				'"h.ts" is the configuration path, but a dangling symbolic link is there, pointing at "nowhere".';
			expect(initRun.stderr).toContain(firstSentence);
			expect(generateRun.stderr).toContain(firstSentence);
		});

		it("names the same ancestor file ('f') in both message and Next: for --config f/h.ts", async () => {
			await writeFile(join(cwd, "f"), "not a directory");

			const initRun = await runCli(cwd, ["init", "--config", "f/h.ts"]);
			const generateRun = await runCli(cwd, ["generate", "--config", "f/h.ts"]);

			expect(initRun.exitCode).toBe(1);
			expect(generateRun.exitCode).toBe(1);
			expect(initRun.stderr).toContain('"f"');
			expect(initRun.stderr).toContain("Next:");
			expect(initRun.stderr.split('"f"').length - 1).toBeGreaterThanOrEqual(2);
			expect(generateRun.stderr).toContain('"f" is a file');
			expect(generateRun.stderr).toContain(
				'Next: move or remove the file at "f"',
			);
		});
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

		// #846 D5 (#830, NB8): --config= used to resolve to cwd and refuse
		// it as an existing "directory" -- a confusing answer for a value
		// the user never spelled as a path at all.
		it("refuses --config= as invalid-config-flag, creating nothing and never mentioning the working directory", async () => {
			const result = await runCli(cwd, ["init", "--config="]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[invalid-config-flag]");
			expect(result.stderr).not.toContain(
				'move or remove the existing directory at "."',
			);
			expect(existsSync(join(cwd, "hejbro.config.ts"))).toBe(false);
		});

		// #846 D5: a trailing --config (no value follows) used to be
		// silently treated as "flag absent", scaffolding the default
		// hejbro.config.ts instead of refusing the empty value.
		it("refuses a trailing --config (no value) as invalid-config-flag, never silently the default", async () => {
			const result = await runCli(cwd, ["init", "--config"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[invalid-config-flag]");
			expect(existsSync(join(cwd, "hejbro.config.ts"))).toBe(false);
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

// #846 D2, NB3: the configuration artifact's own kind used to be checked
// before its ancestors, so `--config f/h.ts` with `f` a file stat'd the
// non-existent leaf "f/h.ts" directly and named it with a bare ENOTDIR,
// instead of the ancestor refusal naming `f` every other artifact
// already gets. One `probePath` judgement (ancestors, then the leaf) now
// covers the configuration artifact too.
describe.skipIf(process.getuid?.() === 0)(
	"runInit / judges the --config path by its ancestors before its own node (#846 D2, NB3)",
	() => {
		afterEach(async () => {
			const nx = join(cwd, "nx");
			if (existsSync(nx)) {
				await chmod(nx, 0o755);
			}
		});

		type ConfigAncestorRow = {
			readonly label: string;
			readonly configFlag: ReadonlyArray<string>;
			readonly setup: (fixtureCwd: string) => Promise<void>;
			readonly assert: (result: Awaited<ReturnType<typeof runInit>>) => void;
		};

		const rows: ReadonlyArray<ConfigAncestorRow> = [
			{
				label: "--config f/h.ts, f a regular file",
				configFlag: ["--config", "f/h.ts"],
				setup: async (fixtureCwd) => {
					await writeFile(join(fixtureCwd, "f"), "not a directory");
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toBe(
						'error[init-path-conflict]: f\n  "f" was expected to be a directory to hold the configuration file, but a file is there. Next: move or remove the existing file at "f", then rerun `hejbro init`.',
					);
					expect(existsSync(join(cwd, "f", "h.ts"))).toBe(false);
				},
			},
			{
				label: "--config lnk/h.ts, lnk -> nowhere (dangling ancestor)",
				configFlag: ["--config", "lnk/h.ts"],
				setup: async (fixtureCwd) => {
					await symlink("nowhere", join(fixtureCwd, "lnk"));
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toBe(
						'error[init-path-conflict]: lnk\n  "lnk" was expected to be a directory to hold the configuration file, but a dangling symbolic link is there, pointing at "nowhere". Next: remove the link or create its target, then rerun `hejbro init`.',
					);
				},
			},
			{
				label: "--config nx/h.ts, nx mode 000 (blocked)",
				configFlag: ["--config", "nx/h.ts"],
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "nx"), { recursive: true });
					await chmod(join(fixtureCwd, "nx"), 0o000);
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toBe(
						'error[init-path-conflict]: nx/h.ts\n  "nx/h.ts" could not be checked for the configuration file (EACCES): "nx" does not let this process look inside it. Next: check permissions on "nx", then rerun `hejbro init`.',
					);
				},
			},
			{
				label: "--config nx/a/h.ts, nx mode 000 (names nx, not nx/a)",
				configFlag: ["--config", "nx/a/h.ts"],
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "nx", "a"), { recursive: true });
					await chmod(join(fixtureCwd, "nx"), 0o000);
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toBe(
						'error[init-path-conflict]: nx/a/h.ts\n  "nx/a/h.ts" could not be checked for the configuration file (EACCES): "nx" does not let this process look inside it. Next: check permissions on "nx", then rerun `hejbro init`.',
					);
				},
			},
			{
				label: "--config d/h.ts, d an empty directory (control: created)",
				configFlag: ["--config", "d/h.ts"],
				setup: async (fixtureCwd) => {
					await mkdir(join(fixtureCwd, "d"), { recursive: true });
				},
				assert: (result) => {
					expect(result.exitCode).toBe(0);
					expect(result.report).toContain("created d/h.ts");
				},
			},
			{
				label:
					"--config h.ts, h.ts -> nowhere (leaf dangling link, #846 D5 phrasing)",
				configFlag: ["--config", "h.ts"],
				setup: async (fixtureCwd) => {
					await symlink("nowhere", join(fixtureCwd, "h.ts"));
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toBe(
						'error[init-path-conflict]: h.ts\n  "h.ts" is the configuration path, but a dangling symbolic link is there, pointing at "nowhere". Next: remove the link or create its target, or name another file with --config, then rerun `hejbro init`.',
					);
				},
			},
			{
				label:
					'omitted --config, migrationsDir: "f/mig", f a file (control: other artifacts unchanged)',
				configFlag: [],
				setup: async (fixtureCwd) => {
					await writeFile(
						configPath(),
						'export default { entry: ["src/**/*.schema.ts"], migrationsDir: "f/mig" };\n',
					);
					await writeFile(join(fixtureCwd, "f"), "not a directory");
				},
				assert: (result) => {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toBe(
						'error[init-path-conflict]: f\n  "f" was expected to be a directory to hold migrationsDir, but a file is there. Next: move or remove the existing file at "f", then rerun `hejbro init`.',
					);
				},
			},
		];

		it.each(rows)(
			"judges the --config path by its ancestors before its own node ($label)",
			async ({ configFlag, setup, assert }) => {
				await setup(cwd);

				const result = await runInit(cwd, configFlag);

				assert(result);
			},
		);
	},
);

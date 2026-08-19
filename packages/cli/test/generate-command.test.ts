import { execFile } from "node:child_process";
import {
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Drives the *built* CLI (`dist/cli.js`) via child_process, not runGenerate
// in-process: `loadDeclarations` jiti-imports fixture files through Node's
// own module resolution, which can resolve a different `@hejbro/core`
// instance than a vitest-transformed in-process call to `generateMigration`
// would use (planner handoff note #2, PR B Task 10 finding) — running the
// real, built CLI is how a user actually invokes it, so this sidesteps the
// mismatch entirely rather than working around it in test-only code. A
// fuller multi-package e2e lands in Task 18 (PR E); this is Task 13's own
// scoped coverage of the command's file-writing/exit-code/error behavior.
const CLI_PACKAGE_ROOT = join(import.meta.dirname, "..");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");

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

const RENAMED_SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	headline: text().notNull(),
});
`;

type CliRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-generate-"));
	// A tmp dir outside the workspace has no node_modules, so a fixture's
	// `import { ... } from "hejbro"` (the self-import cycle, U2) can't
	// resolve on its own — link straight to this package's real root so
	// Node/jiti's normal resolution finds it via `dist`'s package.json
	// `exports`, exactly as an installed dependency would.
	await mkdir(join(cwd, "node_modules"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const runCli = (args: ReadonlyArray<string>): Promise<CliRun> =>
	new Promise((resolve) => {
		execFile(
			process.execPath,
			[CLI_PATH, ...args],
			{ cwd },
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ exitCode: 0, stdout, stderr });
					return;
				}
				const exitCode = typeof error.code === "number" ? error.code : 1;
				resolve({ exitCode, stdout, stderr });
			},
		);
	});

const writeSchema = async (source: string): Promise<void> => {
	await mkdir(join(cwd, "src"), { recursive: true });
	await writeFile(join(cwd, "src", "app.schema.ts"), source);
};

const sqlFileNames = async (): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(join(cwd, "migrations"));
	return entries.filter((name) => name.endsWith(".sql")).sort();
};

describe("hejbro generate (built CLI, tmp-dir)", () => {
	it("writes a migration with both banner hash lines and an updated snapshot", async () => {
		await runCli(["init"]);
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hejbro generate");
		expect(result.stdout).toMatch(/wrote migrations[/\\]/);

		const [fileName] = await sqlFileNames();
		expect(fileName).toBeDefined();
		const migrationContent = await readFile(
			join(cwd, "migrations", fileName as string),
			"utf8",
		);
		expect(migrationContent).toContain("-- parent-snapshot: sha256:");
		expect(migrationContent).toContain("-- snapshot: sha256:");

		const snapshotContent = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		expect(snapshotContent).toContain('"table:app.posts"');
	});

	it("reports no changes and writes no new file on a second run", async () => {
		await runCli(["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(["generate"]);

		const result = await runCli(["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);
		expect(await sqlFileNames()).toHaveLength(1);
	});

	it("exits 1 with an ambiguous-column-rename diagnostic on a same-table drop+add", async () => {
		await runCli(["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(["generate"]);
		await writeSchema(RENAMED_SCHEMA_SOURCE);

		const result = await runCli(["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[ambiguous-column-rename]");
		expect(result.stderr).toContain("app.posts.title=headline");
		expect(await sqlFileNames()).toHaveLength(1);
	});

	it("resolves the ambiguity and writes a rename migration when rerun with --rename", async () => {
		await runCli(["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(["generate"]);
		await writeSchema(RENAMED_SCHEMA_SOURCE);
		await runCli(["generate"]);

		const result = await runCli([
			"generate",
			"--rename",
			"app.posts.title=headline",
		]);
		expect(result.exitCode).toBe(0);

		const fileNames = await sqlFileNames();
		expect(fileNames).toHaveLength(2);
		const migrationTexts = await Promise.all(
			fileNames.map((name) => readFile(join(cwd, "migrations", name), "utf8")),
		);
		expect(
			migrationTexts.some((text) =>
				text.includes(
					'alter table "app"."posts" rename column "title" to "headline";',
				),
			),
		).toBe(true);
	});

	it("exits 1 with snapshot-not-found when neither the snapshot nor prior migrations exist", async () => {
		await writeFile(join(cwd, "hejbro.config.ts"), CONFIG_SOURCE);
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[snapshot-not-found]");
		expect(result.stderr).toContain("hejbro.snapshot.json");
	});
});

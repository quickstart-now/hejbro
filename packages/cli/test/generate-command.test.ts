import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLI_VERSION } from "../src/version";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// Task 13's own scoped coverage of the generate command's file-writing,
// exit-code, and error behavior (built-CLI child_process approach — see
// support/cli-runner.ts for why). A fuller multi-package e2e lands in
// Task 18 (PR E).

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

const SCHEMA_WITH_NOT_NULL_COLUMN_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	status: text().notNull(),
});
`;

const CONFIG_WITH_WARNING_PRESET_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [
		{
			name: "warn",
			kinds: [],
			validators: [
				() => [
					{
						severity: "warning",
						code: "demo-warning",
						message: 'table "app"."posts" is exposed. Next: declare rls(...).',
						declaredAt: null,
					},
				],
			],
		},
	],
});
`;

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
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

describe("hejbro generate (built CLI, tmp-dir)", () => {
	it("writes a migration with both banner hash lines and an updated snapshot", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hejbro generate");
		expect(result.stdout).toMatch(/wrote migrations[/\\]/);

		const [fileName] = await sqlFileNames();
		expect(fileName).toBeDefined();
		const migrationContent = await readFile(
			join(cwd, "migrations", fileName as string),
			"utf8",
		);
		expect(migrationContent).toContain(`-- hejbro: ${CLI_VERSION}`);
		expect(migrationContent).toContain("-- parent-snapshot: sha256:");
		expect(migrationContent).toContain("-- snapshot: sha256:");

		const snapshotContent = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		expect(snapshotContent).toContain('"table:app.posts"');
	});

	it("reports no changes and writes no new file on a second run", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);
		expect(await sqlFileNames()).toHaveLength(1);
	});

	// #26/#136 (identity fix, item 21 of phase8-snapshot-v5) originally
	// caught this shape of corruption downstream, as a generic
	// malformed-snapshot-node crash guard. D79/#159 catches it earlier and
	// more precisely: parseSnapshot's own requiredKeys check now reports
	// the exact missing key by name at parse time, naming the malformed
	// entry itself (not hejbro.config.ts) as the identity — never reaching
	// the downstream malformed-snapshot-node guard at all for this case.
	it("exits 1 with invalid-snapshot, naming the exact missing key, for a corrupted table node (D79/#159, earlier than the former malformed-snapshot-node catch)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		const snapshotPath = join(cwd, "hejbro.snapshot.json");
		const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
		snapshot.objects["table:app.posts"] = { schema: "app", name: "posts" }; // missing columns/indexes/foreignKeys
		await writeFixtureFile(
			cwd,
			"hejbro.snapshot.json",
			JSON.stringify(snapshot),
		);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-snapshot]: table:app.posts");
		expect(result.stderr).not.toContain("hejbro.config.ts");
		expect(result.stderr).toContain('missing required key "columns"');
	});

	it("exits 1 with an ambiguous-column-rename diagnostic on a same-table drop+add", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);
		await writeSchema(RENAMED_SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[ambiguous-column-rename]");
		expect(result.stderr).toContain("app.posts.title=headline");
		expect(await sqlFileNames()).toHaveLength(1);
	});

	it("resolves the ambiguity and writes a rename migration when rerun with --rename", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);
		await writeSchema(RENAMED_SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, [
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
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[snapshot-not-found]");
		expect(result.stderr).toContain("hejbro.snapshot.json");
	});

	// Regression guard for a defect introduced (and caught before shipping)
	// while converting HejbroError to a class (phase8-error-subclass, #25):
	// generate.ts's toDiagnostic used to rebuild the error via
	// `{ ...error, declaredAt }`, which silently drops `message` once
	// HejbroError is an Error subclass (Error.prototype.message is
	// own-but-non-enumerable, so a plain object spread never copies it).
	// Every non-ambiguity error diagnostic's body came out as the literal
	// string "undefined". Deliberately independent of golden.test.ts's
	// exact-text pins — asserts the invariant directly (a real message,
	// never the string "undefined") rather than relying on a byte-exact
	// match to also happen to catch it.
	it('renders a real error body, never the literal string "undefined", for a non-ambiguity error', async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'entry pattern "src/**/*.schema.ts" matched 0 files',
		);
		expect(result.stderr).not.toContain("undefined");
	});

	it("renders a preset validator's warning to stderr and keeps exit 0 (O3)", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(
			cwd,
			"hejbro.config.ts",
			CONFIG_WITH_WARNING_PRESET_SOURCE,
		);
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(await sqlFileNames()).toHaveLength(1);
		expect(result.stdout).toContain("1 warning(s) — see below");
		expect(result.stderr).toBe(
			'warning[demo-warning]: app.posts\n  table "app"."posts" is exposed. Next: declare rls(...).\n',
		);

		// O3 §3: the summary line sits immediately after `wrote <file>`, not
		// merely somewhere in stdout — pin the exact position.
		const stdoutLines = result.stdout.split("\n");
		const wroteLineIndex = stdoutLines.findIndex((line) =>
			line.startsWith("wrote "),
		);
		expect(wroteLineIndex).toBeGreaterThanOrEqual(0);
		expect(stdoutLines[wroteLineIndex + 1]).toBe("1 warning(s) — see below");
	});

	it("warns (not-null-without-default) when a migration adds a not-null column with no default, with no presets configured (#27)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);
		await writeSchema(SCHEMA_WITH_NOT_NULL_COLUMN_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(await sqlFileNames()).toHaveLength(2);
		expect(result.stdout).toContain("1 warning(s) — see below");
		expect(result.stderr).toBe(
			'warning[not-null-without-default]: app.posts\n  column "app"."posts"."status" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.\n',
		);
	});
});

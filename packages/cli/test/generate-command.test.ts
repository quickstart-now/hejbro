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

// D106 R2, R2-B2: the evaluator's own handover fixture (RLS + one policy +
// a `serial()` primary key, `k1.widgets`), replayed through the real CLI
// across separate runs -- the in-process pins (`generate.test.ts`'s
// uo7/uo8) thread `firstResult.snapshot` straight into `secondResult`'s
// `previousSnapshot` by hand, which is exactly what the shipped CLI
// declined to do before this fix.
const HANDOVER_MANAGED_SCHEMA_SOURCE = `import { literal, rls, schema, serial, table } from "hejbro";

export const k1 = schema("k1");

export const widgets = table(
	k1,
	"widgets",
	{ id: serial().primaryKey() },
	() => ({
		rls: rls.enabled({
			readLow: rls.policy("read_low").for("select").to("anon").using(literal(true)),
		}),
	}),
);
`;

const HANDOVER_EXISTING_SCHEMA_SOURCE = `import { existingTable, schema, uuid } from "hejbro";

export const k1 = schema("k1");

export const widgets = existingTable("k1", "widgets", { id: uuid() });
`;

const HANDOVER_REMOVED_SCHEMA_SOURCE = `import { schema } from "hejbro";

export const k1 = schema("k1");
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

	it("an existing marker survives a real handover run on the on-disk snapshot (D106 R2, R2-B2 measurement ①)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(HANDOVER_MANAGED_SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(HANDOVER_EXISTING_SCHEMA_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		// cli-commands (this change's own MODIFIED delta, "A recorded
		// declaration that emits nothing still writes the snapshot"): a run
		// that moves the snapshot with no migration reports that, never the
		// unqualified "already matches" line -- that line would now be
		// false the moment this run's own write lands.
		expect(result.stdout).toContain(
			"no migration — snapshot updated to record the declared change.",
		);

		const snapshotText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		const snapshot = JSON.parse(snapshotText);
		expect(snapshot.objects["table:k1.widgets"]).toMatchObject({
			existing: true,
		});
	});

	it("a run that later removes a handed-over table's declaration entirely never brings its drops back (D106 R2, R2-B2 measurement ②)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(HANDOVER_MANAGED_SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(HANDOVER_EXISTING_SCHEMA_SOURCE);
		const handoverResult = await runCli(cwd, ["generate"]);
		expect(handoverResult.exitCode).toBe(0);

		await writeSchema(HANDOVER_REMOVED_SCHEMA_SOURCE);
		const removedResult = await runCli(cwd, ["generate"]);
		expect(removedResult.exitCode).toBe(0);

		// Neither the handover run nor the declaration-removal run after it
		// emits any DDL for k1.widgets -- if either had, a second migration
		// file would exist alongside the original `create table` one. The
		// file count alone already proves it; the destructive-drop greps
		// below (evaluation.md's own consequence 2 text, exact statements)
		// rule out the one false positive a bare "drop" substring search
		// would catch -- `create policy`'s own idempotent
		// `drop policy if exists` guard, present in the original file too.
		const fileNames = await sqlFileNames();
		expect(fileNames).toHaveLength(1);
		const [onlyFileName] = fileNames;
		const onlyFileText = await readFile(
			join(cwd, "migrations", onlyFileName as string),
			"utf8",
		);
		expect(onlyFileText).not.toContain('drop policy "read_low"');
		expect(onlyFileText).not.toContain("drop sequence");
		expect(onlyFileText).not.toContain("disable row level security");
		expect(onlyFileText).not.toContain("drop table");

		// Removing the declaration entirely still moves the snapshot (the
		// entry itself drops out, since nothing declares the table any
		// longer) even though it emits no statement -- the same "snapshot
		// differs, no migration" case as the handover run before it, so it
		// gets the same report line, not "already matches".
		expect(removedResult.stdout).toContain(
			"no migration — snapshot updated to record the declared change.",
		);
		const finalSnapshotText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		expect(
			JSON.parse(finalSnapshotText).objects["table:k1.widgets"],
		).toBeUndefined();
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

describe("generate determinism (align-spec-corpus 2.1)", () => {
	it("same declarations against the same snapshot produce byte-identical migration SQL and snapshot bytes", async () => {
		const other = await createCliFixtureDir();
		const outputsOf = async (dir: string) => {
			const entries = await readdir(join(dir, "migrations"));
			const [sqlName] = entries.filter((name) => name.endsWith(".sql")).sort();
			expect(sqlName).toBeDefined();
			const migration = await readFile(
				join(dir, "migrations", sqlName as string),
				"utf8",
			);
			const snapshot = await readFile(
				join(dir, "hejbro.snapshot.json"),
				"utf8",
			);
			return { migration, snapshot };
		};
		try {
			for (const dir of [cwd, other]) {
				await runCli(dir, ["init"]);
				await writeFixtureFile(dir, "src/app.schema.ts", SCHEMA_SOURCE);
				const result = await runCli(dir, ["generate"]);
				expect(result.exitCode).toBe(0);
			}
			const first = await outputsOf(cwd);
			const second = await outputsOf(other);
			expect(second.migration).toBe(first.migration);
			expect(second.snapshot).toBe(first.snapshot);
		} finally {
			await removeCliFixtureDir(other);
		}
	});
});

describe("hejbro baseline — report strings (task 4.8)", () => {
	// This project's own apply engine (`add-apply-engine`) gave the report
	// a real "hejbro command that registers it" to name, and a real
	// "hejbro command that compares declarations against a live database"
	// (`hejbro check`, already shipped) -- replacing the old prose that
	// pointed at an external pipeline and a two-path pg_dump comparison.
	it("the baseline report names hejbro's own apply command", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["baseline"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hejbro migrate");
		expect(result.stdout).toContain("hejbro check");
		expect(result.stdout).not.toContain("apply tool");
		expect(result.stdout).not.toContain("pg_dump");
	});
});

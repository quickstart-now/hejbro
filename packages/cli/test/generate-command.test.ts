import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
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
import { GIT_TEST_ENV } from "./support/git-fixture";

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

// D106 R3, R3-B1: the evaluator's own reproduction, verbatim -- an
// in-sync project (no handover, no adoption) that adds a plain
// `existingTable()` declaration for the first time.
const SCHEMA_WITH_NEW_EXISTING_SOURCE = `import { existingTable, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const authUsers = existingTable("auth", "users", { id: uuid() });
`;

// A real DDL change layered on top of the fixture above -- measurement ②
// needs a run that genuinely emits statements *after* a zero-statement
// migration already anchored the chain.
const SCHEMA_WITH_NEW_EXISTING_AND_EXTRA_COLUMN_SOURCE = `import { existingTable, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	subtitle: text(),
});

export const authUsers = existingTable("auth", "users", { id: uuid() });
`;

// D106 R4, R4-B1: the evaluator's own flagship reproduction -- the one
// edit this feature exists to enable (widening an existing declaration's
// own shape, e.g. for a join), layered on top of SCHEMA_WITH_NEW_EXISTING
// once that first record_users.sql migration is already on disk.
const SCHEMA_WITH_RESHAPED_EXISTING_SOURCE = `import { existingTable, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const authUsers = existingTable("auth", "users", { id: uuid(), email: text() });
`;

// #701/D3 (supersedes D106 R5, R5-B1's own restate fallback, J17: the
// owner's own comment on #701 asked for canonical comparison over restate
// once the census landed): a plain managed table, no existingTable()
// anywhere in the project, two indexes -- reordering them is a
// set-shaped-array reorder, and `generate`'s snapshot-moved check now
// reads both sides through the canonical form, so it is never a movement
// at all, not even a zero-statement one.
const SCHEMA_WITH_TWO_INDEXES_SOURCE = `import { index, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
}, (t) => ({ indexes: [index().on(t.title), index().on(t.body)] }));
`;

// The same shape, on `checks` instead of `indexes`.
const SCHEMA_WITH_TWO_CHECKS_SOURCE = `import { check, gt, schema, table, integer, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	a: integer().notNull(),
	b: integer().notNull(),
}, (t) => ({ checks: [check("a_pos", gt(t.a, 0)), check("b_pos", gt(t.b, 0))] }));
`;

// A real existingTable() and a managed FK onto it alongside the reordered
// table, so the scan crosses an existing:existing (unchanged) table
// before reaching the managed one whose committed indexes are reordered.
const SCHEMA_WITH_EXISTING_AND_INDEXES_SOURCE = `import { existingTable, index, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const authUsers = existingTable("auth", "users", { id: uuid() });

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
	authorId: uuid().references(() => authUsers.id),
}, (t) => ({ indexes: [index().on(t.title), index().on(t.body)] }));
`;

// #703: a managed table, then the same edit's own handover+rename
// hazard -- the managed declaration removed, a same-shaped
// existingTable() appearing under a different name, in one run.
const RENAME_GUARD_MANAGED_SOURCE = `import { schema, table, uuid } from "hejbro";

export const app = schema("app");

export const widgets = table(app, "widgets", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

// #703's own safe two-step path: rename while both sides are still
// managed table() declarations (step 1), then hand the renamed table
// over to existingTable() in a later run (step 2).
const RENAME_GUARD_MANAGED_RENAMED_SOURCE = `import { schema, table, uuid } from "hejbro";

export const app = schema("app");

export const gadgets = table(app, "gadgets", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

const RENAME_GUARD_EXISTING_SOURCE = `import { existingTable, schema, uuid } from "hejbro";

export const app = schema("app");

export const gadgets = existingTable("app", "gadgets", { id: uuid() });
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

const SNAPSHOT_PREFIX = "-- snapshot: ";

/**
 * #701/D3: simulates a project's committed snapshot as it would read
 * before this order was canonical -- `reorder` rewrites one set-shaped
 * array on the on-disk file (never `hejbro generate`'s own output, which
 * always writes the canonical form now), and the tip migration's own
 * "snapshot:" hash is recomputed to match those exact bytes, so check 1
 * (tip hash vs. file) still passes and only the canonical-form comparison
 * this scenario means to exercise is under test.
 */
const writeNonCanonicalSnapshot = async (
	reorder: (parsed: {
		readonly objects: Record<string, Record<string, unknown>>;
	}) => void,
): Promise<void> => {
	const snapshotPath = join(cwd, "hejbro.snapshot.json");
	const parsed = JSON.parse(await readFile(snapshotPath, "utf8"));
	reorder(parsed);
	const rewritten = `${JSON.stringify(parsed, null, "\t")}\n`;
	await writeFile(snapshotPath, rewritten);

	const [fileName] = await sqlFileNames();
	const filePath = join(cwd, "migrations", fileName as string);
	const original = await readFile(filePath, "utf8");
	const newHash = `sha256:${createHash("sha256").update(rewritten).digest("hex")}`;
	const patched = original
		.split("\n")
		.map((line) => {
			if (!line.startsWith(SNAPSHOT_PREFIX)) {
				return line;
			}
			return `${SNAPSHOT_PREFIX}${newHash}`;
		})
		.join("\n");
	await writeFile(filePath, patched);
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

	it("an existing marker survives a real handover run on the on-disk snapshot and anchors the chain (D106 R2/R3, R2-B2/R3-B1 measurement ①)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(HANDOVER_MANAGED_SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(HANDOVER_EXISTING_SCHEMA_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		// cli-commands (this change's own MODIFIED delta, D106 R3, J13): a
		// run that moves the snapshot with no statement to write still
		// writes a migration -- one carrying no statements, whose banner
		// anchors the new snapshot in the chain -- and reports both the
		// file and that it carries no statements, never the unqualified
		// "already matches" line (that line would now be false) and never
		// silently updating the snapshot with nothing on disk to show it
		// (R3-B1's own failure mode).
		expect(result.stdout).toContain("wrote migrations/");
		expect(result.stdout).toContain("carries no statements.");

		const snapshotText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		const snapshot = JSON.parse(snapshotText);
		expect(snapshot.objects["table:k1.widgets"]).toMatchObject({
			existing: true,
		});

		// R3-B1's own core observer: a repository nobody hand-edited still
		// passes verify after this run -- the chain-tip/snapshot mismatch
		// the evaluator's own reproduction found is exactly what a
		// zero-statement migration's banner prevents.
		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
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

		// D106 R3, J13: neither the handover run nor the declaration-removal
		// run after it emits any DDL for k1.widgets -- each still gets its
		// own migration file now (one to anchor the handover, one to anchor
		// the removal), but every file's own SQL body stays free of the
		// destructive statements evaluation.md's own consequence 2 named.
		// The original `create table` migration plus these two zero-
		// statement ones make three files total.
		const fileNames = await sqlFileNames();
		expect(fileNames).toHaveLength(3);
		const fileTexts = await Promise.all(
			fileNames.map((name) => readFile(join(cwd, "migrations", name), "utf8")),
		);
		const wholeText = fileTexts.join("\n");
		expect(wholeText).not.toContain('drop policy "read_low"');
		expect(wholeText).not.toContain("drop sequence");
		expect(wholeText).not.toContain("disable row level security");
		expect(wholeText).not.toContain("drop table");

		// Removing the declaration entirely still moves the snapshot (the
		// entry itself drops out, since nothing declares the table any
		// longer) even though it emits no statement -- the same
		// "snapshot differs, no statement" case as the handover run before
		// it, so it gets the same report shape: a migration written, and
		// that it carries no statements.
		expect(removedResult.stdout).toContain("wrote migrations/");
		expect(removedResult.stdout).toContain("carries no statements.");
		const finalSnapshotText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		expect(
			JSON.parse(finalSnapshotText).objects["table:k1.widgets"],
		).toBeUndefined();

		// R3-B1's own second failure mode (evaluation.md: "the chain breaks
		// permanently at the next real migration"): both zero-statement
		// migrations anchored the chain correctly, so a repository nobody
		// edited still verifies clean after both of them.
		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
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

	// #743, D2: an absolute-looking migrationsDir used to be silently
	// joined under cwd -- generate now refuses it at config-read time,
	// before anything is written, the same as init does.
	it("exits 1 with invalid-config for an absolute-looking migrationsDir, naming the field and writing nothing", async () => {
		await writeFixtureFile(
			cwd,
			"hejbro.config.ts",
			`import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "/db/migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`,
		);
		await writeSchema(SCHEMA_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-config]");
		expect(result.stderr).toContain("migrationsDir");
		expect(result.stderr).not.toContain(cwd);
		expect(existsSync(join(cwd, "db"))).toBe(false);
	});

	// #766 second ask, D3b: readSnapshotFileText tested existsSync then
	// read -- a directory passes that test and the read that followed
	// died with a raw EISDIR. It now stats first and refuses by name.
	describe("refuses a directory at the snapshot path with snapshot-not-a-file, never EISDIR (#766)", () => {
		type SnapshotNotAFileRow = {
			readonly label: string;
			readonly command: "generate" | "verify";
			readonly setup: (fixtureCwd: string) => Promise<void>;
			readonly outcome:
				| "refused"
				| "reads-as-today"
				| "snapshot-not-found"
				| "invalid-config";
			readonly expectedPathSubstring?: string;
		};

		const initWithSchema = async (fixtureCwd: string): Promise<void> => {
			await runCli(fixtureCwd, ["init"]);
			await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
		};

		const directoryAtDefaultSnapshotPath = async (
			fixtureCwd: string,
		): Promise<void> => {
			await initWithSchema(fixtureCwd);
			await rm(join(fixtureCwd, "hejbro.snapshot.json"));
			await mkdir(join(fixtureCwd, "hejbro.snapshot.json"));
		};

		const rows: ReadonlyArray<SnapshotNotAFileRow> = [
			{
				label: "generate, a directory at the default snapshotPath",
				command: "generate",
				setup: directoryAtDefaultSnapshotPath,
				outcome: "refused",
				expectedPathSubstring: "hejbro.snapshot.json",
			},
			{
				label: "verify, a directory at the default snapshotPath",
				command: "verify",
				setup: directoryAtDefaultSnapshotPath,
				outcome: "refused",
				expectedPathSubstring: "hejbro.snapshot.json",
			},
			{
				label:
					'generate, a snapshotPath: "db/state.json/" is refused as a spelling fault (#846 D1), never read as a directory',
				command: "generate",
				setup: async (fixtureCwd) => {
					await writeFixtureFile(
						fixtureCwd,
						"hejbro.config.ts",
						`import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "db/state.json/",
	prefixStrategy: "timestamp",
});
`,
					);
					await writeFixtureFile(
						fixtureCwd,
						"src/app.schema.ts",
						SCHEMA_SOURCE,
					);
				},
				outcome: "invalid-config",
				expectedPathSubstring: "db/state.json/",
			},
			{
				label:
					"generate, a regular file at the snapshot path (control: reads as today)",
				command: "generate",
				setup: initWithSchema,
				outcome: "reads-as-today",
			},
			{
				label:
					"generate, nothing and no prior migrations (control: snapshot-not-found unchanged)",
				command: "generate",
				setup: async (fixtureCwd) => {
					await writeFixtureFile(fixtureCwd, "hejbro.config.ts", CONFIG_SOURCE);
					await writeFixtureFile(
						fixtureCwd,
						"src/app.schema.ts",
						SCHEMA_SOURCE,
					);
				},
				outcome: "snapshot-not-found",
			},
		];

		const hasNoSqlFilesWritten = async (
			fixtureCwd: string,
		): Promise<boolean> => {
			if (!existsSync(join(fixtureCwd, "migrations"))) {
				return true;
			}
			const entries = await readdir(join(fixtureCwd, "migrations"));
			return entries.filter((name) => name.endsWith(".sql")).length === 0;
		};

		it.each(rows)(
			"refuses a directory at the snapshot path with snapshot-not-a-file, never EISDIR ($label)",
			async ({ command, setup, outcome, expectedPathSubstring }) => {
				await setup(cwd);

				const result = await runCli(cwd, [command]);

				if (outcome === "reads-as-today") {
					expect(result.exitCode).toBe(0);
					return;
				}
				if (outcome === "snapshot-not-found") {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[snapshot-not-found]");
					expect(result.stderr).toContain("hejbro.snapshot.json");
					return;
				}
				if (outcome === "invalid-config") {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("error[invalid-config]");
					expect(result.stderr).toContain("snapshotPath");
					expect(result.stderr).toContain(expectedPathSubstring);
					expect(result.stderr).toContain("Next:");
					expect(await hasNoSqlFilesWritten(cwd)).toBe(true);
					return;
				}
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[snapshot-not-a-file]");
				expect(result.stderr).toContain(expectedPathSubstring);
				expect(result.stderr).toContain("Next:");
				expect(result.stderr).not.toContain("EISDIR");
				expect(result.stderr).not.toContain(cwd);
				expect(await hasNoSqlFilesWritten(cwd)).toBe(true);
			},
		);
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

	// D106 R3, R3-B1 measurement ①: the evaluator's own flagship
	// reproduction (evaluation.md's exact repro shape) -- an already
	// in-sync project (already generated and verified once) that adds a
	// plain `existingTable()` declaration, with no handover or adoption
	// involved. Before this round's fix, this exact sequence left
	// `hejbro verify` failing permanently with a false
	// `chain-tip-mismatch` on a repository nobody edited.
	it("an in-sync project that adds a new existing declaration still verifies afterward (D106 R3, R3-B1 measurement ①)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeSchema(SCHEMA_WITH_NEW_EXISTING_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("wrote migrations/");
		expect(result.stdout).toContain("carries no statements.");

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// D106 R3, R3-B1 measurement ②: the evaluator's own "second failure
	// mode" -- once a zero-statement migration is in the chain, the NEXT
	// migration that genuinely does emit statements writes a
	// `parent-snapshot:` naming the state the zero-statement migration
	// settled on. Before this round's fix, nothing ever recorded that
	// state in a migration's own `snapshot:` line at all, so this next
	// real migration's `parent-snapshot:` matched no earlier migration,
	// breaking the chain permanently (`broken-chain`).
	it("a later run that does emit statements still verifies after a zero-statement migration anchored the chain (D106 R3, R3-B1 measurement ②)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(SCHEMA_WITH_NEW_EXISTING_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(SCHEMA_WITH_NEW_EXISTING_AND_EXTRA_COLUMN_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("carries no statements.");
		// Names the real change in the report's own banner line (stdout
		// only ever prints each written migration's banner, never its full
		// SQL body -- `written.sql.split("\n\n")[0]`).
		expect(result.stdout).toContain('column "subtitle" added');

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// D106 R3, R3-B1 measurement ④: `deriveExistingTransitionSlug`'s own
	// determinism -- the same declared change, from the same starting
	// state, in two entirely independent projects, SHALL name its
	// zero-statement migration the same slug (never a generic fallback,
	// never a random or time-derived name). Only the numeric prefix
	// (`migrationFileName`'s own version/timestamp) is allowed to differ
	// between the two -- stripped here (`migrationVersionOf`'s own
	// "before the first `_`" rule) before comparing.
	it("the zero-statement migration's own slug is deterministic across two independent runs (D106 R3, R3-B1 measurement ④)", async () => {
		const stripPrefix = (fileName: string): string =>
			fileName.replace(/^\d+_/, "");

		const cwdA = await createCliFixtureDir();
		const cwdB = await createCliFixtureDir();
		try {
			for (const target of [cwdA, cwdB]) {
				await runCli(target, ["init"]);
				await writeFixtureFile(target, "src/app.schema.ts", SCHEMA_SOURCE);
				await runCli(target, ["generate"]);
				await writeFixtureFile(
					target,
					"src/app.schema.ts",
					SCHEMA_WITH_NEW_EXISTING_SOURCE,
				);
				await runCli(target, ["generate"]);
			}
			const namesA = (await readdir(join(cwdA, "migrations")))
				.filter((name) => name.endsWith(".sql"))
				.sort();
			const namesB = (await readdir(join(cwdB, "migrations")))
				.filter((name) => name.endsWith(".sql"))
				.sort();
			expect(namesA.map(stripPrefix)).toEqual(namesB.map(stripPrefix));
			// Names the actual slug too, not just that the two runs agree --
			// a bug that made both runs agree on the SAME wrong slug (a
			// generic fallback, for instance) would still pass the line
			// above alone.
			expect(stripPrefix(namesA[1] as string)).toBe("record_users.sql");
		} finally {
			await removeCliFixtureDir(cwdA);
			await removeCliFixtureDir(cwdB);
		}
	});

	// D106 R4, R4-B1 repro ①②: widening an existing declaration's own
	// shape (adding a column, here) used to crash `generate` with a raw
	// internal-invariant stack trace, write nothing, and leave `verify`
	// permanently red -- the "existing:existing, content differs" side
	// pair had no transition verb of its own. Fixed by the fifth verb,
	// `reshape`.
	it("an existing declaration's own shape change writes a reshape migration instead of crashing, and verify passes after (D106 R4, R4-B1 repro ①②)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeSchema(SCHEMA_WITH_NEW_EXISTING_SOURCE);
		await runCli(cwd, ["generate"]);
		const secondVerify = await runCli(cwd, ["verify"]);
		expect(secondVerify.exitCode).toBe(0);

		await writeSchema(SCHEMA_WITH_RESHAPED_EXISTING_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("wrote migrations/");
		expect(result.stdout).toContain("carries no statements.");

		const names = await sqlFileNames();
		expect(names.some((name) => name.endsWith("_reshape_users.sql"))).toBe(
			true,
		);

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// D106 R4, R4-B1 repro ③: the reshape slug is deterministic across two
	// entirely independent projects, the same way R3-B1 measurement ④
	// already proved for the marker-transition verbs.
	it("the reshape migration's own slug is deterministic across two independent runs (D106 R4, R4-B1 repro ③)", async () => {
		const stripPrefix = (fileName: string): string =>
			fileName.replace(/^\d+_/, "");

		const cwdA = await createCliFixtureDir();
		const cwdB = await createCliFixtureDir();
		try {
			for (const target of [cwdA, cwdB]) {
				await runCli(target, ["init"]);
				await writeFixtureFile(target, "src/app.schema.ts", SCHEMA_SOURCE);
				await runCli(target, ["generate"]);
				await writeFixtureFile(
					target,
					"src/app.schema.ts",
					SCHEMA_WITH_NEW_EXISTING_SOURCE,
				);
				await runCli(target, ["generate"]);
				await writeFixtureFile(
					target,
					"src/app.schema.ts",
					SCHEMA_WITH_RESHAPED_EXISTING_SOURCE,
				);
				await runCli(target, ["generate"]);
			}
			const namesA = (await readdir(join(cwdA, "migrations")))
				.filter((name) => name.endsWith(".sql"))
				.sort();
			const namesB = (await readdir(join(cwdB, "migrations")))
				.filter((name) => name.endsWith(".sql"))
				.sort();
			expect(namesA.map(stripPrefix)).toEqual(namesB.map(stripPrefix));
			expect(stripPrefix(namesA[2] as string)).toBe("reshape_users.sql");
		} finally {
			await removeCliFixtureDir(cwdA);
			await removeCliFixtureDir(cwdB);
		}
	});

	// #701/D3 (supersedes D106 R5, R5-B1 repro ①): a committed snapshot
	// whose indexes are non-canonical (as a pre-#701 project's would read)
	// against declarations listing the same two indexes -- `generate` now
	// reads both sides through the canonical form, so this is never a
	// movement: no new migration file, the snapshot's own bytes untouched,
	// and `verify` passes reading the same canonical form.
	it("a committed snapshot with reordered indexes generates nothing against unchanged declarations", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_WITH_TWO_INDEXES_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeNonCanonicalSnapshot((parsed) => {
			const table = parsed.objects["table:app.posts"];
			if (table === undefined) {
				throw new Error("expected table:app.posts in the snapshot");
			}
			table.indexes = [...(table.indexes as ReadonlyArray<unknown>)].reverse();
		});
		const beforeText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		const namesBefore = await sqlFileNames();

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);
		expect(await sqlFileNames()).toEqual(namesBefore);
		expect(await readFile(join(cwd, "hejbro.snapshot.json"), "utf8")).toBe(
			beforeText,
		);

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// The same shape on `checks` instead of `indexes`.
	it("a committed snapshot with reordered checks generates nothing against unchanged declarations", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_WITH_TWO_CHECKS_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeNonCanonicalSnapshot((parsed) => {
			const table = parsed.objects["table:app.posts"];
			if (table === undefined) {
				throw new Error("expected table:app.posts in the snapshot");
			}
			table.checks = [...(table.checks as ReadonlyArray<unknown>)].reverse();
		});
		const beforeText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		const namesBefore = await sqlFileNames();

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);
		expect(await sqlFileNames()).toEqual(namesBefore);
		expect(await readFile(join(cwd, "hejbro.snapshot.json"), "utf8")).toBe(
			beforeText,
		);

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// A real existingTable() alongside the reordered table, so the scan
	// crosses an unchanged existing:existing table before reaching the
	// managed one whose committed indexes are non-canonical.
	it("a committed snapshot with reordered indexes generates nothing alongside an unrelated existingTable()", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_WITH_EXISTING_AND_INDEXES_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeNonCanonicalSnapshot((parsed) => {
			const table = parsed.objects["table:app.posts"];
			if (table === undefined) {
				throw new Error("expected table:app.posts in the snapshot");
			}
			table.indexes = [...(table.indexes as ReadonlyArray<unknown>)].reverse();
		});
		const beforeText = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		const namesBefore = await sqlFileNames();

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);
		expect(await sqlFileNames()).toEqual(namesBefore);
		expect(await readFile(join(cwd, "hejbro.snapshot.json"), "utf8")).toBe(
			beforeText,
		);

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// The restate migration's own deterministic-slug pin (D106 R5, R5-B1)
	// no longer has a subject to test here -- #701 removed the restate
	// fallback path itself for this scenario class (a reorder is no longer
	// a movement at all). The restate mechanism's own determinism is still
	// pinned directly at `packages/core/test/migration-file.test.ts`'s
	// `describe("restate fallback (D106 R5, R5-B1, J17)", ...)`, which
	// exercises `deriveExistingTransitionSlug`'s "restate_<table>" case
	// without depending on a reorder ever reaching it.

	// #703: a managed table's own removal, paired with a same-shaped
	// existingTable() appearing under a different name in the same run,
	// used to drop the managed table's DDL (table + sequence + policy +
	// RLS) with no prompt at all -- R3-B2's own excludeExisting hid the
	// newly-added existing identity from the rename planner entirely.
	it("a managed table replaced by a same-shaped existing declaration is refused, with no drop DDL (#703)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(RENAME_GUARD_MANAGED_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(RENAME_GUARD_EXISTING_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		// A real ambiguous-table-rename error routes through the CLI's own
		// rich terminal renderer (rename-diagnostics.ts), never core's flat
		// ambiguousTableRenameMessage directly -- both now share the exact
		// phrase "two runs" on purpose (#703), but asserting against the
		// wrong one here would silently pass even if the rich renderer's
		// own wording drifted away from it again.
		expect(result.stderr).toContain("ambiguous-table-rename");
		expect(result.stderr).toContain("two runs");
		expect(result.stdout).not.toContain("wrote migrations/");
		const names = await sqlFileNames();
		expect(names).toHaveLength(1); // only the first, managed-widgets file
		expect(result.stderr.toLowerCase()).not.toContain("drop table");
		expect(result.stderr.toLowerCase()).not.toContain("drop sequence");
		expect(result.stderr.toLowerCase()).not.toContain("drop policy");
		expect(result.stderr.toLowerCase()).not.toContain(
			"disable row level security",
		);
	});

	// #703: the safe two-step path -- rename while both sides are still
	// managed, THEN hand the renamed table over to existingTable() in a
	// later run. Both steps apply cleanly and verify stays green.
	it("the two-step path -- rename while both managed, then hand over -- applies cleanly (#703)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(RENAME_GUARD_MANAGED_SOURCE);
		await runCli(cwd, ["generate"]);

		await writeSchema(RENAME_GUARD_MANAGED_RENAMED_SOURCE);
		const renameResult = await runCli(cwd, [
			"generate",
			"--rename",
			"app.widgets=gadgets",
		]);
		expect(renameResult.exitCode).toBe(0);
		// stdout only ever prints each written migration's own banner (the
		// first "\n\n"-split segment), never its full SQL body -- read the
		// migration file itself to see the actual statement (measured
		// directly, the same lesson R3-B1's own measurement ② already
		// caught once).
		const renamedFiles = await sqlFileNames();
		const renamedContent = await readFile(
			join(cwd, "migrations", renamedFiles.at(-1) as string),
			"utf8",
		);
		expect(renamedContent).toContain(
			'alter table "app"."widgets" rename to "gadgets"',
		);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeSchema(RENAME_GUARD_EXISTING_SOURCE);
		const handoverResult = await runCli(cwd, ["generate"]);
		expect(handoverResult.exitCode).toBe(0);
		expect(handoverResult.stdout).toContain("carries no statements.");
		const secondVerify = await runCli(cwd, ["verify"]);
		expect(secondVerify.exitCode).toBe(0);
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

// #767 review round 1, D7: readSnapshotFileText's own directory guard
// (#766 second ask, 1.3b) left every *other* stat/read failure to
// rethrow raw -- a mode-000 snapshot file died with a raw
// `EACCES: permission denied, open` Node stack, and a blocked ancestor
// on the way to the snapshot path died with a raw `EACCES ... stat`.
// Both now surface as the same coded `snapshot-unreadable`, shared by
// every command that reads the snapshot (one reader).
describe.skipIf(process.getuid?.() === 0)(
	"refuses an unreadable snapshot file with snapshot-unreadable, never a raw EACCES (#767, D7)",
	() => {
		afterEach(async () => {
			await Promise.all(
				["hejbro.snapshot.json", "unreadable.json", "parent", "nx"].map(
					async (name) => {
						const candidate = join(cwd, name);
						if (!existsSync(candidate)) {
							return;
						}
						await chmod(candidate, 0o755);
					},
				),
			);
		});

		const envWithoutDatabaseUrl = (): NodeJS.ProcessEnv => {
			const { DATABASE_URL, ...rest } = process.env;
			return rest;
		};

		const commands: ReadonlyArray<string> = [
			"generate",
			"verify",
			"check",
			"baseline",
		];

		it.each(commands)(
			"refuses a mode-000 snapshot file with snapshot-unreadable (%s)",
			async (command) => {
				await runCli(cwd, ["init"]);
				await writeSchema(SCHEMA_SOURCE);
				await chmod(join(cwd, "hejbro.snapshot.json"), 0o000);

				const result = await runCli(cwd, [command], {
					env: envWithoutDatabaseUrl(),
				});

				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[snapshot-unreadable]");
				expect(result.stderr).toContain("hejbro.snapshot.json");
				expect(result.stderr).toContain("(EACCES)");
				expect(result.stderr).toContain("Next:");
				expect(result.stderr).not.toContain("permission denied, open");
				expect(result.stderr).not.toContain(cwd);
			},
		);

		it("reads a mode-444 snapshot file as today (control)", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(SCHEMA_SOURCE);
			const first = await runCli(cwd, ["generate"]);
			expect(first.exitCode).toBe(0);
			await chmod(join(cwd, "hejbro.snapshot.json"), 0o444);

			const second = await runCli(cwd, ["generate"]);

			expect(second.exitCode).toBe(0);
			expect(second.stderr).not.toContain("error[");
		});

		it("refuses a mode-000 directory at the snapshot path with snapshot-not-a-file, kind checked before readability (control)", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(SCHEMA_SOURCE);
			await rm(join(cwd, "hejbro.snapshot.json"));
			await mkdir(join(cwd, "hejbro.snapshot.json"));
			await chmod(join(cwd, "hejbro.snapshot.json"), 0o000);

			const result = await runCli(cwd, ["generate"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[snapshot-not-a-file]");
			expect(result.stderr).not.toContain("snapshot-unreadable");
		});

		it('names the blocking ancestor for snapshotPath: "parent/state.json", parent mode 000', async () => {
			await writeFixtureFile(
				cwd,
				"hejbro.config.ts",
				`import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "parent/state.json",
	prefixStrategy: "timestamp",
});
`,
			);
			await writeSchema(SCHEMA_SOURCE);
			await mkdir(join(cwd, "parent"), { recursive: true });
			await chmod(join(cwd, "parent"), 0o000);

			const result = await runCli(cwd, ["generate"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[snapshot-unreadable]");
			expect(result.stderr).toContain("(EACCES)");
			expect(result.stderr).toContain('Next: check permissions on "parent"');
			expect(result.stderr).not.toContain(cwd);
		});

		it('names the deepest blocking ancestor for snapshotPath: "nx/a/state.json", nx mode 000 (not nx/a)', async () => {
			await writeFixtureFile(
				cwd,
				"hejbro.config.ts",
				`import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "nx/a/state.json",
	prefixStrategy: "timestamp",
});
`,
			);
			await writeSchema(SCHEMA_SOURCE);
			await mkdir(join(cwd, "nx", "a"), { recursive: true });
			await chmod(join(cwd, "nx"), 0o000);

			const result = await runCli(cwd, ["generate"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[snapshot-unreadable]");
			expect(result.stderr).toContain('Next: check permissions on "nx"');
		});
	},
);

// #846 D2/D3, NB2/NB6: the read side used to stat the separator-stripped
// snapshot path but read the unstripped one, and a dangling link or a
// file/link ancestor on the way to it surfaced as an unrelated
// permissions failure or a false "not found" -- one configuration, two
// answers. `readSnapshotFileText` now judges the same tree `hejbro init`
// does, through the shared `probePath` (#846 D2): a link by its target,
// an ancestor by its own kind.
describe("hejbro generate/verify/check/baseline / the snapshot path judged as init does (#846 D2/D3)", () => {
	const customConfig = (
		snapshotPathValue: string,
	): string => `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "${snapshotPathValue}",
	prefixStrategy: "timestamp",
});
`;

	const envWithoutDatabaseUrl = (): NodeJS.ProcessEnv => {
		const { DATABASE_URL, ...rest } = process.env;
		return rest;
	};

	type RunCliResult = Awaited<ReturnType<typeof runCli>>;

	type SnapshotAncestorRow = {
		readonly label: string;
		readonly commands: ReadonlyArray<string>;
		readonly setup: (fixtureCwd: string) => Promise<void>;
		readonly assert: (
			result: RunCliResult,
			fixtureCwd: string,
		) => Promise<void> | void;
		readonly compareInit?: (initResult: RunCliResult) => void;
	};

	const noRawLeaks = (result: RunCliResult, fixtureCwd: string): void => {
		expect(result.stderr).not.toContain(fixtureCwd);
		expect(result.stderr).not.toContain("ENOENT");
		expect(result.stderr).not.toContain("ENOTDIR");
	};

	const rows: ReadonlyArray<SnapshotAncestorRow> = [
		{
			label:
				"a dangling link at the default snapshotPath, never read as absent",
			commands: ["generate", "baseline", "verify", "check"],
			setup: async (fixtureCwd) => {
				await writeFixtureFile(fixtureCwd, "hejbro.config.ts", CONFIG_SOURCE);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await symlink("nowhere", join(fixtureCwd, "hejbro.snapshot.json"));
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[snapshot-not-a-file]");
				expect(result.stderr).toContain("hejbro.snapshot.json");
				expect(result.stderr).toContain("nowhere");
				expect(result.stderr).not.toContain("snapshot-not-found");
				expect(existsSync(join(fixtureCwd, "nowhere"))).toBe(false);
				noRawLeaks(result, fixtureCwd);
			},
			compareInit: (initResult) => {
				expect(initResult.stderr).toContain("error[init-path-conflict]");
				expect(initResult.stderr).toContain("hejbro.snapshot.json");
				expect(initResult.stderr).toContain("nowhere");
			},
		},
		{
			label: "f/state.json, f a regular file",
			commands: ["generate", "verify"],
			setup: async (fixtureCwd) => {
				await writeFixtureFile(
					fixtureCwd,
					"hejbro.config.ts",
					customConfig("f/state.json"),
				);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await writeFixtureFile(fixtureCwd, "f", "not a directory");
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[snapshot-unreadable]");
				expect(result.stderr).toContain('"f" is a file');
				expect(result.stderr).toContain('Next: move or remove the file at "f"');
				expect(result.stderr).not.toContain(
					'check permissions on "f/state.json"',
				);
				noRawLeaks(result, fixtureCwd);
			},
			compareInit: (initResult) => {
				expect(initResult.stderr).toContain("error[init-path-conflict]");
				expect(initResult.stderr).toContain('"f"');
			},
		},
		{
			label: "lnk/state.json, lnk -> nowhere (ancestor dangling link)",
			commands: ["generate"],
			setup: async (fixtureCwd) => {
				await writeFixtureFile(
					fixtureCwd,
					"hejbro.config.ts",
					customConfig("lnk/state.json"),
				);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await symlink("nowhere", join(fixtureCwd, "lnk"));
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[snapshot-unreadable]");
				expect(result.stderr).toContain("lnk");
				expect(result.stderr).toContain("nowhere");
				noRawLeaks(result, fixtureCwd);
			},
			compareInit: (initResult) => {
				expect(initResult.stderr).toContain("error[init-path-conflict]");
				expect(initResult.stderr).toContain("lnk");
				expect(initResult.stderr).toContain("nowhere");
			},
		},
		{
			label: "loop/state.json, loop -> loop (a non-permission ancestor code)",
			commands: ["generate"],
			setup: async (fixtureCwd) => {
				await writeFixtureFile(
					fixtureCwd,
					"hejbro.config.ts",
					customConfig("loop/state.json"),
				);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await symlink("loop", join(fixtureCwd, "loop"));
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[snapshot-unreadable]");
				expect(result.stderr).toContain("(ELOOP)");
				expect(result.stderr).toContain('Next: check what "loop" points at');
				expect(result.stderr).not.toContain("permissions");
				noRawLeaks(result, fixtureCwd);
			},
		},
	];

	const expandedRows = rows.flatMap((row) =>
		row.commands.map((command) => ({ ...row, command })),
	);

	it.each(expandedRows)(
		"judges the snapshot path as init does: a link by its target, an ancestor by its kind ($label, $command)",
		async ({ setup, assert, compareInit, command }) => {
			await setup(cwd);

			const result = await runCli(cwd, [command], {
				env: envWithoutDatabaseUrl(),
			});

			await assert(result, cwd);

			if (compareInit !== undefined) {
				const initResult = await runCli(cwd, ["init"]);
				compareInit(initResult);
			}
		},
	);

	it("reads through a link to a directory as snapshot-not-a-file (control)", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeSchema(SCHEMA_SOURCE);
		await mkdir(join(cwd, "realdir"), { recursive: true });
		await symlink("realdir", join(cwd, "hejbro.snapshot.json"));

		const result = await runCli(cwd, ["generate"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[snapshot-not-a-file]");
	});

	it("reads through a link to a regular snapshot file as today (control)", async () => {
		const initResult = await runCli(cwd, ["init"]);
		expect(initResult.exitCode).toBe(0);
		await writeSchema(SCHEMA_SOURCE);
		const snapshotContent = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		await rm(join(cwd, "hejbro.snapshot.json"));
		await writeFixtureFile(cwd, "real.json", snapshotContent);
		await symlink("real.json", join(cwd, "hejbro.snapshot.json"));

		const result = await runCli(cwd, ["generate"]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("error[");
	});
});

// #820, D4: `listMigrationFiles` used to `readdirSync` a configured
// `migrationsDir` directly -- a file there crashed every command that
// lists it with a raw `ENOTDIR`. `probePath` (#846 D2) judges the same
// tree `hejbro init` does before listing.
describe("hejbro generate/verify/baseline/history/status/migrate / migrationsDir judged as init does (#820, #846 D4)", () => {
	const git = (fixtureCwd: string, args: ReadonlyArray<string>): string =>
		execFileSync("git", args, {
			cwd: fixtureCwd,
			encoding: "utf8",
			env: GIT_TEST_ENV,
		});

	const commandArgsFor = (command: string): ReadonlyArray<string> => {
		if (command === "status" || command === "migrate") {
			return [command, "--url", "postgres://127.0.0.1:1/x"];
		}
		return [command];
	};

	const envWithoutDatabaseUrl = (): NodeJS.ProcessEnv => {
		const { DATABASE_URL, ...rest } = process.env;
		return rest;
	};

	type RunCliResult = Awaited<ReturnType<typeof runCli>>;

	type MigrationsDirRow = {
		readonly label: string;
		readonly commands: ReadonlyArray<string>;
		readonly setup: (fixtureCwd: string) => Promise<void>;
		readonly assert: (
			result: RunCliResult,
			fixtureCwd: string,
			command: string,
		) => Promise<void> | void;
	};

	// `migrate`'s own convention (unrelated to this change): every
	// precondition refusal before a statement is sent answers `2`, never
	// `1` -- neither is the database refusing a migration.
	const expectedExitCodeFor = (command: string): number => {
		if (command === "migrate") {
			return 2;
		}
		return 1;
	};

	const initWithSchemaAndGit = async (fixtureCwd: string): Promise<void> => {
		await runCli(fixtureCwd, ["init"]);
		await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
		git(fixtureCwd, ["init", "-q", "-b", "main"]);
	};

	const replaceMigrationsDirWithFile = async (
		fixtureCwd: string,
	): Promise<void> => {
		await rm(join(fixtureCwd, "migrations"), {
			recursive: true,
			force: true,
		});
		await writeFixtureFile(fixtureCwd, "migrations", "not a directory");
	};

	const rows: ReadonlyArray<MigrationsDirRow> = [
		{
			label: "a regular file at migrationsDir",
			commands: [
				"generate",
				"verify",
				"baseline",
				"history",
				"status",
				"migrate",
			],
			setup: async (fixtureCwd) => {
				await initWithSchemaAndGit(fixtureCwd);
				await replaceMigrationsDirWithFile(fixtureCwd);
			},
			assert: async (result, fixtureCwd, command) => {
				expect(result.exitCode).toBe(expectedExitCodeFor(command));
				expect(result.stderr).toContain(
					"error[migrations-dir-not-a-directory]",
				);
				expect(result.stderr).toContain("migrations");
				expect(result.stderr).toContain("Next:");
				expect(result.stderr).not.toContain("ENOTDIR");
				expect(result.stderr).not.toContain(fixtureCwd);
				const snapshotContent = await readFile(
					join(fixtureCwd, "hejbro.snapshot.json"),
					"utf8",
				);
				expect(snapshotContent).toContain('"formatVersion"');
			},
		},
		{
			label: "a dangling link at migrationsDir",
			commands: ["generate"],
			setup: async (fixtureCwd) => {
				await runCli(fixtureCwd, ["init"]);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await rm(join(fixtureCwd, "migrations"), {
					recursive: true,
					force: true,
				});
				await symlink("nowhere", join(fixtureCwd, "migrations"));
			},
			assert: (result, fixtureCwd) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(
					"error[migrations-dir-not-a-directory]",
				);
				expect(result.stderr).toContain("migrations");
				expect(result.stderr).toContain("nowhere");
				expect(existsSync(join(fixtureCwd, "nowhere"))).toBe(false);
			},
		},
		{
			label: "nx/mig, nx mode 000",
			commands: ["generate", "verify"],
			setup: async (fixtureCwd) => {
				await writeFixtureFile(
					fixtureCwd,
					"hejbro.config.ts",
					`import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "nx/mig",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`,
				);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await writeFixtureFile(
					fixtureCwd,
					"hejbro.snapshot.json",
					'{ "dialect": "postgres", "formatVersion": 8, "objects": {} }',
				);
				await mkdir(join(fixtureCwd, "nx"), { recursive: true });
				await chmod(join(fixtureCwd, "nx"), 0o000);
			},
			assert: (result) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[migrations-dir-unreadable]");
				expect(result.stderr).toContain("(EACCES)");
				expect(result.stderr).toContain('Next: check permissions on "nx"');
			},
		},
		{
			label: "f/mig, f a regular file",
			commands: ["generate"],
			setup: async (fixtureCwd) => {
				await writeFixtureFile(
					fixtureCwd,
					"hejbro.config.ts",
					`import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "f/mig",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`,
				);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await writeFixtureFile(
					fixtureCwd,
					"hejbro.snapshot.json",
					'{ "dialect": "postgres", "formatVersion": 8, "objects": {} }',
				);
				await writeFixtureFile(fixtureCwd, "f", "not a directory");
			},
			assert: (result) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[migrations-dir-unreadable]");
				expect(result.stderr).toContain('"f" is a file');
				expect(result.stderr).toContain('Next: move or remove the file at "f"');
			},
		},
		{
			label: "the migrations directory itself, mode 000",
			commands: ["generate"],
			setup: async (fixtureCwd) => {
				await runCli(fixtureCwd, ["init"]);
				await writeFixtureFile(fixtureCwd, "src/app.schema.ts", SCHEMA_SOURCE);
				await chmod(join(fixtureCwd, "migrations"), 0o000);
			},
			assert: (result) => {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[migrations-dir-unreadable]");
				expect(result.stderr).toContain("(EACCES)");
				expect(result.stderr).toContain("cannot list it");
				expect(result.stderr).toContain('"migrations"');
			},
		},
	];

	const expandedRows = rows.flatMap((row) =>
		row.commands.map((command) => ({ ...row, command })),
	);

	afterEach(async () => {
		await Promise.all(
			["nx", "migrations"].map(async (name) => {
				const candidate = join(cwd, name);
				if (!existsSync(candidate)) {
					return;
				}
				await chmod(candidate, 0o755);
			}),
		);
	});

	const runOptionsFor = (
		command: string,
	): { readonly env: NodeJS.ProcessEnv } | Record<string, never> => {
		if (command === "status" || command === "migrate") {
			return {};
		}
		return { env: envWithoutDatabaseUrl() };
	};

	it.each(expandedRows)(
		"refuses a migrations directory that is not a directory with its own code, never ENOTDIR ($label, $command)",
		async ({ setup, assert, command }) => {
			await setup(cwd);

			const result = await runCli(
				cwd,
				commandArgsFor(command),
				runOptionsFor(command),
			);

			await assert(result, cwd, command);
		},
	);

	it("still lists through a link to a directory holding migrations (control)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		const firstGenerate = await runCli(cwd, ["generate"]);
		expect(firstGenerate.exitCode).toBe(0);
		await rm(join(cwd, "migrations"), { recursive: true, force: true });
		await mkdir(join(cwd, "realmig"), { recursive: true });
		await symlink("realmig", join(cwd, "migrations"));
		await writeSchema(SCHEMA_WITH_NOT_NULL_COLUMN_SOURCE);

		const result = await runCli(cwd, ["generate"]);

		expect(result.exitCode).toBe(0);
		const migFiles = await readdir(join(cwd, "realmig"));
		expect(migFiles.filter((name) => name.endsWith(".sql")).length).toBe(1);
	});

	it("nothing at migrationsDir still writes a migration, creating the directory (control)", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeSchema(SCHEMA_SOURCE);
		await writeFixtureFile(
			cwd,
			"hejbro.snapshot.json",
			'{ "dialect": "postgres", "formatVersion": 8, "objects": {} }',
		);

		const result = await runCli(cwd, ["generate"]);

		expect(result.exitCode).toBe(0);
		expect(existsSync(join(cwd, "migrations"))).toBe(true);
	});

	it("nothing at migrationsDir still proceeds to the connection for status (control: absent is not a fault)", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);

		const result = await runCli(cwd, [
			"status",
			"--url",
			"postgres://127.0.0.1:1/x",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).not.toContain("migrations-dir");
	});
});

// #846 D5 (#830, NB8): an empty --config value used to resolve to cwd
// and refuse it as an existing "directory"; a directory at --config
// reached jiti and leaked an absolute path in a config-load-failed
// diagnostic instead of a coded refusal.
describe("hejbro generate / --config names a file (#846 D5)", () => {
	it("refuses --config= as invalid-config-flag, never resolving it to the working directory", async () => {
		const result = await runCli(cwd, ["generate", "--config="]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-config-flag]");
		expect(result.stderr).not.toContain("directory");
	});

	it("refuses --config . as config-not-a-file naming ./, never an absolute path", async () => {
		const result = await runCli(cwd, ["generate", "--config", "."]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[config-not-a-file]");
		expect(result.stderr).toContain("./");
		expect(result.stderr).not.toContain(cwd);
	});

	// #846 review B3: the header and the "found at" body clause stay
	// cwd-relative (the report rule), but Next: echoes the absolute
	// --config value verbatim -- the one documented exception to D57.
	// An absolute path unrelated to `cwd` (never a path under `cwd`,
	// whose own string form can differ from the spawned process's
	// resolved `process.cwd()` on macOS's /tmp -> /private/tmp symlink)
	// keeps this test's own assertions independent of that resolution.
	it("echoes an absolute --config value verbatim in Next:, while the header and body stay relative", async () => {
		const absolutePath = "/nonexistent-hejbro-review-b3/hejbro.config.ts";
		const result = await runCli(cwd, ["generate", "--config", absolutePath]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[config-not-found]");
		const nextIndex = result.stderr.indexOf("Next:");
		const body = result.stderr.slice(0, nextIndex);
		const next = result.stderr.slice(nextIndex);
		// The body's own label is relative (a "../" chain out of cwd),
		// never the exact absolute value quoted on its own.
		expect(body).not.toContain(`"${absolutePath}"`);
		expect(next).toContain(`--config ${absolutePath}`);
	});
});

// #846 review B1: identityFromMessage's own accidental quoted-pair match
// broke the diagnostic header for every command that reports this
// field's directory-spelling refusal -- the header read as a fragment of
// the message body instead of "snapshotPath".
describe('hejbro / snapshotPath: "." reports a clean header on every command (#846 review B1)', () => {
	const configWithDotSnapshot = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: ".",
	prefixStrategy: "timestamp",
});
`;

	it.each(["init", "generate", "verify", "history"])(
		"reports error[invalid-config]: snapshotPath as the header (%s)",
		async (command) => {
			await writeFixtureFile(cwd, "hejbro.config.ts", configWithDotSnapshot);

			const result = await runCli(cwd, [command]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr.split("\n")[0]).toBe(
				"error[invalid-config]: snapshotPath",
			);
		},
	);
});

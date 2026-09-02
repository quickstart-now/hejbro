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

// D106 R5, R5-B1: the evaluator's own flagship reproduction, repro ① --
// a plain managed table, no existingTable() anywhere in the project.
// serializeIndexes doesn't sort, so swapping the two index() calls below
// moves the snapshot with no KindChange to emit (managed:managed,
// diffByKey is name-keyed).
const SCHEMA_WITH_TWO_INDEXES_SOURCE = `import { index, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
}, (t) => ({ indexes: [index().on(t.title), index().on(t.body)] }));
`;

const SCHEMA_WITH_TWO_INDEXES_REORDERED_SOURCE = `import { index, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
}, (t) => ({ indexes: [index().on(t.body), index().on(t.title)] }));
`;

// D106 R5, R5-B1: repro ② -- the same shape, on `checks` instead of
// `indexes` (serializeChecks doesn't sort either).
const SCHEMA_WITH_TWO_CHECKS_SOURCE = `import { check, gt, schema, table, integer, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	a: integer().notNull(),
	b: integer().notNull(),
}, (t) => ({ checks: [check("a_pos", gt(t.a, 0)), check("b_pos", gt(t.b, 0))] }));
`;

const SCHEMA_WITH_TWO_CHECKS_REORDERED_SOURCE = `import { check, gt, schema, table, integer, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	a: integer().notNull(),
	b: integer().notNull(),
}, (t) => ({ checks: [check("b_pos", gt(t.b, 0)), check("a_pos", gt(t.a, 0))] }));
`;

// D106 R5, R5-B1: repro ③ -- inside this change's own feature surface,
// the same index reorder alongside a real existingTable() and a managed
// FK onto it, so the scan crosses an existing:existing (unchanged,
// reshapedOrNull -> null) table before reaching the managed one.
const SCHEMA_WITH_EXISTING_AND_REORDERED_INDEXES_SOURCE = `import { existingTable, index, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const authUsers = existingTable("auth", "users", { id: uuid() });

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
	authorId: uuid().references(() => authUsers.id),
}, (t) => ({ indexes: [index().on(t.title), index().on(t.body)] }));
`;

const SCHEMA_WITH_EXISTING_AND_REORDERED_INDEXES_SWAPPED_SOURCE = `import { existingTable, index, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const authUsers = existingTable("auth", "users", { id: uuid() });

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
	authorId: uuid().references(() => authUsers.id),
}, (t) => ({ indexes: [index().on(t.body), index().on(t.title)] }));
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

	// D106 R5, R5-B1 repro ①: the evaluator's own flagship reproduction --
	// reordering two index() declarations on a plain managed table (no
	// existingTable() anywhere in the project) used to crash generate with
	// `existing-transition-not-found`. Fixed by the restate fallback
	// (D106 R5, J17).
	it("reordering two index() declarations on a managed table writes a restate migration instead of crashing (D106 R5, R5-B1 repro ①)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_WITH_TWO_INDEXES_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeSchema(SCHEMA_WITH_TWO_INDEXES_REORDERED_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("wrote migrations/");
		expect(result.stdout).toContain("carries no statements.");

		const names = await sqlFileNames();
		expect(names.some((name) => name.endsWith("_restate_posts.sql"))).toBe(
			true,
		);

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// D106 R5, R5-B1 repro ②: the same shape on `checks` instead of
	// `indexes`.
	it("reordering two check() declarations on a managed table writes a restate migration instead of crashing (D106 R5, R5-B1 repro ②)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_WITH_TWO_CHECKS_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeSchema(SCHEMA_WITH_TWO_CHECKS_REORDERED_SOURCE);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("wrote migrations/");
		expect(result.stdout).toContain("carries no statements.");

		const names = await sqlFileNames();
		expect(names.some((name) => name.endsWith("_restate_posts.sql"))).toBe(
			true,
		);

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// D106 R5, R5-B1 repro ③: inside this change's own feature surface --
	// the same index reorder alongside a real existingTable() and a
	// managed FK onto it, so the scan crosses an unchanged existing:existing
	// table before reaching the managed one that actually moved.
	it("an index reorder in a project that also declares an existingTable() still restates the managed table, not the existing one (D106 R5, R5-B1 repro ③)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_WITH_EXISTING_AND_REORDERED_INDEXES_SOURCE);
		await runCli(cwd, ["generate"]);
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);

		await writeSchema(
			SCHEMA_WITH_EXISTING_AND_REORDERED_INDEXES_SWAPPED_SOURCE,
		);
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("wrote migrations/");
		expect(result.stdout).toContain("carries no statements.");

		const names = await sqlFileNames();
		expect(names.some((name) => name.endsWith("_restate_posts.sql"))).toBe(
			true,
		);

		const verify = await runCli(cwd, ["verify"]);
		expect(verify.exitCode).toBe(0);
	});

	// D106 R5, R5-B1: the restate slug is deterministic across two
	// entirely independent projects, the same way R3-B1/R4-B1 measurement
	// already proved for the other verbs.
	it("the restate migration's own slug is deterministic across two independent runs (D106 R5, R5-B1)", async () => {
		const stripPrefix = (fileName: string): string =>
			fileName.replace(/^\d+_/, "");

		const cwdA = await createCliFixtureDir();
		const cwdB = await createCliFixtureDir();
		try {
			for (const target of [cwdA, cwdB]) {
				await runCli(target, ["init"]);
				await writeFixtureFile(
					target,
					"src/app.schema.ts",
					SCHEMA_WITH_TWO_INDEXES_SOURCE,
				);
				await runCli(target, ["generate"]);
				await writeFixtureFile(
					target,
					"src/app.schema.ts",
					SCHEMA_WITH_TWO_INDEXES_REORDERED_SOURCE,
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
			expect(stripPrefix(namesA[1] as string)).toBe("restate_posts.sql");
		} finally {
			await removeCliFixtureDir(cwdA);
			await removeCliFixtureDir(cwdB);
		}
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

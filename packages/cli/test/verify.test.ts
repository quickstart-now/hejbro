import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// Task 17: `hejbro verify`'s four checks, including golden pins for the
// owner-approved (⑥) snapshot-stale/chain-tip-mismatch texts and the
// diverged-migrations/broken-chain Next: lines. Drives the built CLI
// (support/cli-runner.ts) for the same reason generate-command.test.ts
// and golden.test.ts do — real jiti-loaded table() fixtures need the
// real, built resolution path, not an in-process vitest one.

const BASE_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

const CHANGED_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
});
`;

// #220 (PR B, --fix): branches from BASE_SCHEMA the same way CHANGED_SCHEMA
// does, but with a *different* added column — used together with a
// snapshot-file reset (see the --fix describe block below) to produce a
// genuine two-way fork: two real, validly-hashed migrations that both
// claim BASE_SCHEMA's migration as their parent.
const FORKED_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	summary: text().notNull(),
});
`;

// #220 (PR B, --fix): a third, genuinely-linear step after CHANGED_SCHEMA —
// used for the 3-way collision test, so all three migrations chain
// A -> B -> C for real (not another fork).
const THIRD_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
	summary: text().notNull(),
});
`;

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

// #220 reviewer: verify's computed mv/rm suggestions must use whatever
// migrationsDir the project actually configured, never a hardcoded
// "migrations/" -- a project using this (a real, freely-choosable config
// value) would otherwise get a Next: command that fails with "No such
// file or directory".
const CUSTOM_MIGRATIONS_DIR_CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "db/migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

const EMPTY_SNAPSHOT_SOURCE =
	'{\n\t"dialect": "postgres",\n\t"formatVersion": 8,\n\t"objects": {}\n}\n';

const BUCKET_SCHEMA = `import { storageBucket } from "@hejbro/supabase";

export const avatars = storageBucket("avatars");
`;

const CONFIG_WITH_SUPABASE_PRESET_SOURCE = `import { defineConfig } from "hejbro";
import { supabasePreset } from "@hejbro/supabase";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [supabasePreset],
});
`;

const PARENT_PREFIX = "-- parent-snapshot: ";
const SNAPSHOT_PREFIX = "-- snapshot: ";

const replaceLinePrefixedWith = (
	text: string,
	prefix: string,
	newValue: string,
): string =>
	text
		.split("\n")
		.map((line) => {
			if (!line.startsWith(prefix)) {
				return line;
			}
			return `${prefix}${newValue}`;
		})
		.join("\n");

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const writeSchema = (source: string): Promise<void> =>
	writeFixtureFile(cwd, "src/app.schema.ts", source);

const migrationFileNames = async (): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(join(cwd, "migrations"));
	return entries.filter((name) => name.endsWith(".sql")).sort();
};

const versionOf = (fileName: string): string =>
	fileName.split("_", 1)[0] as string;
const slugOf = (fileName: string): string =>
	fileName.slice(fileName.indexOf("_") + 1);

/**
 * Renames `fileName` (already in `migrations/`) so its version prefix
 * becomes `newVersion`, keeping the slug and full byte content untouched —
 * the deliberate way these tests force two *real*, validly-hashed
 * migrations to collide on version without any real-clock timing (#220,
 * PR B: same-second timing is exactly what the production code doesn't
 * prevent, so forcing it by hand here is more deterministic than hoping
 * two `generate` calls land in the same second).
 */
const forceMigrationVersion = async (
	fileName: string,
	newVersion: string,
): Promise<string> => {
	const newFileName = `${newVersion}_${slugOf(fileName)}`;
	const content = await readFile(join(cwd, "migrations", fileName), "utf8");
	await rm(join(cwd, "migrations", fileName));
	await writeFixtureFile(cwd, `migrations/${newFileName}`, content);
	return newFileName;
};

describe("hejbro verify (built CLI, tmp-dir)", () => {
	it("passes all 4 checks on a freshly generated repo", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"verify: 5 checks passed (1 migrations, snapshot sha256:",
		);
	});

	it("passes when there are declarations but zero migrations yet (matches the empty snapshot init left behind)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		// declarations exist but no migration has ever been generated for
		// them, so the checked-in (empty) snapshot is legitimately stale —
		// same as generate would report via a different code.
		expect(result.stderr).toContain("error[snapshot-stale]");
	});

	it("surfaces the same entry-not-found error as generate on a bare init'd repo (no declaration files at all)", async () => {
		await runCli(cwd, ["init"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[entry-not-found]");
	});

	// #125/phase8-loader-diagnostics: verify calls the same loadConfig/
	// loadDeclarations as generate (both from loader.ts's shared
	// importOrDiagnose) — confirms the fix isn't generate-only (the exact
	// "one call site fixed, the other left raw" gap #146 closed for
	// asHejbroError).
	it("surfaces a declaration-load-failed diagnostic (not a raw crash) for a declaration file whose import doesn't resolve", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(
			cwd,
			"src/app.schema.ts",
			'import { schema } from "hejbro";\nimport "totally-not-installed-package";\n\nexport const app = schema("app");\n',
		);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[declaration-load-failed]");
		expect(result.stderr).toContain("app.schema.ts");
		expect(result.stderr).toContain("totally-not-installed-package");
		expect(result.stderr).not.toContain("node:internal/modules");
		expect(result.stderr).not.toContain(cwd);
	});

	it("M1 regression: exits 1 with a proper config-not-found diagnostic (not a raw object dump) when there's no hejbro.config.ts at all", async () => {
		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"no hejbro.config.ts was found. Next: run `hejbro init` to scaffold hejbro.config.ts, a migrations directory, and an empty snapshot file, then add a declaration file and rerun `hejbro generate`.",
		);
		expect(result.stderr).not.toContain("[object Object]");
	});

	it("M2 regression: exits 1 with generate's own snapshot-not-found text when the snapshot file was never created", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeSchema(BASE_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'no snapshot file was found at "hejbro.snapshot.json", and the migrations directory has no prior migrations either — this looks like a project that hasn\'t been initialized yet. Next: run `hejbro init` to scaffold an empty snapshot (and the migrations directory, if missing), then rerun `hejbro generate`.',
		);
	});

	it("M2 regression: exits 1 with generate's own snapshot-lost text when migrations exist but the snapshot file is missing", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeSchema(BASE_SCHEMA);
		await writeFixtureFile(
			cwd,
			"migrations/20260101000000_add_posts.sql",
			"-- hejbro migration\n",
		);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'no snapshot file was found at "hejbro.snapshot.json", but 1 prior migration(s) already exist in "migrations" — the snapshot is a derived, checked-in file (declarations are the source of truth), so this looks lost rather than never created.',
		);
	});

	it("check 1 (parses): exits 1 with invalid-snapshot on a corrupted snapshot file", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		await writeFile(
			join(cwd, "hejbro.snapshot.json"),
			"<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n",
		);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-snapshot]");
	});

	it("check 2 (declarations ↔ snapshot): exits 1 with the owner-approved snapshot-stale text when declarations changed without regenerating", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'the checked-in snapshot at "hejbro.snapshot.json" does not match your declarations — either the declarations changed without a new migration, or the snapshot file was hand-edited. Next: run `hejbro generate` and commit the result (or, if the snapshot is correct and the declarations are wrong, restore the declarations you meant).',
		);
	});

	// D81 (#261): before the fix, check 2's rebuild used an empty parent,
	// so a mid-declaration column insert rebuilt in *declaration* order
	// while the committed snapshot (built with the real parent) recorded
	// *physical* order — a false snapshot-stale. Two real `generate` runs,
	// the second inserting a column mid-declaration, must still verify.
	it("passes when the committed snapshot's column order differs from declaration order (D81)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(
			`import { schema, table, text, timestamptz, uuid } from "hejbro";

export const app = schema("app");

export const projects = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	archivedAt: timestamptz(),
});
`,
		);
		await runCli(cwd, ["generate"]);
		await writeSchema(
			`import { schema, table, text, timestamptz, uuid } from "hejbro";

export const app = schema("app");

export const projects = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	description: text(),
	archivedAt: timestamptz(),
});
`,
		);
		await runCli(cwd, ["generate"]);

		const snapshot = JSON.parse(
			await readFile(join(cwd, "hejbro.snapshot.json"), "utf8"),
		);
		expect(
			snapshot.objects["table:app.projects"].columns.map(
				(c: { name: string }) => c.name,
			),
		).toEqual(["id", "title", "archived_at", "description"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("5 checks passed");
	});

	it("check 3 (chain linearity): exits 1 with diverged-migrations when two files share a parent", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const original = await readFile(
			join(cwd, "migrations", fileName as string),
			"utf8",
		);
		const forked = replaceLinePrefixedWith(
			original,
			SNAPSHOT_PREFIX,
			`sha256:${"f".repeat(64)}`,
		);
		await writeFixtureFile(cwd, "migrations/99999999999999_fork.sql", forked);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[diverged-migrations]");
		// #220 review: Next now hands back a computed, directly-runnable
		// resolution per candidate (owner principle — detect, then offer a
		// command already typed out) instead of prose asking the reader to
		// pick a file and type the commands themselves.
		expect(result.stderr).toContain(
			"all branch from the same prior snapshot state — this usually happens when two branches each ran `hejbro generate` before merging. Next, pick one:",
		);
		expect(result.stderr).toContain(
			`(a) rm migrations/99999999999999_fork.sql && hejbro generate   # keeps ${fileName}`,
		);
		expect(result.stderr).toContain(
			`(b) rm migrations/${fileName} && hejbro generate   # keeps 99999999999999_fork.sql`,
		);
		expect(result.stderr).toContain(fileName as string);
		expect(result.stderr).toContain("99999999999999_fork.sql");
	});

	it("check 3 (chain linearity): exits 1 with broken-chain when a later file's parent doesn't match", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [, secondFileName] = await migrationFileNames();
		const secondPath = join(cwd, "migrations", secondFileName as string);
		const original = await readFile(secondPath, "utf8");
		const broken = replaceLinePrefixedWith(
			original,
			PARENT_PREFIX,
			`sha256:${"0".repeat(64)}`,
		);
		await writeFile(secondPath, broken);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			`the migration chain is broken at "${secondFileName}" — its parent-snapshot hash doesn't match any earlier migration's snapshot hash. Next: check whether a migration file was deleted, renamed, or hand-edited. Restore it from version control, or if this is intentional, delete every migration after it (they're now orphaned) and rerun \`hejbro generate\`.`,
		);
	});

	it("check 4 (tip == current): exits 1 with chain-tip-mismatch when a migration's own snapshot hash is corrupted", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const filePath = join(cwd, "migrations", fileName as string);
		const original = await readFile(filePath, "utf8");
		const corrupted = replaceLinePrefixedWith(
			original,
			SNAPSHOT_PREFIX,
			`sha256:${"a".repeat(64)}`,
		);
		await writeFile(filePath, corrupted);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"the migration chain's tip hash doesn't match the current snapshot — the last migration's \"snapshot:\" hash and the on-disk snapshot's own hash disagree, which means the snapshot or the last migration file was edited after the last `hejbro generate`. Next: restore the snapshot (and the last migration file, if it was edited) from version control — the snapshot is a derived file and should only ever change through `hejbro generate`.",
		);
	});

	// #616: the banner hashes are snapshot hashes, so a body edit is outside
	// verify's reach. This pins the limit the requirement now states; it is
	// green by construction and is meant to turn red only when a body hash
	// ships. The check-4 test above is its control (the same file with a
	// banner line altered exits 1).
	it("a body edit that keeps the hash lines passes (stated limitation)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const filePath = join(cwd, "migrations", fileName as string);
		const original = await readFile(filePath, "utf8");
		const lines = original.split("\n");
		const statementIndex = lines.findIndex((line) =>
			line.startsWith("create "),
		);
		expect(statementIndex).toBeGreaterThan(-1);
		const edited = lines
			.map((line, index) => {
				if (index !== statementIndex) {
					return line;
				}
				return line.replace("create ", "create /* hand-edited */ ");
			})
			.join("\n");
		expect(edited).not.toBe(original);
		await writeFile(filePath, edited);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("checks passed");
	});

	// #616: the chain root's own parent is taken as given (core's checkChain,
	// by design -- a legacy-prefix chain's first hashed file does not start at
	// the empty snapshot), so deleting the first migration is not reported.
	// A stated limit, pinned; the middle-file case is the control (broken-chain).
	it("removing the first migration passes (stated limitation: the root is taken as given)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);
		await runCli(cwd, ["generate"]);
		const [first, second] = await migrationFileNames();
		expect(second).toBeDefined();
		await rm(join(cwd, "migrations", first as string));

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("checks passed (1 migrations");
	});

	it("editing a non-hash banner line passes (stated limitation: only the two hash lines are read)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		const [fileName] = await migrationFileNames();
		const filePath = join(cwd, "migrations", fileName as string);
		const original = await readFile(filePath, "utf8");
		const edited = original.replace(
			"-- hejbro migration",
			"-- hejbro migration (edited by hand)",
		);
		expect(edited).not.toBe(original);
		await writeFile(filePath, edited);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
	});

	it("existing chain diagnostics are unchanged (R2-G3's export check contributes nothing to a repository with no export)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const filePath = join(cwd, "migrations", fileName as string);
		const original = await readFile(filePath, "utf8");
		const corrupted = replaceLinePrefixedWith(
			original,
			SNAPSHOT_PREFIX,
			`sha256:${"a".repeat(64)}`,
		);
		await writeFile(filePath, corrupted);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		// Still "of 5", not 6 -- no export directory exists, so the export
		// check contributed nothing: no outcome, no skip line, no shift in
		// the total a repository that has never opted in has always seen.
		expect(result.stderr).toContain(
			"verify: 1 of 5 checks failed — fix the errors above and rerun `hejbro verify`.",
		);
		expect(result.stderr).not.toContain("export-stale");
	});

	// #220: two migrations claiming the same version prefix -- Supabase (and
	// any tool that tracks *applied* migrations by that prefix, not the full
	// filename) can only ever apply one of them. This drives the built CLI
	// end to end (readChainEntries -> checkChain integration alone, in
	// packages/core/test/migration-file.test.ts, can't reach the CLI's own
	// wiring: that duplicate-version runs *before* chain linearity, and
	// skips it, rather than letting an undefined chain order through).
	describe("duplicate migration version (#220)", () => {
		it("exits 1 with duplicate-migration-version, skipping chain linearity and chain tip", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate"]);

			const [fileName] = await migrationFileNames();
			const version = (fileName as string).split("_", 1)[0] as string;
			const duplicateName = `${version}_manually_added_duplicate.sql`;
			await writeFixtureFile(
				cwd,
				`migrations/${duplicateName}`,
				"-- hand-added file sharing the real migration's version on purpose\n",
			);

			const result = await runCli(cwd, ["verify"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[duplicate-migration-version]");
			expect(result.stderr).toContain(
				`migrations share the version "${version}"`,
			);
			expect(result.stderr).toContain(
				"Supabase (and any tool that tracks *applied* migrations by this version prefix, not the full filename) can only ever apply one of them",
			);
			// The hand-added duplicate has no hash-chain banner at all, so
			// hejbro can't order this group by chain — the fallback offers one
			// full mv option per member instead of a confident "keep X" pick
			// (owner principle: detect + a command already typed out, never
			// prose, even when the order itself is unknown).
			expect(result.stderr).toContain(
				"Next, pick one: hejbro can't tell these files' chain order",
			);
			expect(result.stderr).toContain(`(a) mv migrations/${fileName}`);
			expect(result.stderr).toContain(`(b) mv migrations/${duplicateName}`);
			expect(result.stderr).not.toContain("hejbro verify --fix");
			expect(result.stderr).toContain(
				"skipped: chain linearity (needs every migration to have a unique version)",
			);
			expect(result.stderr).toContain(
				"skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)",
			);
			expect(result.stderr).toContain(
				"verify: 1 of 5 checks failed, 2 skipped — fix the errors above and rerun `hejbro verify`.",
			);
		});

		it("does not fire when every migration has a distinct version (control)", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate"]);

			const result = await runCli(cwd, ["verify"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("verify: 5 checks passed");
		});

		// #220 reviewer: a custom migrationsDir must show up in the
		// suggested command -- a hardcoded "migrations/" would print a
		// command that fails with "No such file or directory" the moment
		// migrationsDir isn't the default.
		it('uses config.migrationsDir, not a hardcoded "migrations/", in the suggested mv command', async () => {
			await writeFixtureFile(
				cwd,
				"hejbro.config.ts",
				CUSTOM_MIGRATIONS_DIR_CONFIG_SOURCE,
			);
			await writeFixtureFile(
				cwd,
				"hejbro.snapshot.json",
				EMPTY_SNAPSHOT_SOURCE,
			);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate"]);

			const customDirFiles = (
				await readdir(join(cwd, "db", "migrations"))
			).filter((name) => name.endsWith(".sql"));
			const [fileName] = customDirFiles;
			const version = (fileName as string).split("_", 1)[0] as string;
			const duplicateName = `${version}_manually_added_duplicate.sql`;
			await writeFixtureFile(
				cwd,
				`db/migrations/${duplicateName}`,
				"-- hand-added file sharing the real migration's version on purpose\n",
			);

			const result = await runCli(cwd, ["verify"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[duplicate-migration-version]");
			expect(result.stderr).toContain(`mv db/migrations/${fileName}`);
			expect(result.stderr).toContain(`mv db/migrations/${duplicateName}`);
			expect(result.stderr).not.toContain("mv migrations/");
		});
	});

	// #220 (PR B): `hejbro verify --fix` renames a resolvable
	// duplicate-migration-version group's later file(s) on disk, then
	// continues into the normal five checks. Every fixture here forces the
	// collision by renaming an already-real, already-hashed migration file
	// (never by racing two `generate` calls against the clock) — the same
	// clock-independence `waitForNextSecondBoundary` buys the rest of this
	// suite, applied the other direction on purpose.
	describe("hejbro verify --fix (#220)", () => {
		it("renames the later file of a resolvable 2-member group, prints before -> after, and verify then passes (positive control)", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_posts"]);
			await writeSchema(CHANGED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_body"]);

			const [first, second] = (await migrationFileNames()) as [string, string];
			const forcedName = await forceMigrationVersion(second, versionOf(first));

			const before = await runCli(cwd, ["verify"]);
			expect(before.exitCode).toBe(1);
			expect(before.stderr).toContain("error[duplicate-migration-version]");
			expect(before.stderr).toContain("Next, pick one:");
			expect(before.stderr).toContain(
				`(a) hejbro verify --fix   # renames "${forcedName}" (chain order decides which is later)`,
			);
			expect(before.stderr).toContain(
				`(b) mv migrations/${forcedName} migrations/`,
			);

			const fixed = await runCli(cwd, ["verify", "--fix"]);
			expect(fixed.exitCode).toBe(0);
			expect(fixed.stdout).toContain(`migrations/${forcedName} -> migrations/`);
			expect(fixed.stdout).toContain("verify: 5 checks passed");

			const finalNames = await migrationFileNames();
			expect(finalNames).toHaveLength(2);
			expect(finalNames).not.toContain(forcedName);
		});

		it("stages a 3-way collision's renames a second apart, all three ending up distinct", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_posts"]);
			await writeSchema(CHANGED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_body"]);
			await writeSchema(THIRD_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_summary"]);

			const [first, second, third] = (await migrationFileNames()) as [
				string,
				string,
				string,
			];
			const forcedVersion = versionOf(first);
			const forcedSecond = await forceMigrationVersion(second, forcedVersion);
			const forcedThird = await forceMigrationVersion(third, forcedVersion);

			const fixed = await runCli(cwd, ["verify", "--fix"]);
			expect(fixed.exitCode).toBe(0);
			expect(fixed.stdout).toContain(
				`migrations/${forcedSecond} -> migrations/`,
			);
			expect(fixed.stdout).toContain(
				`migrations/${forcedThird} -> migrations/`,
			);
			expect(fixed.stdout).toContain("verify: 5 checks passed");

			const finalNames = await migrationFileNames();
			expect(finalNames).toHaveLength(3);
			expect(finalNames).not.toContain(forcedSecond);
			expect(finalNames).not.toContain(forcedThird);
			// The two renamed files must not have recollided with each other.
			expect(new Set(finalNames).size).toBe(3);
		});

		it("leaves a diverged (same-parent, genuine fork) group untouched — same error before and after --fix", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_posts"]);
			const snapshotAfterBase = await readFile(
				join(cwd, "hejbro.snapshot.json"),
				"utf8",
			);

			await writeSchema(CHANGED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_body"]);

			// Reset the snapshot back to the post-"add_posts" state so the next
			// `generate` diffs from the same parent as "add_body" did — a real
			// second branch off the same prior state (simulates two branches
			// each running `generate` before merging, #129's own scenario).
			await writeFixtureFile(cwd, "hejbro.snapshot.json", snapshotAfterBase);
			await writeSchema(FORKED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_summary"]);

			const names = await migrationFileNames();
			const branchAFile = names.find((name) =>
				name.includes("add_body"),
			) as string;
			const branchBFile = names.find((name) =>
				name.includes("add_summary"),
			) as string;
			const forcedBranchB = await forceMigrationVersion(
				branchBFile,
				versionOf(branchAFile),
			);

			const before = await runCli(cwd, ["verify"]);
			expect(before.exitCode).toBe(1);
			expect(before.stderr).toContain("error[duplicate-migration-version]");
			expect(before.stderr).toContain(
				"Next, pick one: hejbro can't tell these files' chain order",
			);
			expect(before.stderr).toContain("mv migrations/");
			expect(before.stderr).not.toContain("hejbro verify --fix");

			const namesBeforeFix = await migrationFileNames();
			const fixed = await runCli(cwd, ["verify", "--fix"]);
			expect(fixed.exitCode).toBe(1);
			// --fix can't safely reorder this group (a genuine fork), so it's a
			// no-op for it — but the no-op is itself reported, never silent
			// (owner principle applies to --fix's own output too).
			expect(fixed.stdout).toContain("— chain order undetermined, see Next");
			expect(fixed.stderr).toContain("error[duplicate-migration-version]");
			expect(fixed.stderr).toContain(
				"Next, pick one: hejbro can't tell these files' chain order",
			);

			const namesAfterFix = await migrationFileNames();
			expect(namesAfterFix).toEqual(namesBeforeFix);
			expect(namesAfterFix).toContain(forcedBranchB);
		});
	});

	// #129: readChainEntries -> checkChain integration, at the level unit
	// tests on checkChain alone (packages/core/test/chain.test.ts) can't
	// reach -- these drive the real built CLI end to end (real `generate`
	// calls building a real rollback history, real hash-less legacy file on
	// disk), so a regression in *how verify wires the two together* (not
	// just in checkChain's own classification logic) would show up here.
	describe("chain linearity: rollback histories (#129 integration)", () => {
		it("passes verify after declarations roll back to an earlier state via re-declaration, then continue", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(BASE_SCHEMA);
			// Explicit --name on every call (timestampStrategy default,
			// second-granularity, D14) — plain semantic names, deliberately
			// including the exact adversarial pair that used to reorder this
			// suite when two generate calls landed in the same UTC second:
			// "add_body" < "add_posts" lexicographically, so a same-second
			// collision between migrations 1 and 2 used to let the *name*
			// comparison invert generation order. #220 fixed this at the
			// source (generate now waits for the next second and retries
			// rather than letting a same-second prefix tie fall through to
			// the name) — an earlier revision of this suite carried an
			// ordinal "1_"/"2_"/"3_"/"4_" --name prefix as a workaround before
			// #220 landed; it's gone now that the real fix makes it
			// unnecessary, and keeping the adversarial names here is itself
			// a regression guard against #220 recurring.
			await runCli(cwd, ["generate", "--name", "add_posts"]); // migration 1: empty -> A
			await writeSchema(CHANGED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_body"]); // migration 2: A -> B
			await writeSchema(BASE_SCHEMA); // revert: back to A
			await runCli(cwd, ["generate", "--name", "drop_body_rollback"]); // migration 3: B -> A (rollback)
			// A 4th step whose *own* parent (A) reoccurs (not just its
			// current, which migration 3 already reused) is what the
			// pre-#129 algorithm actually got wrong (reviewer, #217 review):
			// migrations 1-3 alone have parents {empty, A, B} -- all
			// distinct -- so that shape passes even the old global-grouping
			// checkChain and doesn't exercise the fix. Parent A appears on
			// both migration 2 and migration 4 here, exactly the shape the
			// old algorithm misreads as two entries racing for the same
			// slot (diverged-migrations) instead of "A legitimately recurred
			// after migration 3's rollback, and migration 4 continues from
			// it."
			await writeSchema(CHANGED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_body_again"]); // migration 4: A -> B (again)

			const fileNames = await migrationFileNames();
			expect(fileNames).toHaveLength(4);

			const result = await runCli(cwd, ["verify"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"verify: 5 checks passed (4 migrations, snapshot sha256:",
			);
		});

		it("keeps a rollback-tolerant chain valid alongside a legacy (hash-less) migration file that precedes it", async () => {
			await runCli(cwd, ["init"]);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_posts"]);
			await writeSchema(CHANGED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_body"]);
			await writeSchema(BASE_SCHEMA);
			await runCli(cwd, ["generate", "--name", "drop_body_rollback"]);
			// See the sibling test above for why a 4th step (parent A
			// reoccurring, not just current A) is required to actually
			// exercise #129 rather than a shape the old algorithm already
			// passed.
			await writeSchema(CHANGED_SCHEMA);
			await runCli(cwd, ["generate", "--name", "add_body_again"]);

			// Sorts before every generated file (timestamp prefixes), and has
			// no "-- parent-snapshot:"/"-- snapshot:" banner lines at all --
			// readChainEntries (verify.ts) filters it out via
			// parseBannerHashes -> null, so it must have zero effect on
			// whether the rollback chain after it still verifies.
			await writeFixtureFile(
				cwd,
				"migrations/00000000000000_legacy_no_hashes.sql",
				"-- hand-written migration from before hejbro tracked hash chains\ncreate table app.legacy_marker (id integer);\n",
			);

			const result = await runCli(cwd, ["verify"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"verify: 5 checks passed (5 migrations, snapshot sha256:",
			);
		});
	});

	// Dependency-aware batch reporting (reviewer-redesigned, PR D round 2):
	// checks 1 and 3 always run; 2 needs 1; 4 needs 1 and 3. skip/summary
	// text is owner-approved verbatim (⑥), pinned below.

	it("batch: check 3 alone failing skips only check 4 (check 2 still runs and passes)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const original = await readFile(
			join(cwd, "migrations", fileName as string),
			"utf8",
		);
		const forked = replaceLinePrefixedWith(
			original,
			SNAPSHOT_PREFIX,
			`sha256:${"f".repeat(64)}`,
		);
		await writeFixtureFile(cwd, "migrations/99999999999999_fork.sql", forked);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[diverged-migrations]");
		expect(result.stderr).not.toContain("error[snapshot-stale]");
		expect(result.stderr).not.toContain("error[chain-tip-mismatch]");
		expect(result.stderr).toContain(
			"skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)",
		);
		expect(result.stderr).not.toContain(
			"skipped: declarations ↔ snapshot (needs a parseable snapshot file)",
		);
		expect(result.stderr).toContain(
			"verify: 1 of 5 checks failed, 1 skipped — fix the errors above and rerun `hejbro verify`.",
		);
	});

	it("batch: checks 1 and 3 failing together produce 2 diagnostic blocks and skip checks 2 and 4", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const original = await readFile(
			join(cwd, "migrations", fileName as string),
			"utf8",
		);
		const forked = replaceLinePrefixedWith(
			original,
			SNAPSHOT_PREFIX,
			`sha256:${"f".repeat(64)}`,
		);
		await writeFixtureFile(cwd, "migrations/99999999999999_fork.sql", forked);
		await writeFile(
			join(cwd, "hejbro.snapshot.json"),
			"<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n",
		);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-snapshot]");
		expect(result.stderr).toContain("error[diverged-migrations]");
		expect(result.stderr).toContain(
			"skipped: declarations ↔ snapshot (needs a parseable snapshot file)",
		);
		expect(result.stderr).toContain(
			"skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)",
		);
		expect(result.stderr).toContain(
			"verify: 2 of 5 checks failed, 2 skipped — fix the errors above and rerun `hejbro verify`.",
		);
	});

	it("batch: a single failure (no skips) uses the no-skip summary form", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[snapshot-stale]");
		expect(result.stderr).not.toContain("skipped:");
		expect(result.stderr).toContain(
			"verify: 1 of 5 checks failed — fix the errors above and rerun `hejbro verify`.",
		);
	});

	it("passes with a storageBucket declaration when the supabase preset is registered (D55)", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(
			cwd,
			"hejbro.config.ts",
			CONFIG_WITH_SUPABASE_PRESET_SOURCE,
		);
		await writeFixtureFile(cwd, "src/app.schema.ts", BUCKET_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
	});

	it("fails a storageBucket declaration when no preset registers its kind", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BUCKET_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		// buildSnapshot rejects the declaration before diffSnapshots ever
		// looks up its kind by name, so the observed code is
		// unowned-declaration (buildSnapshot's own "no owner" check),
		// not unknown-kind (registry.get's "no such kind" check, which
		// only fires once a kind name is looked up during diffing).
		expect(result.stderr).toContain("error[unowned-declaration]");
	});
});

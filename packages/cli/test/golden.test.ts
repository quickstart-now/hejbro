import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

// Task 14: the owner-approved (⑥) error-corpus texts, verbatim, as actually
// produced by the real, wired-up `hejbro generate` — every case here drives
// the built CLI (see support/cli-runner.ts) so the golden strings below are
// never a reimplementation of generate.ts's rendering, only its captured
// output. Every assertion also checks the tmp fixture dir's own absolute
// path never leaks into stdout/stderr (Task 14 requirement).

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

/** posts(slug, seoTitle), users(nick), comments(body) — the shared starting point every rename/ambiguity fixture below diverges from. */
const BASE_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull(),
	seoTitle: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	nick: text().notNull(),
});

export const comments = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	body: text().notNull(),
});
`;

/** posts.slug renamed to posts.handle — a single-pair ambiguity. */
const SINGLE_PAIR_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	handle: text().notNull(),
	seoTitle: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	nick: text().notNull(),
});

export const comments = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	body: text().notNull(),
});
`;

/** Both posts columns renamed at once — a multi-pair ambiguity in one table. */
const MULTI_PAIR_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	handle: text().notNull(),
	metaTitle: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	nick: text().notNull(),
});

export const comments = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	body: text().notNull(),
});
`;

/** posts.slug and users.nick both renamed — two independent single-table ambiguities (batch summary, single kind). */
const BATCH_COLUMN_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	handle: text().notNull(),
	seoTitle: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	alias: text().notNull(),
});

export const comments = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	body: text().notNull(),
});
`;

/** "comments" dropped, "reviews" created — a table-level ambiguity. */
const TABLE_RENAME_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull(),
	seoTitle: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	nick: text().notNull(),
});

export const reviews = table(app, "reviews", {
	id: uuid().primaryKey().defaultRandom(),
	body: text().notNull(),
});
`;

/** posts.slug and users.nick renamed, and comments dropped/reviews created — a mixed batch (2 columns, 1 table). */
const MIXED_BATCH_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	handle: text().notNull(),
	seoTitle: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	alias: text().notNull(),
});

export const reviews = table(app, "reviews", {
	id: uuid().primaryKey().defaultRandom(),
	body: text().notNull(),
});
`;

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const expectNoAbsolutePath = (output: string): void => {
	expect(output).not.toContain(cwd);
};

describe("golden error corpus (Task 14, owner-approved ⑥ texts)", () => {
	it("config-not-found: no hejbro.config.ts at all", async () => {
		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"no hejbro.config.ts was found. Next: run `hejbro init` to scaffold hejbro.config.ts, a migrations directory, and an empty snapshot file, then add a declaration file and rerun `hejbro generate`.",
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("entry-not-found: valid config, no matching declaration files — includes the onboarding example", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'hejbro.config.ts\'s entry pattern "src/**/*.schema.ts" matched 0 files. Next: if this is a new project, create a declaration file (see the example below) and rerun `hejbro generate`; if you already have declarations, check the "entry" pattern in hejbro.config.ts for a typo.',
		);
		expect(result.stderr).toContain(
			'import { schema, table, uuid, text } from "hejbro";',
		);
		expect(result.stderr).toContain(
			'export const posts = table(app, "posts", {',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("snapshot-not-found: declarations load, but no snapshot and no prior migrations", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'no snapshot file was found at "hejbro.snapshot.json", and the migrations directory has no prior migrations either — this looks like a project that hasn\'t been initialized yet. Next: run `hejbro init` to scaffold an empty snapshot (and the migrations directory, if missing), then rerun `hejbro generate`.',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("snapshot-lost: prior migrations exist, but the snapshot file is missing", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await writeFixtureFile(
			cwd,
			"migrations/20260101000000_add_posts.sql",
			"-- hejbro migration\n",
		);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'no snapshot file was found at "hejbro.snapshot.json", but 1 prior migration(s) already exist in "migrations" — the snapshot is a derived, checked-in file (declarations are the source of truth), so this looks lost rather than never created.',
		);
		expect(result.stderr).toContain(
			'do not just rerun `hejbro generate` to "fix" this — with no previous snapshot, hejbro treats every declared object as brand new and emits a migration that recreates everything, which is destructive against a database that\'s already been migrated.',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("invalid-rename-flag: malformed --rename value", async () => {
		const result = await runCli(cwd, [
			"generate",
			"--rename",
			"ddland.posts.slug.extra=handle",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'--rename value "ddland.posts.slug.extra=handle" isn\'t in the expected "<schema>.<table>.<old>=<new>" (column) or "<schema>.<old>=<new>" (table) form. Next: check for extra "." characters, and make sure the value contains exactly one "=".',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("unknown-rename-target: --rename references a name this run doesn't drop/add", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, [
			"generate",
			"--rename",
			"app.posts.slug=handle",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'--rename "app.posts.slug=handle" doesn\'t match this run: table "app.posts" has no dropped column named "slug" (or no added column named "handle"). Next: check both names for typos — --rename\'s left side must be a column this run drops, the right side a column this run adds.',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("duplicate-rename-target: two --rename flags claim the same name", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", SINGLE_PAIR_SCHEMA);

		const result = await runCli(cwd, [
			"generate",
			"--rename",
			"app.posts.slug=handle",
			"--rename",
			"app.posts.slug=other",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'two --rename flags both reference "app.posts.slug" (as an old or new name) — a dropped column can be claimed by at most one rename, and an added column can be the target of at most one rename. Next: remove or fix the duplicate --rename flag.',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("unknown-confirm-drop-target: --confirm-drop references a column this run doesn't drop", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, [
			"generate",
			"--confirm-drop",
			"app.posts.slug",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'--confirm-drop "app.posts.slug" doesn\'t match this run: table "app.posts" has no dropped column named "slug". Next: check the name for typos — --confirm-drop\'s target must be a column (or table) this run actually drops.',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("ambiguous-column-rename (single pair)", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", SINGLE_PAIR_SCHEMA);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'table "app.posts" has an ambiguous column change: column "slug" was dropped and column "handle" was added in the same generate run, and hejbro cannot tell whether this is a rename. Next: rerun with `--rename app.posts.slug=handle` (if this is a rename) or `--confirm-drop app.posts.slug` (if these are unrelated changes).',
		);
		// declaredAt (core's captureDeclarationSite) is always absolute or a
		// file:// URL — the CLI must relativize it against cwd before
		// rendering the "at" tail, or it'd leak the tmp fixture path.
		expect(result.stderr).toContain("at src/app.schema.ts:");
		expectNoAbsolutePath(result.stderr);
	});

	it("ambiguous-column-rename (multiple pairs in one table)", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", MULTI_PAIR_SCHEMA);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[ambiguous-column-rename]");
		expect(result.stderr).toContain(
			"Next: resolve each dropped column with --rename or --confirm-drop and rerun — see the flags to add below.",
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("ambiguous-table-rename", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", TABLE_RENAME_SCHEMA);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'schema "app" has an ambiguous table change: table "comments" was dropped and table "reviews" was created in the same generate run — a table rename recreates every column, index, foreign key, RLS policy, and trigger attached to it, so hejbro refuses to guess. Next: rerun with `--rename app.comments=reviews` (if this is a rename) or `--confirm-drop app.comments` (if these are unrelated tables).',
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("batch summary line (single kind — two independent ambiguous column renames)", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BATCH_COLUMN_SCHEMA);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"2 ambiguous column renames — resolve and rerun `hejbro generate`.",
		);
		expectNoAbsolutePath(result.stderr);
	});

	it("batch summary line (mixed — 2 columns, 1 table)", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", MIXED_BATCH_SCHEMA);

		const result = await runCli(cwd, ["generate"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"3 ambiguous renames (2 columns, 1 table) — resolve and rerun `hejbro generate`.",
		);
		expectNoAbsolutePath(result.stderr);
	});
});

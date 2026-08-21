import { readdir, readFile } from "node:fs/promises";
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

// phase8-flag-equals: `--flag=value` (a single argv token) was silently
// dropped by the hand-rolled space-form-only argv scanner
// (generate.ts's collectFlagValues/lastFlagValue) — not an error, just
// silently absent from the parsed flags. For --rename specifically this
// is data loss, not a missing convenience: an unresolved
// ambiguous-column-rename falls back to drop+create, which destroys the
// column's data. These tests drive the built CLI end to end and assert
// on the generated SQL's shape, not just on flag-parsing in isolation.
// No explicit config fixture needed — `hejbro init` (run first in every
// test below) scaffolds one with the matching entry pattern already.

const SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	nick: text().notNull(),
});
`;

const RENAMED_SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	headline: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	nick: text().notNull(),
});
`;

/** Both posts.title and users.nick renamed at once — two independent,
 * single-table ambiguities, so one can be resolved via --rename while
 * the other is left for the diagnostic to still report. */
const BOTH_RENAMED_SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	headline: text().notNull(),
});

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	alias: text().notNull(),
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

const migrationTexts = async (): Promise<ReadonlyArray<string>> => {
	const fileNames = await sqlFileNames();
	return Promise.all(
		fileNames.map((name) => readFile(join(cwd, "migrations", name), "utf8")),
	);
};

describe("--flag=value (phase8-flag-equals)", () => {
	it("resolves an ambiguity as a rename via --rename=<spec>, not a silent drop+create (data loss guard)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);
		await writeSchema(RENAMED_SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, [
			"generate",
			"--rename=app.posts.title=headline",
		]);
		expect(result.exitCode).toBe(0);

		const texts = await migrationTexts();
		expect(
			texts.some((text) =>
				text.includes(
					'alter table "app"."posts" rename column "title" to "headline";',
				),
			),
		).toBe(true);
		// The data-loss shape this guards against: title never dropped.
		expect(texts.some((text) => text.includes('drop column "title"'))).toBe(
			false,
		);
	});

	it("--rename <spec> (space form) still works after adding equals-form support (regression guard)", async () => {
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

		const texts = await migrationTexts();
		expect(
			texts.some((text) =>
				text.includes(
					'alter table "app"."posts" rename column "title" to "headline";',
				),
			),
		).toBe(true);
	});

	it("the suggested rerun command stays valid when the original invocation mixed --flag=value with an unresolved ambiguity", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(SCHEMA_SOURCE);
		await runCli(cwd, ["generate"]);
		await writeSchema(BOTH_RENAMED_SCHEMA_SOURCE);

		// posts.title=headline resolved via equals-form; users.nick=alias is
		// left ambiguous on purpose, and --name=custom is an unrelated
		// equals-form flag that must survive being echoed back unmangled.
		const first = await runCli(cwd, [
			"generate",
			"--name=custom",
			"--rename=app.posts.title=headline",
		]);
		expect(first.exitCode).toBe(1);
		expect(first.stderr).toContain("error[ambiguous-column-rename]: app.users");
		expect(first.stderr).toContain("app.users.nick=alias");
		// The already-resolved posts rename must not itself be reported as
		// still-ambiguous — proves argv pairing wasn't corrupted upstream.
		// (The rerun suggestion legitimately echoes "app.posts" back as
		// part of the already-given --rename, so check for the specific
		// diagnostic header, not bare string absence.)
		expect(first.stderr).not.toContain(
			"error[ambiguous-column-rename]: app.posts",
		);

		const suggestionMatch = /hejbro generate[\s\S]*?(?=\n\n|$)/.exec(
			first.stderr,
		);
		expect(suggestionMatch).not.toBeNull();
		const suggestedCommand = (suggestionMatch as RegExpExecArray)[0];
		// Multi-line suggestions are backslash-continued; turn them into a
		// flat argv the same way a shell would, without invoking a shell.
		const suggestedArgs = suggestedCommand
			.split("\\\n")
			.join(" ")
			.trim()
			.split(/\s+/)
			.slice(2); // drop "hejbro generate"
		expect(suggestedArgs).toContain("--name");
		expect(suggestedArgs).toContain("custom");

		const second = await runCli(cwd, ["generate", ...suggestedArgs]);
		expect(second.exitCode).toBe(0);

		const texts = await migrationTexts();
		expect(
			texts.some((text) =>
				text.includes(
					'alter table "app"."posts" rename column "title" to "headline";',
				),
			),
		).toBe(true);
		expect(
			texts.some((text) =>
				text.includes(
					'alter table "app"."users" rename column "nick" to "alias";',
				),
			),
		).toBe(true);
	});
});

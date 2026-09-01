import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// Same built-CLI, child_process approach as verify.test.ts and for the
// same reason: real jiti-loaded table() fixtures need the real, built
// resolution path.

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

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
	await runCli(cwd, ["init"]);
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const writeSchema = (source: string): Promise<void> =>
	writeFixtureFile(cwd, "src/app.schema.ts", source);

describe("hejbro verify (export freshness, R2-G3)", () => {
	it("reports an export written before the last declaration change", async () => {
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate", "--export"]);

		// The declarations move on, but the export is never regenerated --
		// exactly a hand-edited or forgotten `generate --export` step.
		await writeSchema(CHANGED_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("export-stale");
		expect(result.stderr).toContain("hejbro generate --export");
	});

	it("the failure names the command, not a cause", async () => {
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate", "--export"]);
		await writeSchema(CHANGED_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.stderr).toContain(
			'the export in ".hejbro/export/" does not match your declarations. Next: run `hejbro generate --export` and commit the result.',
		);
		// States the observation only -- never speculates about why
		// (a changed declaration vs. a hand-edited export file are
		// indistinguishable from here, and the message doesn't pretend
		// otherwise).
		expect(result.stderr).not.toMatch(/because|since|declarations changed/i);
	});

	it("a repository without an export is not reported", async () => {
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("5 checks passed");
	});

	it("a regenerated export passes", async () => {
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate", "--export"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("6 checks passed");
	});
});

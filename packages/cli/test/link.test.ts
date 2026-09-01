import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const readSourceFile = async (): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(join(cwd, "hejbro.json"), "utf8"));

/** A believable hand-written `hejbro.json` — the shape a person guessing
 * at the format might type, adding a field that seems natural (a
 * branch) but that the strict schema rejects. Real discriminating
 * power: it needs *exactly* `{ source: string }`, not just "the file
 * has a source key" — a schema that degraded to "accepts any object
 * with a source key" would silently accept this. */
const HAND_WRITTEN_SOURCE_FILE =
	'{\n\t"source": "https://old.example.com/org/schema.git",\n\t"branch": "main"\n}\n';

describe("hejbro link", () => {
	it("records the repository and no branch", async () => {
		const result = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(0);

		const sourceFile = await readSourceFile();
		expect(sourceFile).toEqual({
			source: "https://example.com/org/schema.git",
		});
	});

	it("refuses with no source given", async () => {
		const result = await runCli(cwd, ["link"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("link-source-required");
	});

	it("refuses to overwrite a hand-written hejbro.json without --force", async () => {
		await writeFile(join(cwd, "hejbro.json"), HAND_WRITTEN_SOURCE_FILE);

		const result = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-destination-not-vendored");
	});

	it("--force overwrites a hand-written hejbro.json", async () => {
		await writeFile(join(cwd, "hejbro.json"), HAND_WRITTEN_SOURCE_FILE);

		const result = await runCli(cwd, [
			"link",
			"--force",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(0);
		expect(await readSourceFile()).toEqual({
			source: "https://example.com/org/schema.git",
		});
	});
});

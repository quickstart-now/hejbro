import { readFile } from "node:fs/promises";
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

const readLock = async (): Promise<Record<string, unknown>> =>
	JSON.parse(
		await readFile(join(cwd, ".hejbro", "vendor", "lock.json"), "utf8"),
	);

describe("hejbro link", () => {
	it("records the repository and no branch", async () => {
		const result = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(0);

		const lock = await readLock();
		expect(lock.source).toBe("https://example.com/org/schema.git");
		expect(lock).not.toHaveProperty("ref");
		expect(lock).not.toHaveProperty("commit");
	});

	it("refuses with no source given", async () => {
		const result = await runCli(cwd, ["link"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("link-source-required");
	});

	it("refuses to overwrite a hand-written lock without --force", async () => {
		const { mkdir, writeFile } = await import("node:fs/promises");
		await mkdir(join(cwd, ".hejbro", "vendor"), { recursive: true });
		await writeFile(
			join(cwd, ".hejbro", "vendor", "lock.json"),
			// A real fixture needs a comment/marker-shaped difference to have
			// any discriminating power -- a totally empty file could pass a
			// weakened check (e.g. a marker check that degrades to "file is
			// non-empty") without anyone noticing.
			'{"unrelated": "hand-written, not a hejbro lock"}',
		);

		const result = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-destination-not-vendored");
	});
});

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

const readLock = async (): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(join(cwd, "hejbro.lock"), "utf8"));

/** A believable hand-written `hejbro.lock` -- the shape a person
 * guessing at the format might type by hand, missing only the
 * `generatedBy` mark. Real discriminating power: it needs the *exact*
 * mark, not just "the file has lock-shaped keys" (confirmed by hand --
 * weakening `VENDOR_LOCK_MARKER` to a common substring flips this
 * fixture's own test green; see the report for the sha256 before/after
 * the revert). */
const HAND_WRITTEN_LOCK =
	'{\n\t"commit": "0000000000000000000000000000000000000000",\n\t"resolvedFrom": "main"\n}\n';

describe("hejbro link", () => {
	it("records the repository and no branch", async () => {
		const result = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(0);

		const lock = await readLock();
		expect(lock.source).toBe("https://example.com/org/schema.git");
		expect(lock).not.toHaveProperty("resolvedFrom");
		expect(lock).not.toHaveProperty("commit");
	});

	it("refuses with no source given", async () => {
		const result = await runCli(cwd, ["link"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("link-source-required");
	});

	it("refuses to overwrite a hand-written lock without --force", async () => {
		await writeFile(join(cwd, "hejbro.lock"), HAND_WRITTEN_LOCK);

		const result = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-destination-not-vendored");
	});

	it("--force overwrites a hand-written lock", async () => {
		await writeFile(join(cwd, "hejbro.lock"), HAND_WRITTEN_LOCK);

		const result = await runCli(cwd, [
			"link",
			"--force",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(0);
		expect((await readLock()).source).toBe(
			"https://example.com/org/schema.git",
		);
	});
});

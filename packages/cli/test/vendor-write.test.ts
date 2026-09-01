import { mkdir, writeFile } from "node:fs/promises";
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

describe("vendor never overwrites a file it did not write", () => {
	it("refuses a destination it did not write", async () => {
		await mkdir(join(cwd, ".hejbro", "vendor"), { recursive: true });
		// A negative fixture needs its own discriminating content -- an
		// empty or trivial file would still pass a weakened check (e.g. one
		// that degrades to "the file is non-empty"), so this is a
		// plausible, unrelated JSON file, not a blank one.
		await writeFile(
			join(cwd, ".hejbro", "vendor", "lock.json"),
			'{"note": "a project-local file that happens to live here, not a hejbro lock"}',
		);

		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-destination-not-vendored");
	});

	it("link --force overwrites a hand-written lock, and vendor proceeds normally after", async () => {
		await mkdir(join(cwd, ".hejbro", "vendor"), { recursive: true });
		await writeFile(
			join(cwd, ".hejbro", "vendor", "lock.json"),
			'{"note": "a project-local file that happens to live here, not a hejbro lock"}',
		);

		const forced = await runCli(cwd, [
			"link",
			"--force",
			"https://example.com/org/schema.git",
		]);
		expect(forced.exitCode).toBe(0);

		// vendor now reads a lock this tool actually wrote -- it fails for
		// an unrelated reason (the source isn't a real reachable
		// repository), never the overwrite guard.
		const result = await runCli(cwd, ["vendor"]);
		expect(result.stderr).not.toContain("vendor-destination-not-vendored");
	});
});

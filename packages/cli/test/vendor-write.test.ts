import { writeFile } from "node:fs/promises";
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

/**
 * A believable hand-written `hejbro.lock` — the shape a person guessing
 * at the format might type by hand, missing only the `generatedBy`
 * mark. This is the fixture with real discriminating power: it needs
 * the *exact* mark, not just "the file has lock-shaped keys" (2026-09-01
 * review note — a mutation of `VENDOR_LOCK_MARKER` to a common substring
 * was run by hand against this exact fixture and confirmed to flip the
 * test green; see the report for the sha256 before/after).
 */
const HAND_WRITTEN_LOCK =
	'{\n\t"commit": "0000000000000000000000000000000000000000",\n\t"resolvedFrom": "main"\n}\n';

describe("vendor never overwrites a file it did not write", () => {
	it("refuses a destination it did not write", async () => {
		await writeFile(join(cwd, "hejbro.lock"), HAND_WRITTEN_LOCK);

		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-destination-not-vendored");
	});

	it("refuses even when a source is already linked", async () => {
		await writeFile(join(cwd, "hejbro.lock"), HAND_WRITTEN_LOCK);
		const linked = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(linked.exitCode).toBe(0);

		// The guard on `hejbro.lock` runs before the linked source is even
		// read (4.13: `link` never touches `hejbro.lock`, so linking
		// successfully must not by itself excuse a foreign lock).
		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-destination-not-vendored");
	});

	it("vendor --force overwrites a hand-written lock, and proceeds normally after", async () => {
		await writeFile(join(cwd, "hejbro.lock"), HAND_WRITTEN_LOCK);
		const linked = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(linked.exitCode).toBe(0);

		// vendor's own --force claims the lock -- it then fails for an
		// unrelated reason (the source isn't a real reachable repository),
		// never the overwrite guard.
		const result = await runCli(cwd, ["vendor", "--force"]);
		expect(result.stderr).not.toContain("vendor-destination-not-vendored");
	});
});

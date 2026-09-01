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

	/** D106 M6: on a *first* vendor -- no lock present yet, so the lock's
	 * own guard has nothing to refuse -- a pre-existing hand-written
	 * `contract.ts` at the vendored path must still be protected: it's
	 * the one destination a consumer's own code imports. */
	it("refuses a hand-written contract.ts even with no lock present yet", async () => {
		await mkdir(join(cwd, ".hejbro", "vendor"), { recursive: true });
		await writeFile(
			join(cwd, ".hejbro", "vendor", "contract.ts"),
			"export const createDb = () => { throw new Error('hand-written'); };\n",
		);
		const linked = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(linked.exitCode).toBe(0);

		// Refused before any network call -- the guard runs ahead of
		// `resolveExport`, the same order the lock's own guard runs in.
		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-destination-not-vendored");
		expect(result.stderr).toContain("contract.ts");
	});

	it("vendor --force overwrites a hand-written contract.ts too", async () => {
		await mkdir(join(cwd, ".hejbro", "vendor"), { recursive: true });
		await writeFile(
			join(cwd, ".hejbro", "vendor", "contract.ts"),
			"export const createDb = () => { throw new Error('hand-written'); };\n",
		);
		const linked = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(linked.exitCode).toBe(0);

		// --force claims the contract file too; the run still fails, but
		// for an unrelated reason (the source isn't a real repository),
		// never the overwrite guard.
		const result = await runCli(cwd, ["vendor", "--force"]);
		expect(result.stderr).not.toContain("vendor-destination-not-vendored");
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOutdated } from "../src/commands/outdated";
import { writeLock } from "../src/vendor/lock";
import { writeSourceFile } from "../src/vendor/source-file";

/**
 * `runOutdated` is pure over the filesystem (no git, no network needed
 * to reach this refusal -- it fires before `resolveRemoteHead` is ever
 * called), so a plain temp directory with a linked source and a
 * pull-written lock is enough (schema-vendoring spec: "outdated refuses
 * a database-sourced contract").
 */
let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "hejbro-outdated-database-origin-test-"));
	writeSourceFile(cwd, "github.com/acme/schema-repo");
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("outdated / CI-G4-R1-01: refuses a database-sourced contract", () => {
	it("refuses with vendor-origin-not-a-commit, naming link, when the lock came from pull", () => {
		writeLock(cwd, {
			generatedBy: "hejbro pull",
			database: "widgets_db",
			schemas: ["app"],
		});

		const result = runOutdated(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-origin-not-a-commit");
		expect(result.stderr).toContain("hejbro link");
	});

	it("still refuses with vendor-not-yet-vendored when nothing has ever been vendored (control)", () => {
		const result = runOutdated(cwd);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-not-yet-vendored");
	});
});

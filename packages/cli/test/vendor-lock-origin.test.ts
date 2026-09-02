import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertLockNamesACommit,
	lockPath,
	readLock,
	writeLock,
} from "../src/vendor/lock";

/**
 * `readLock`/`writeLock`/`assertLockNamesACommit` are pure over the
 * filesystem (no git, no network) -- a plain temp directory is enough,
 * unlike `vendor.test.ts`'s own subprocess-against-a-fake-remote
 * fixtures, which exist to prove the *rest* of `vendor`'s own wiring.
 */
let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "hejbro-vendor-lock-origin-test-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("readLock / CI-G4-R1-01 condition (b): both marks are accepted, everything else is still refused", () => {
	it("accepts a lock this tool wrote with the vendor mark", () => {
		writeLock(cwd, { generatedBy: "hejbro vendor", commit: "abc123" });

		expect(readLock(cwd)).toEqual({
			generatedBy: "hejbro vendor",
			commit: "abc123",
		});
	});

	it("accepts a lock this tool wrote with the pull mark, carrying no commit", () => {
		writeLock(cwd, {
			generatedBy: "hejbro pull",
			database: "widgets_db",
			schemas: ["app"],
		});

		expect(readLock(cwd)).toEqual({
			generatedBy: "hejbro pull",
			database: "widgets_db",
			schemas: ["app"],
		});
	});

	it("still refuses a file carrying neither mark", () => {
		writeFileSync(
			lockPath(cwd),
			JSON.stringify({ generatedBy: "someone else" }),
		);

		expect(() => readLock(cwd)).toThrow(
			expect.objectContaining({ code: "vendor-destination-not-vendored" }),
		);
	});
});

describe("assertLockNamesACommit / CI-G4-R1-01", () => {
	it("is a no-op for a vendor-written lock", () => {
		expect(() =>
			assertLockNamesACommit(
				{ generatedBy: "hejbro vendor", commit: "abc123" },
				"hejbro outdated",
			),
		).not.toThrow();
	});

	it("refuses a pull-written lock with vendor-origin-not-a-commit, naming link", () => {
		expect(() =>
			assertLockNamesACommit(
				{
					generatedBy: "hejbro pull",
					database: "widgets_db",
					schemas: ["app"],
				},
				"hejbro outdated",
			),
		).toThrow(
			expect.objectContaining({
				code: "vendor-origin-not-a-commit",
				message: expect.stringContaining("hejbro link"),
			}),
		);
	});
});

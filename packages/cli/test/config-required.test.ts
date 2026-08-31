import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HejbroConfig } from "../src/config";
import { requireConfigFields } from "../src/config-required";
import { readSnapshotFileText } from "../src/snapshot-file";

const baseConfig: HejbroConfig = {
	entry: ["src/**/*.schema.ts"],
	presets: [],
};

describe("requireConfigFields", () => {
	it("names the missing field before any work", () => {
		try {
			requireConfigFields(baseConfig, "verify", [
				"migrationsDir",
				"snapshotPath",
				"prefixStrategy",
			]);
			throw new Error("expected requireConfigFields to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid-config" });
			const message = (error as { message: string }).message;
			expect(message).toContain("verify");
			expect(message).toContain("migrationsDir");
		}
	});

	it("names the first missing field, not every missing field", () => {
		const config: HejbroConfig = { ...baseConfig, migrationsDir: "migrations" };
		try {
			requireConfigFields(config, "history", ["migrationsDir", "snapshotPath"]);
			throw new Error("expected requireConfigFields to throw");
		} catch (error) {
			const message = (error as { message: string }).message;
			expect(message).toContain("snapshotPath");
			expect(message).not.toContain("migrationsDir");
		}
	});

	it("does not throw when every named field is present", () => {
		const config: HejbroConfig = {
			...baseConfig,
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
		};
		expect(() =>
			requireConfigFields(config, "restore", ["migrationsDir", "snapshotPath"]),
		).not.toThrow();
	});

	it("never states what it hasn't observed — only the missing field, never a claim about who owns the schema", () => {
		try {
			requireConfigFields(baseConfig, "check", ["snapshotPath"]);
			throw new Error("expected requireConfigFields to throw");
		} catch (error) {
			const message = (error as { message: string }).message;
			expect(message).toContain(
				"run check in the repository that owns the schema",
			);
			expect(message).not.toContain("doesn't hold migration authority");
		}
	});
});

describe("check's migrationsDir is required only on the no-snapshot-yet path", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "hejbro-config-required-"));
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("names migrationsDir before any work when no snapshot file exists yet", () => {
		const config: HejbroConfig = {
			...baseConfig,
			snapshotPath: "hejbro.snapshot.json",
		};
		requireConfigFields(config, "check", ["snapshotPath"]);
		try {
			readSnapshotFileText(cwd, config, "check");
			throw new Error("expected readSnapshotFileText to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid-config" });
			const message = (error as { message: string }).message;
			expect(message).toContain("check");
			expect(message).toContain("migrationsDir");
		}
	});

	it("does not need migrationsDir when the snapshot file already exists", async () => {
		const config: HejbroConfig = {
			...baseConfig,
			snapshotPath: "hejbro.snapshot.json",
		};
		requireConfigFields(config, "check", ["snapshotPath"]);
		await writeFile(
			join(cwd, "hejbro.snapshot.json"),
			'{"formatVersion":8,"dialect":"postgres","objects":{}}',
		);
		expect(() => readSnapshotFileText(cwd, config, "check")).not.toThrow();
	});
});

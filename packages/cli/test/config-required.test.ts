import { describe, expect, it } from "vitest";
import type { HejbroConfig } from "../src/config";
import { requireConfigFields } from "../src/config-required";

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

import { describe, expect, it } from "vitest";
import { defineConfig, parseConfig } from "../src/config";

describe("defineConfig", () => {
	it("round-trips a valid config unchanged", () => {
		const config = defineConfig({
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
		});
		expect(parseConfig(config, "/repo/hejbro.config.ts")).toEqual(config);
	});
});

describe("parseConfig", () => {
	it("round-trips a valid plain object (as loaded from a config file)", () => {
		const value = {
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "index",
		};
		expect(parseConfig(value, "/repo/hejbro.config.ts")).toEqual(value);
	});

	it("reports a missing entry field with the field name, expectation, and config path — never zod's raw error text", () => {
		const value = {
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
		};
		try {
			parseConfig(value, "/repo/hejbro.config.ts");
			throw new Error("expected parseConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid-config" });
			const message = (error as { message: string }).message;
			expect(message).toContain("entry");
			expect(message).toContain("/repo/hejbro.config.ts");
			expect(message).not.toContain("ZodError");
			expect(message).not.toContain("invalid_type");
		}
	});

	it("reports an invalid prefixStrategy value, listing the three valid strategies", () => {
		const value = {
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "bogus",
		};
		try {
			parseConfig(value, "/repo/hejbro.config.ts");
			throw new Error("expected parseConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid-config" });
			const message = (error as { message: string }).message;
			expect(message).toContain("timestamp");
			expect(message).toContain("index");
			expect(message).toContain("unix");
			expect(message).not.toContain("ZodError");
			expect(message).not.toContain("invalid_type");
		}
	});
});

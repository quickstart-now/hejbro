import type { Preset } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { defineConfig, parseConfig } from "../src/config";

const TOY_PRESET: Preset = {
	name: "toy",
	kinds: [],
	validators: [],
};

describe("defineConfig", () => {
	it("round-trips a valid config unchanged", () => {
		const config = defineConfig({
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
			presets: [],
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
			presets: [],
		};
		expect(parseConfig(value, "/repo/hejbro.config.ts")).toEqual(value);
	});

	it("defaults presets to [] when the field is omitted", () => {
		const value = {
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
		};
		expect(parseConfig(value, "/repo/hejbro.config.ts").presets).toEqual([]);
	});

	it("accepts a valid preset object in presets", () => {
		const value = {
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
			presets: [TOY_PRESET],
		};
		expect(parseConfig(value, "/repo/hejbro.config.ts").presets).toEqual([
			TOY_PRESET,
		]);
	});

	it("rejects a non-preset entry in presets, naming its index", () => {
		const value = {
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
			presets: [42],
		};
		try {
			parseConfig(value, "/repo/hejbro.config.ts");
			throw new Error("expected parseConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid-config" });
			const message = (error as { message: string }).message;
			expect(message).toContain("presets[0]");
			expect(message).toContain("/repo/hejbro.config.ts");
			expect(message).toContain("supabasePreset from @hejbro/supabase");
		}
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

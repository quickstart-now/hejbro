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

	// fix-nile-findings, #755, task 2.1: explainUnavailable is an optional
	// field on Preset -- isPreset's shape check names name/kinds/validators
	// only, so a preset carrying it (nilePreset's own shape) still crosses
	// the CLI's config boundary unrejected.
	it("accepts a preset declaring explainUnavailable in presets", () => {
		const presetWithExplainUnavailable: Preset = {
			...TOY_PRESET,
			explainUnavailable: true,
		};
		const value = {
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
			presets: [presetWithExplainUnavailable],
		};
		expect(parseConfig(value, "/repo/hejbro.config.ts").presets).toEqual([
			presetWithExplainUnavailable,
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

	it("accepts a configuration without the migration-authoring fields", () => {
		const value = {
			entry: ["src/**/*.schema.ts"],
		};
		expect(parseConfig(value, "/repo/hejbro.config.ts")).toEqual({
			entry: ["src/**/*.schema.ts"],
			presets: [],
		});
	});

	// #743, D2: an absolute-looking migrationsDir/snapshotPath used to be
	// silently joined under the working directory (`join(cwd, value)`
	// swallows the leading "/"), so init and generate reported two
	// different locations for what was really the same field. Refusing at
	// parse time ends the disagreement. D110 input table: both fields,
	// a doubled leading separator, and the relative spellings that must
	// keep working (bare, "./", "..", and the empty string the field's
	// own kind check governs, unchanged).
	describe("parseConfig / absolute-looking artifact paths (#743)", () => {
		type Row = {
			readonly field: "migrationsDir" | "snapshotPath";
			readonly value: string;
			readonly outcome: "refused" | "accepted";
		};

		const rows: ReadonlyArray<Row> = [
			{ field: "migrationsDir", value: "/db/migrations", outcome: "refused" },
			{ field: "snapshotPath", value: "/snap/state.json", outcome: "refused" },
			{ field: "migrationsDir", value: "//db", outcome: "refused" },
			{ field: "migrationsDir", value: "db/migrations", outcome: "accepted" },
			{
				field: "migrationsDir",
				value: "./db/migrations",
				outcome: "accepted",
			},
			{
				field: "migrationsDir",
				value: "../out/migrations",
				outcome: "accepted",
			},
		];

		it.each(rows)(
			"refuses an artifact path spelled as absolute, naming the field ($field: $value -> $outcome)",
			({ field, value, outcome }) => {
				const configValue = {
					entry: ["src/**/*.schema.ts"],
					presets: [],
					[field]: value,
				};
				if (outcome === "accepted") {
					expect(
						parseConfig(configValue, "/repo/hejbro.config.ts"),
					).toMatchObject({ [field]: value });
					return;
				}
				try {
					parseConfig(configValue, "/repo/hejbro.config.ts");
					throw new Error("expected parseConfig to throw");
				} catch (error) {
					expect(error).toMatchObject({ code: "invalid-config" });
					const message = (error as { message: string }).message;
					expect(message).toContain(field);
					expect(message).toContain("Next:");
					expect(message).not.toContain("/repo/hejbro.config.ts");
				}
			},
		);
	});

	// #846 NB2/NB6, D1: a snapshotPath spelled as a directory (trailing
	// separator, empty, or a last segment of "." or "..") used to reach
	// init's own directory-spelling refusal while the read side stripped
	// the separator, stat'd a real file underneath, and reported an
	// unrelated permissions failure -- one configuration, two answers.
	// Refusing at parse time is shared by every command that reads the
	// configuration. `migrationsDir` is a directory and keeps every one
	// of these spellings (D110 input table).
	describe("parseConfig / a snapshotPath spelled as a directory (#846 D1)", () => {
		type Row = {
			readonly field: "migrationsDir" | "snapshotPath";
			readonly value: string;
			readonly outcome: "refused" | "accepted";
		};

		const rows: ReadonlyArray<Row> = [
			{ field: "snapshotPath", value: "state.json/", outcome: "refused" },
			{ field: "snapshotPath", value: "db/state.json//", outcome: "refused" },
			{ field: "snapshotPath", value: "", outcome: "refused" },
			{ field: "snapshotPath", value: ".", outcome: "refused" },
			{ field: "snapshotPath", value: "./", outcome: "refused" },
			{ field: "snapshotPath", value: "..", outcome: "refused" },
			{ field: "snapshotPath", value: "db/..", outcome: "refused" },
			{ field: "snapshotPath", value: "state.json", outcome: "accepted" },
			{
				field: "snapshotPath",
				value: "./db/state.json",
				outcome: "accepted",
			},
			{
				field: "snapshotPath",
				value: "../up/state.json",
				outcome: "accepted",
			},
			{
				field: "snapshotPath",
				value: "a.b/state.json",
				outcome: "accepted",
			},
			{ field: "migrationsDir", value: "mig/", outcome: "accepted" },
			{ field: "migrationsDir", value: "", outcome: "accepted" },
		];

		it.each(rows)(
			"refuses a snapshotPath whose spelling names a directory, naming the field ($field: $value -> $outcome)",
			({ field, value, outcome }) => {
				const configValue = {
					entry: ["src/**/*.schema.ts"],
					presets: [],
					[field]: value,
				};
				if (outcome === "accepted") {
					expect(
						parseConfig(configValue, "/repo/hejbro.config.ts"),
					).toMatchObject({ [field]: value });
					return;
				}
				try {
					parseConfig(configValue, "/repo/hejbro.config.ts");
					throw new Error("expected parseConfig to throw");
				} catch (error) {
					expect(error).toMatchObject({ code: "invalid-config" });
					const message = (error as { message: string }).message;
					expect(message).toContain("snapshotPath");
					expect(message).toContain("Next:");
					expect(message).not.toContain("/repo/hejbro.config.ts");
				}
			},
		);

		// Regression pin (reviewer-observed on 1bc19b32): an empty value
		// must never echo a bare "" back into the message.
		it('never echoes a bare empty string for snapshotPath: ""', () => {
			const value = {
				entry: ["src/**/*.schema.ts"],
				presets: [],
				snapshotPath: "",
			};
			try {
				parseConfig(value, "/repo/hejbro.config.ts");
				throw new Error("expected parseConfig to throw");
			} catch (error) {
				expect(error).toMatchObject({ code: "invalid-config" });
				const message = (error as { message: string }).message;
				expect(message).toContain("snapshotPath");
				expect(message).not.toContain('""');
			}
		});

		// D1 (lead-approved): a last segment of "." is echoed -- unlike the
		// empty case, there is a real, non-empty value to show the user.
		it('echoes the value for snapshotPath: "."', () => {
			const value = {
				entry: ["src/**/*.schema.ts"],
				presets: [],
				snapshotPath: ".",
			};
			try {
				parseConfig(value, "/repo/hejbro.config.ts");
				throw new Error("expected parseConfig to throw");
			} catch (error) {
				expect(error).toMatchObject({ code: "invalid-config" });
				const message = (error as { message: string }).message;
				expect(message).toContain('(".")');
			}
		});
	});

	// add-config-driver, #458, Q1/Q4: `driver` accepts a factory function
	// only -- an instance, a string or any other shape is refused naming
	// the field. D110 input table: absence, a function, and every shape
	// this must reject.
	describe("parseConfig / driver (#458)", () => {
		it("loads with driver left undefined when the field is absent", () => {
			const value = {
				entry: ["src/**/*.schema.ts"],
			};
			expect(
				parseConfig(value, "/repo/hejbro.config.ts").driver,
			).toBeUndefined();
		});

		it("round-trips the exact function reference when driver is a function", () => {
			const factory = (connectionString: string) => ({ connectionString });
			const value = {
				entry: ["src/**/*.schema.ts"],
				driver: factory,
			};
			expect(parseConfig(value, "/repo/hejbro.config.ts").driver).toBe(factory);
		});

		type Row = { readonly label: string; readonly driver: unknown };

		const rejectedRows: ReadonlyArray<Row> = [
			{ label: "a string", driver: "pg" },
			{ label: "an object", driver: { connectionString: "pg" } },
			{ label: "null", driver: null },
		];

		it.each(rejectedRows)(
			"rejects driver naming the field and the shape when it is $label",
			({ driver }) => {
				const value = {
					entry: ["src/**/*.schema.ts"],
					driver,
				};
				try {
					parseConfig(value, "/repo/hejbro.config.ts");
					throw new Error("expected parseConfig to throw");
				} catch (error) {
					expect(error).toMatchObject({ code: "invalid-config" });
					const message = (error as { message: string }).message;
					expect(message).toContain("driver");
					expect(message).toContain("connectionString");
				}
			},
		);
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

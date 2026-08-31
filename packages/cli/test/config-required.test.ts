import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "../src/commands/check";
import { runGenerate } from "../src/commands/generate";
import { runHistory } from "../src/commands/history";
import { runRestore } from "../src/commands/restore";
import { runVerify } from "../src/commands/verify";
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

/** No `defineConfig`/`import` — a plain default-exported object is
 * everything `parseConfig` needs, and it lets this fixture live outside
 * the workspace's own node_modules resolution (a bare `mkdtemp` dir,
 * same as `init.test.ts`) instead of needing `createCliFixtureDir`'s
 * symlinked "hejbro" package (which reads the built dist and would tie
 * this test to a fresh build). `entry: []` matches zero files, which
 * never matters here — every case below is refused before
 * `loadDeclarations` ever runs. */
const CONFIG_MISSING_MIGRATION_AUTHORING_FIELDS = `export default {
	entry: [],
};
`;

describe("each command's guard runs before any work (G3-2)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "hejbro-guard-wiring-"));
		await writeFile(
			join(cwd, "hejbro.config.ts"),
			CONFIG_MISSING_MIGRATION_AUTHORING_FIELDS,
		);
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("generate names migrationsDir and never reaches declaration loading", async () => {
		const result = await runGenerate(cwd, [], () => new Date(), "generate");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("generate");
		expect(result.stderr).toContain("migrationsDir");
		expect(result.stderr).not.toContain("entry-not-found");
	});

	it("baseline names migrationsDir and never reaches declaration loading", async () => {
		const result = await runGenerate(cwd, [], () => new Date(), "baseline");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("baseline");
		expect(result.stderr).toContain("migrationsDir");
		expect(result.stderr).not.toContain("entry-not-found");
	});

	it("verify names migrationsDir and never reaches declaration loading", async () => {
		const result = await runVerify(cwd, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("verify");
		expect(result.stderr).toContain("migrationsDir");
		expect(result.stderr).not.toContain("entry-not-found");
	});

	it("history names migrationsDir and never reaches the migrations directory", async () => {
		const result = await runHistory(cwd, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("history");
		expect(result.stderr).toContain("migrationsDir");
	});

	it("restore names migrationsDir and never reaches the migrations directory", async () => {
		const result = await runRestore(cwd, ["1"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("restore");
		expect(result.stderr).toContain("migrationsDir");
	});

	it("check names snapshotPath and never reaches declaration loading", async () => {
		const result = await runCheck(cwd, []);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("check");
		expect(result.stderr).toContain("snapshotPath");
		expect(result.stderr).not.toContain("entry-not-found");
	});
});

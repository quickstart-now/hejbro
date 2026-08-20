import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-init-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const configPath = () => join(cwd, "hejbro.config.ts");
const snapshotPath = () => join(cwd, "hejbro.snapshot.json");

describe("runInit", () => {
	it("creates all three artifacts in a fresh directory and reports them created", () => {
		const result = runInit(cwd);
		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"created hejbro.config.ts",
			"created migrations/",
			"created hejbro.snapshot.json",
		]);
	});

	it("writes a hejbro.config.ts using defineConfig with the documented defaults", async () => {
		runInit(cwd);
		const content = await readFile(configPath(), "utf8");
		expect(content).toContain('import { defineConfig } from "hejbro";');
		expect(content).toContain('entry: ["src/**/*.schema.ts"]');
		expect(content).toContain('migrationsDir: "migrations"');
		expect(content).toContain('snapshotPath: "hejbro.snapshot.json"');
		expect(content).toContain('prefixStrategy: "timestamp"');
	});

	it("writes the empty snapshot via renderSnapshot(emptySnapshot)", async () => {
		runInit(cwd);
		const content = await readFile(snapshotPath(), "utf8");
		expect(content).toContain('"hejbroSnapshot": 3');
		expect(content).toContain('"objects": {}');
	});

	it("second run reports three skips, exits 0, and leaves files byte-identical", async () => {
		runInit(cwd);
		const [configBefore, snapshotBefore] = await Promise.all([
			readFile(configPath(), "utf8"),
			readFile(snapshotPath(), "utf8"),
		]);

		const second = runInit(cwd);
		expect(second.exitCode).toBe(0);
		expect(second.report).toEqual([
			"skipped hejbro.config.ts (exists)",
			"skipped migrations/ (exists)",
			"skipped hejbro.snapshot.json (exists)",
		]);

		const [configAfter, snapshotAfter] = await Promise.all([
			readFile(configPath(), "utf8"),
			readFile(snapshotPath(), "utf8"),
		]);
		expect(configAfter).toBe(configBefore);
		expect(snapshotAfter).toBe(snapshotBefore);
	});

	it("fills only the missing artifacts when some already exist", async () => {
		runInit(cwd);
		await rm(snapshotPath());

		const result = runInit(cwd);
		expect(result.exitCode).toBe(0);
		expect(result.report).toEqual([
			"skipped hejbro.config.ts (exists)",
			"skipped migrations/ (exists)",
			"created hejbro.snapshot.json",
		]);
	});
});

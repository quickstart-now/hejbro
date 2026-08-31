import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertManifestMonotonic,
	firstMigrationThatStoppedCarryingManifest,
} from "../src/manifest-chain";

// These pure functions only ever read a migration file's own banner line
// (`-- hejbro-manifest: <n>`) — a minimal hand-written file carrying just
// that line (or not) is everything they need; no real declarations, no
// "hejbro" package resolution, no build.

const WITH_MANIFEST = "-- hejbro migration\n-- hejbro-manifest: 1\nselect 1;\n";
const WITHOUT_MANIFEST = "-- hejbro migration\nselect 1;\n";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-manifest-chain-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const writeMigration = (fileName: string, content: string): Promise<void> =>
	writeFile(join(cwd, fileName), content);

describe("assertManifestMonotonic", () => {
	it("refuses generation when the chain carries manifests and emission is off", async () => {
		await writeMigration("001_a.sql", WITHOUT_MANIFEST);
		await writeMigration("002_b.sql", WITH_MANIFEST);

		expect(() =>
			assertManifestMonotonic(cwd, ["001_a.sql", "002_b.sql"], false),
		).toThrowError(
			expect.objectContaining({ code: "manifest-emission-required" }),
		);
	});

	it("generation proceeds when emission is enabled", async () => {
		await writeMigration("001_a.sql", WITHOUT_MANIFEST);
		await writeMigration("002_b.sql", WITH_MANIFEST);

		expect(() =>
			assertManifestMonotonic(cwd, ["001_a.sql", "002_b.sql"], true),
		).not.toThrow();
	});

	it("does not refuse when the chain has never carried a manifest", async () => {
		await writeMigration("001_a.sql", WITHOUT_MANIFEST);

		expect(() =>
			assertManifestMonotonic(cwd, ["001_a.sql"], false),
		).not.toThrow();
	});

	it("does not refuse a brand-new project with no migrations yet", () => {
		expect(() => assertManifestMonotonic(cwd, [], false)).not.toThrow();
	});

	it("reads only the chain's last migration, not the whole chain", async () => {
		// "001_a.sql" is never written to disk — if this function opened
		// anything but the last file, reading a nonexistent one would throw
		// ENOENT before the function ever got a chance to return normally.
		await writeMigration("002_b.sql", WITHOUT_MANIFEST);

		expect(() =>
			assertManifestMonotonic(cwd, ["001_a.sql", "002_b.sql"], false),
		).not.toThrow();
	});
});

describe("firstMigrationThatStoppedCarryingManifest", () => {
	it("reports the migration that stopped carrying it, in a chain whose later migrations still carry them", async () => {
		await writeMigration("001_a.sql", WITH_MANIFEST);
		await writeMigration("002_b.sql", WITHOUT_MANIFEST);
		await writeMigration("003_c.sql", WITH_MANIFEST);

		const violation = firstMigrationThatStoppedCarryingManifest(cwd, [
			"001_a.sql",
			"002_b.sql",
			"003_c.sql",
		]);
		expect(violation).toBe("002_b.sql");
	});

	it("reports nothing when the chain never started carrying manifests", async () => {
		await writeMigration("001_a.sql", WITHOUT_MANIFEST);
		await writeMigration("002_b.sql", WITHOUT_MANIFEST);

		const violation = firstMigrationThatStoppedCarryingManifest(cwd, [
			"001_a.sql",
			"002_b.sql",
		]);
		expect(violation).toBeNull();
	});

	it("reports nothing when every migration from the first manifest onward keeps carrying one", async () => {
		await writeMigration("001_a.sql", WITHOUT_MANIFEST);
		await writeMigration("002_b.sql", WITH_MANIFEST);
		await writeMigration("003_c.sql", WITH_MANIFEST);

		const violation = firstMigrationThatStoppedCarryingManifest(cwd, [
			"001_a.sql",
			"002_b.sql",
			"003_c.sql",
		]);
		expect(violation).toBeNull();
	});
});

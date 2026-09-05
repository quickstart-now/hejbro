import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	upgradeSnapshot as coreUpgradeSnapshot,
	createDefaultRegistry,
} from "@hejbro/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runUpgrade } from "../src/commands/upgrade";
import { sha256Hex } from "../src/hash";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

// In-process throughout (config-required.test.ts's own style, #413): a
// hand-written hejbro.config.ts and hand-written snapshot/migration
// fixtures on a plain mkdtemp directory, no jiti-loaded declaration file
// and no "hejbro" package resolution -- runUpgrade never calls
// loadDeclarations, so the cross-instance @hejbro/core risk that forces
// generate-command.test.ts/golden.test.ts into subprocess mode doesn't
// apply here.

const CONFIG_SOURCE = `export default {
	entry: [],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
	presets: [],
};
`;

const ZERO_HASH = `sha256:${"0".repeat(64)}`;

const snapshotText = (formatVersion: number): string =>
	`{\n\t"dialect": "postgres",\n\t"formatVersion": ${formatVersion},\n\t"objects": {}\n}\n`;

const FORMAT_5_SNAPSHOT = snapshotText(5);
const FORMAT_5_HASH = `sha256:${sha256Hex(FORMAT_5_SNAPSHOT)}`;

const tipMigration = (currentHash: string, upgradedFrom?: string): string => {
	const lines = [
		"-- hejbro migration",
		"-- + schema app [new]",
		`-- parent-snapshot: ${ZERO_HASH}`,
		`-- snapshot: ${currentHash}`,
	];
	if (upgradedFrom === undefined) {
		return lines.join("\n");
	}
	return [...lines, `-- upgraded-from: ${upgradedFrom}`].join("\n");
};

const EARLIER_MIGRATION =
	"-- an earlier migration file, untouched by upgrade\n";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-upgrade-command-"));
	await writeFile(join(cwd, "hejbro.config.ts"), CONFIG_SOURCE);
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const writeSnapshot = (text: string): Promise<void> =>
	writeFile(join(cwd, "hejbro.snapshot.json"), text);

const writeMigration = (fileName: string, text: string): Promise<void> =>
	mkdir(join(cwd, "migrations"), { recursive: true }).then(() =>
		writeFile(join(cwd, "migrations", fileName), text),
	);

const readSnapshot = (): Promise<string> =>
	readFile(join(cwd, "hejbro.snapshot.json"), "utf8");

const readMigration = (fileName: string): Promise<string> =>
	readFile(join(cwd, "migrations", fileName), "utf8");

describe("hejbro upgrade", () => {
	it("upgrades a format-5 snapshot with an intact chain, re-chains the tip, and leaves other migrations untouched", async () => {
		await writeSnapshot(FORMAT_5_SNAPSHOT);
		await writeMigration("0000_earlier.sql", EARLIER_MIGRATION);
		await writeMigration("0001_init.sql", tipMigration(FORMAT_5_HASH));

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBeNull();
		expect(result.stdout).toEqual([
			"upgraded hejbro.snapshot.json: format 5 → 8",
			"re-chained migrations/0001_init.sql",
		]);

		const registry = createDefaultRegistry();
		const expected = coreUpgradeSnapshot(FORMAT_5_SNAPSHOT, registry);
		const newSnapshotText = await readSnapshot();
		expect(newSnapshotText).toBe(expected.text);

		const newHash = `sha256:${sha256Hex(newSnapshotText)}`;
		const newTipText = await readMigration("0001_init.sql");
		expect(newTipText).toBe(
			[
				"-- hejbro migration",
				"-- + schema app [new]",
				`-- parent-snapshot: ${ZERO_HASH}`,
				`-- snapshot: ${newHash}`,
				`-- upgraded-from: ${FORMAT_5_HASH}`,
			].join("\n"),
		);

		expect(await readMigration("0000_earlier.sql")).toBe(EARLIER_MIGRATION);
	});

	it("a current-format snapshot is a no-op", async () => {
		const currentText = snapshotText(8);
		await writeSnapshot(currentText);

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(["snapshot is already at format 8"]);
		expect(result.stderr).toBeNull();
		expect(await readSnapshot()).toBe(currentText);
	});

	it("a format-5 snapshot with no migrations upgrades the snapshot alone", async () => {
		await writeSnapshot(FORMAT_5_SNAPSHOT);

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"upgraded hejbro.snapshot.json: format 5 → 8",
		]);
		expect(result.stderr).toBeNull();
	});

	it("refuses with chain-tip-mismatch and writes nothing when the tip's recorded hash disagrees with the stored snapshot", async () => {
		await writeSnapshot(FORMAT_5_SNAPSHOT);
		const wrongHash = `sha256:${"f".repeat(64)}`;
		await writeMigration("0001_init.sql", tipMigration(wrongHash));

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContain("chain-tip-mismatch");
		expect(await readSnapshot()).toBe(FORMAT_5_SNAPSHOT);
		expect(await readMigration("0001_init.sql")).toBe(tipMigration(wrongHash));
	});

	it("refuses a newer-than-supported snapshot and writes nothing", async () => {
		const newerText = snapshotText(9);
		await writeSnapshot(newerText);

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unsupported-snapshot-version");
		expect(result.stderr).toContain("is newer than this build supports");
		expect(await readSnapshot()).toBe(newerText);
	});

	it("refuses a format older than any release with the pin-or-reset guidance and writes nothing", async () => {
		const tooOldText = snapshotText(4);
		await writeSnapshot(tooOldText);

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unsupported-snapshot-version");
		expect(result.stderr).toContain(
			"hejbro is pre-1.0 and has no format-migration path yet",
		);
		expect(await readSnapshot()).toBe(tooOldText);
	});

	it("refuses with snapshot-lost when migrations exist and the snapshot file does not", async () => {
		await writeMigration("0001_init.sql", tipMigration(FORMAT_5_HASH));

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("snapshot-lost");
	});

	it("a tip already carrying upgraded-from keeps exactly one line, holding the hash it first recorded, when upgraded again", async () => {
		const originalHash = `sha256:${"a".repeat(64)}`;
		await writeSnapshot(FORMAT_5_SNAPSHOT);
		await writeMigration(
			"0001_init.sql",
			tipMigration(FORMAT_5_HASH, originalHash),
		);

		const result = await runUpgrade(cwd, []);

		expect(result.exitCode).toBe(0);
		const newSnapshotText = await readSnapshot();
		const newHash = `sha256:${sha256Hex(newSnapshotText)}`;
		const newTipText = await readMigration("0001_init.sql");
		expect(newTipText).toBe(
			[
				"-- hejbro migration",
				"-- + schema app [new]",
				`-- parent-snapshot: ${ZERO_HASH}`,
				`-- snapshot: ${newHash}`,
				`-- upgraded-from: ${originalHash}`,
			].join("\n"),
		);
		const upgradedFromOccurrences = newTipText
			.split("\n")
			.filter((line) => line.startsWith("-- upgraded-from:"));
		expect(upgradedFromOccurrences).toEqual([
			`-- upgraded-from: ${originalHash}`,
		]);
	});
});

const SUBPROCESS_CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/app.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
});
`;

const SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

// #413, 1.8 (B1): the corrected delta scenario's conditional ("whichever
// command refuses a released older format names upgrade") needs at least
// one member pinned by an existential test, not only inferred from the
// conditional itself -- subprocess, since generate/verify both load
// declarations via jiti before they ever read the snapshot (unlike
// upgrade itself, which is why the describe block above stays in-process).
describe("generate and verify are among the commands that actually refuse a format-5 snapshot (#413, B1)", () => {
	beforeAll(assertBuiltCli);

	it.each([
		["generate", ["generate"]],
		["verify", ["verify"]],
	])(
		"%s refuses a format-5 snapshot naming hejbro upgrade",
		async (_label, args) => {
			const subprocessCwd = await createCliFixtureDir();
			try {
				await writeFixtureFile(
					subprocessCwd,
					"hejbro.config.ts",
					SUBPROCESS_CONFIG_SOURCE,
				);
				await writeFixtureFile(
					subprocessCwd,
					"src/app.schema.ts",
					SCHEMA_SOURCE,
				);
				await mkdir(join(subprocessCwd, "migrations"), { recursive: true });
				await writeFile(
					join(subprocessCwd, "hejbro.snapshot.json"),
					snapshotText(5),
				);

				const result = await runCli(subprocessCwd, args);

				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("error[unsupported-snapshot-version]");
				expect(result.stderr).toContain("Next: run `hejbro upgrade`");
			} finally {
				await removeCliFixtureDir(subprocessCwd);
			}
		},
	);
});

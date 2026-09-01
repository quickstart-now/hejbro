import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";
import type { GitFixture } from "./support/git-fixture";
import { createGitFixture } from "./support/git-fixture";

beforeAll(assertBuiltCli);

const EXPORT_SCHEMA_V1 = '{"tables":[],"functions":[],"roles":[]}';
const EXPORT_SQL_V1 = 'create schema "app";\n';
const EXPORT_FORMAT_V1 = '{"descriptionFormat":1,"snapshotFormat":8}';

const writeExport = async (
	remote: GitFixture,
	schema: string,
): Promise<void> => {
	const dir = join(remote.cwd, ".hejbro", "export");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "schema.json"), schema);
	await writeFile(join(dir, "snapshot.sql"), EXPORT_SQL_V1);
	await writeFile(join(dir, "format.json"), EXPORT_FORMAT_V1);
};

let remote: GitFixture;
let cwd: string;

beforeEach(async () => {
	remote = await createGitFixture();
	cwd = await createCliFixtureDir();
	await writeExport(remote, EXPORT_SCHEMA_V1);
	remote.commit("export v1", "2026-01-01T10:00:00Z");
	await runCli(cwd, ["link", remote.cwd]);
	await runCli(cwd, ["vendor"]);
});

afterEach(async () => {
	await remote.cleanup();
	await removeCliFixtureDir(cwd);
});

describe("hejbro outdated", () => {
	it("reports up to date, exiting zero, right after vendoring", async () => {
		const result = await runCli(cwd, ["outdated"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("up to date");
	});

	it("reports a newer commit without failing", async () => {
		await writeExport(remote, '{"tables":["later"],"functions":[],"roles":[]}');
		remote.commit("export v2", "2026-01-02T10:00:00Z");

		const result = await runCli(cwd, ["outdated"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("newer commit is available");
		expect(result.stdout).toContain("hejbro vendor");
	});

	it("refuses when nothing has been vendored yet", async () => {
		const freshCwd = await createCliFixtureDir();
		try {
			await runCli(freshCwd, ["link", remote.cwd]);
			const result = await runCli(freshCwd, ["outdated"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("vendor-not-yet-vendored");
		} finally {
			await removeCliFixtureDir(freshCwd);
		}
	});
});

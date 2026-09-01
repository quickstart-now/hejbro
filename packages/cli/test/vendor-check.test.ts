import { mkdir, rm, writeFile } from "node:fs/promises";
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

const writeExport = async (remote: GitFixture): Promise<void> => {
	const dir = join(remote.cwd, ".hejbro", "export");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "schema.json"), EXPORT_SCHEMA_V1);
	await writeFile(join(dir, "snapshot.sql"), EXPORT_SQL_V1);
	await writeFile(join(dir, "format.json"), EXPORT_FORMAT_V1);
};

let remote: GitFixture;
let cwd: string;

beforeEach(async () => {
	remote = await createGitFixture();
	cwd = await createCliFixtureDir();
	await writeExport(remote);
	remote.commit("export v1", "2026-01-01T10:00:00Z");
	await runCli(cwd, ["link", remote.cwd]);
	await runCli(cwd, ["vendor"]);
});

afterEach(async () => {
	await remote.cleanup();
	await removeCliFixtureDir(cwd);
});

describe("hejbro vendor --check", () => {
	it("a matching set passes quietly", async () => {
		const result = await runCli(cwd, ["vendor", "--check"]);
		expect(result.exitCode).toBe(0);
	});

	it("exits non-zero and writes nothing when the vendored files were hand-edited", async () => {
		await writeFile(
			join(cwd, ".hejbro", "vendor", "schema.json"),
			'{"tables":["hand-edited"],"functions":[],"roles":[]}',
		);

		const result = await runCli(cwd, ["vendor", "--check"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-check-mismatch");
		// Writes nothing: the hand edit is still there, byte for byte,
		// not silently reverted or replaced.
		const { readFile } = await import("node:fs/promises");
		expect(
			await readFile(join(cwd, ".hejbro", "vendor", "schema.json"), "utf8"),
		).toBe('{"tables":["hand-edited"],"functions":[],"roles":[]}');
	});

	it("checks with the remote unreachable", async () => {
		// The remote is gone entirely -- `--check` never reaches the
		// network, so this proves nothing about the check's own result,
		// only that it completes at all.
		await rm(remote.cwd, { recursive: true, force: true });

		const result = await runCli(cwd, ["vendor", "--check"]);
		expect(result.exitCode).toBe(0);
	});
});

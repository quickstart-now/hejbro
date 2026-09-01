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

const EXPORT_SQL_V1 = 'create schema "app";\n';

const writeExportFiles = async (
	remote: GitFixture,
	schema: string,
	format: string,
): Promise<void> => {
	const dir = join(remote.cwd, ".hejbro", "export");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "schema.json"), schema);
	await writeFile(join(dir, "snapshot.sql"), EXPORT_SQL_V1);
	await writeFile(join(dir, "format.json"), format);
};

let remote: GitFixture;
let cwd: string;

beforeEach(async () => {
	remote = await createGitFixture();
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await remote.cleanup();
	await removeCliFixtureDir(cwd);
});

/**
 * R2-G7: the eleven named failure situations (`.agents/
 * r2-failure-enumeration.md`) — this file covers the members that
 * needed genuinely new code (5, 6, and the reserved schema filter);
 * members already covered by earlier groups' own tests (1, 3, 4, 8, 9)
 * are not re-tested here.
 */
describe("hejbro vendor — the eleven named failure situations (R2-G7)", () => {
	it("refuses a description that does not answer its own format (member 5)", async () => {
		await writeExportFiles(
			remote,
			// Not an ExportDescription at all -- a plausible hand-edit
			// (renamed "tables" to "table"), not an empty/garbage file.
			'{"table":[],"functions":[],"roles":[]}',
			'{"descriptionFormat":1,"snapshotFormat":8}',
		);
		remote.commit("export v1", "2026-01-01T10:00:00Z");
		await runCli(cwd, ["link", remote.cwd]);

		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-export-invalid");
	});

	it("refuses a newer description format and names the upgrade (member 6)", async () => {
		await writeExportFiles(
			remote,
			'{"tables":[],"functions":[],"roles":[],"snapshot":{"formatVersion":8,"dialect":"postgres","objects":{}}}',
			'{"descriptionFormat":99,"snapshotFormat":8}',
		);
		remote.commit("export v1", "2026-01-01T10:00:00Z");
		await runCli(cwd, ["link", remote.cwd]);

		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-export-format-unsupported");
		expect(result.stderr).toContain("99");
		expect(result.stderr).toContain("hejbro@latest");
	});

	it("refuses the reserved --schema filter", async () => {
		await writeExportFiles(
			remote,
			'{"tables":[],"functions":[],"roles":[],"snapshot":{"formatVersion":8,"dialect":"postgres","objects":{}}}',
			'{"descriptionFormat":1,"snapshotFormat":8}',
		);
		remote.commit("export v1", "2026-01-01T10:00:00Z");
		await runCli(cwd, ["link", remote.cwd]);

		const result = await runCli(cwd, ["vendor", "--schema", "app"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-schema-filter-reserved");
	});
});

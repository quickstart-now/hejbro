import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

/** A schema repository that has already run `hejbro generate --export`
 * once -- a real git commit carrying the three export files, so `vendor`
 * has something real to fetch. Content is fixture-level, not produced by
 * the real `generate --export` (that byte-for-byte proof is R2-G2's
 * own; this group's is that vendor reads the files back unchanged). */
const writeExport = async (
	remote: GitFixture,
	schema: string,
	sql: string,
): Promise<void> => {
	const dir = join(remote.cwd, ".hejbro", "export");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "schema.json"), schema);
	await writeFile(join(dir, "snapshot.sql"), sql);
	await writeFile(join(dir, "format.json"), EXPORT_FORMAT_V1);
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

const readLock = async (): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(join(cwd, "hejbro.lock"), "utf8"));

const readSourceFile = async (): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(join(cwd, "hejbro.json"), "utf8"));

const readVendored = (name: string): Promise<string> =>
	readFile(join(cwd, ".hejbro", "vendor", name), "utf8");

describe("hejbro vendor", () => {
	it("writes the description and the squashed SQL and records the commit", async () => {
		await writeExport(remote, EXPORT_SCHEMA_V1, EXPORT_SQL_V1);
		const commit = remote.commit("export v1", "2026-01-01T10:00:00Z");
		await runCli(cwd, ["link", remote.cwd]);

		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(0);

		expect(await readVendored("schema.json")).toBe(EXPORT_SCHEMA_V1);
		expect(await readVendored("snapshot.sql")).toBe(EXPORT_SQL_V1);
		const lock = await readLock();
		expect(lock.commit).toBe(commit);
		expect(lock.resolvedFrom).toBe("main");
		expect(lock.source).toBeUndefined();
		expect(await readSourceFile()).toEqual({ source: remote.cwd });
	});

	it("the lock records the description format version", async () => {
		await writeExport(remote, EXPORT_SCHEMA_V1, EXPORT_SQL_V1);
		remote.commit("export v1", "2026-01-01T10:00:00Z");
		await runCli(cwd, ["link", remote.cwd]);

		await runCli(cwd, ["vendor"]);

		const lock = await readLock();
		expect(lock.descriptionFormat).toBe(1);
	});

	it("--ref does not persist and the lock records its origin", async () => {
		await writeExport(remote, EXPORT_SCHEMA_V1, EXPORT_SQL_V1);
		const taggedCommit = remote.commit("export v1", "2026-01-01T10:00:00Z");
		execFileSync("git", ["tag", "v1"], { cwd: remote.cwd });
		await writeExport(
			remote,
			'{"tables":["later"],"functions":[],"roles":[]}',
			EXPORT_SQL_V1,
		);
		const headCommit = remote.commit("export v2", "2026-01-02T10:00:00Z");
		expect(taggedCommit).not.toBe(headCommit);
		await runCli(cwd, ["link", remote.cwd]);

		const refRun = await runCli(cwd, ["vendor", "--ref", "v1"]);
		expect(refRun.exitCode).toBe(0);
		expect((await readLock()).commit).toBe(taggedCommit);
		expect((await readLock()).resolvedFrom).toBe("v1");

		// The very next plain run resolves the default branch again --
		// --ref never stuck as a persisted preference.
		const plainRun = await runCli(cwd, ["vendor"]);
		expect(plainRun.exitCode).toBe(0);
		expect((await readLock()).commit).toBe(headCommit);
		expect((await readLock()).resolvedFrom).toBe("main");
	});

	it("refuses when no source is linked", async () => {
		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-source-not-linked");
	});

	it("refuses naming the other repository when the commit carries no export", async () => {
		await writeFile(join(remote.cwd, "readme.txt"), "no export here\n");
		remote.commit("no export here", "2026-01-01T10:00:00Z");
		await runCli(cwd, ["link", remote.cwd]);

		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-export-missing");
	});

	it("a missing git binary is a coded failure", async () => {
		await writeExport(remote, EXPORT_SCHEMA_V1, EXPORT_SQL_V1);
		remote.commit("export v1", "2026-01-01T10:00:00Z");
		// `link` itself never shells out to git -- linking with a normal
		// PATH first, then stripping git for the `vendor` call, isolates
		// the failure to exactly the command this task is about.
		await runCli(cwd, ["link", remote.cwd]);

		const result = await runCli(cwd, ["vendor"], {
			// biome-ignore lint/style/useNamingConvention: PATH is the POSIX environment variable itself, not a naming choice of this codebase's own
			env: { ...process.env, PATH: "" },
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-git-missing");
		expect(result.stderr).not.toMatch(/ENOENT|spawn/);
	});
});

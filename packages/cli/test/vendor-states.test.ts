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

const readLock = async (): Promise<Record<string, unknown>> =>
	JSON.parse(await readFile(join(cwd, "hejbro.lock"), "utf8"));

const VALID_SCHEMA =
	'{"tables":[],"functions":[],"roles":[],"snapshot":{"formatVersion":8,"dialect":"postgres","objects":{}}}';
const VALID_FORMAT = '{"descriptionFormat":1,"snapshotFormat":8}';

/** Genuinely discards `remote`'s current history (not just moves a ref
 * away from it) -- an orphan branch replaces `main`, and the old
 * objects are pruned so a later `git fetch <remote> <old-sha>` fails
 * for real, the same as a force-push followed by garbage collection on
 * a real host. */
const rewriteRemoteHistory = async (remote: GitFixture): Promise<void> => {
	// biome-ignore lint/style/useNamingConvention: environment variable name
	const gitEnv = { ...process.env, TZ: "UTC" };
	execFileSync("git", ["checkout", "-q", "--orphan", "rewritten"], {
		cwd: remote.cwd,
		env: gitEnv,
	});
	// The new history's own tip must carry a real export too -- `--force`
	// still has to succeed once the consumer deliberately moves past the
	// lost commit.
	await writeExportFiles(remote, VALID_SCHEMA, VALID_FORMAT);
	execFileSync("git", ["add", "-A"], { cwd: remote.cwd, env: gitEnv });
	execFileSync("git", ["commit", "-q", "-m", "rewritten"], {
		cwd: remote.cwd,
		env: {
			...gitEnv,
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_AUTHOR_NAME: "hejbro test",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_AUTHOR_EMAIL: "test@example.com",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_COMMITTER_NAME: "hejbro test",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_COMMITTER_EMAIL: "test@example.com",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_AUTHOR_DATE: "2026-01-02T10:00:00Z",
			// biome-ignore lint/style/useNamingConvention: git environment variable name
			GIT_COMMITTER_DATE: "2026-01-02T10:00:00Z",
		},
	});
	execFileSync("git", ["branch", "-D", "main"], {
		cwd: remote.cwd,
		env: gitEnv,
	});
	execFileSync("git", ["branch", "-m", "rewritten", "main"], {
		cwd: remote.cwd,
		env: gitEnv,
	});
	execFileSync(
		"git",
		["reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"],
		{ cwd: remote.cwd, env: gitEnv },
	);
	execFileSync("git", ["gc", "--prune=now"], {
		cwd: remote.cwd,
		env: gitEnv,
	});
};

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

	it("names the remote as unreachable rather than leaking a raw git crash (member 2, the other half of vendor-git-missing)", async () => {
		await runCli(cwd, ["link", "/no/such/path/on/this/machine"]);

		const result = await runCli(cwd, ["vendor"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendor-remote-unreachable");
		expect(result.stderr).toContain("/no/such/path/on/this/machine");
		// Never a raw subprocess crash -- a coded diagnostic naming what
		// git itself said, not a bare stack trace.
		expect(result.stderr).not.toContain("at Object");
		expect(result.stderr).not.toContain("Command failed:");
	});

	it("refuses to move the lock past a commit the remote no longer has (member 7)", async () => {
		await writeExportFiles(remote, VALID_SCHEMA, VALID_FORMAT);
		const lostCommit = remote.commit("export v1", "2026-01-01T10:00:00Z");
		await runCli(cwd, ["link", remote.cwd]);
		const firstVendor = await runCli(cwd, ["vendor"]);
		expect(firstVendor.exitCode).toBe(0);
		expect((await readLock()).commit).toBe(lostCommit);

		await rewriteRemoteHistory(remote);

		const secondVendor = await runCli(cwd, ["vendor"]);
		expect(secondVendor.exitCode).toBe(1);
		expect(secondVendor.stderr).toContain("vendor-lock-commit-lost");
		expect(secondVendor.stderr).toContain(lostCommit);
		// The remedy is a decision, not a repair -- the lock is untouched.
		expect((await readLock()).commit).toBe(lostCommit);

		// --force is the same deliberate override the destination-file
		// guard already uses -- it moves the lock forward on purpose.
		const forced = await runCli(cwd, ["vendor", "--force"]);
		expect(forced.exitCode).toBe(0);
		expect((await readLock()).commit).not.toBe(lostCommit);
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

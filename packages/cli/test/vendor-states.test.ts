import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CliRun } from "./support/cli-runner";
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
 * R2-G7: the ten named failure situations (`.agents/
 * r2-failure-enumeration.md`) — this file covers the members that
 * needed genuinely new code (5, 6, and the reserved schema filter);
 * members already covered by earlier groups' own tests (1, 3, 4, 8, 9)
 * are not re-tested here. A local replacement (a committed source
 * pointing at a local path) is deliberately NOT one of the ten: that
 * situation belongs to `replace`, which this change does not build, and
 * a committed local path is itself a legitimate configuration (a
 * monorepo-neighbor checkout) — this whole file's own fixtures rely on
 * exactly that shape.
 */
describe("hejbro vendor — the ten named failure situations (R2-G7)", () => {
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

	describe("member: the lock was resolved from a non-default ref", () => {
		it("an explicit --ref is advisory at vendor, then refused at vendor --check by default, and only warns with --no-strict", async () => {
			await writeExportFiles(remote, VALID_SCHEMA, VALID_FORMAT);
			remote.commit("export v1", "2026-01-01T10:00:00Z");
			execFileSync("git", ["tag", "v1"], { cwd: remote.cwd });
			await runCli(cwd, ["link", remote.cwd]);

			const vendored = await runCli(cwd, ["vendor", "--ref", "v1"]);
			expect(vendored.exitCode).toBe(0);
			expect(vendored.stderr).toContain("not the remote's default branch");
			expect(vendored.stderr).not.toContain("vendor-lock-non-default-ref");
			expect((await readLock()).resolvedBy).toBe("explicit-ref");

			const checked = await runCli(cwd, ["vendor", "--check"]);
			expect(checked.exitCode).toBe(1);
			expect(checked.stderr).toContain("vendor-lock-non-default-ref");
			expect(checked.stderr).toContain("--strict");
			expect(checked.stderr).toContain("--no-strict");

			const lenientCheck = await runCli(cwd, [
				"vendor",
				"--check",
				"--no-strict",
			]);
			expect(lenientCheck.exitCode).toBe(0);
			expect(lenientCheck.stderr).toContain("not the remote's default branch");
		});

		it("the default branch never triggers it, even at the boundary", async () => {
			await writeExportFiles(remote, VALID_SCHEMA, VALID_FORMAT);
			remote.commit("export v1", "2026-01-01T10:00:00Z");
			await runCli(cwd, ["link", remote.cwd]);
			await runCli(cwd, ["vendor"]);
			expect((await readLock()).resolvedBy).toBe("default-branch");

			const checked = await runCli(cwd, ["vendor", "--check"]);
			expect(checked.exitCode).toBe(0);
			expect(checked.stderr).toBe("");
		});
	});

	/**
	 * 7.5: compares the codes themselves, not their labels -- a
	 * consolidated run of all ten, each in its own fixture, asserting the
	 * ten diagnostic *codes* are pairwise distinct. Wording can drift
	 * harmlessly; two situations quietly sharing one code cannot (this
	 * codebase has had that exact regression escape a label-only
	 * comparison before).
	 */
	it("reports ten distinct codes", async () => {
		const extractCode = (stderr: string): string | null => {
			const match = stderr.match(/error\[([a-z0-9-]+)\]/);
			if (match === null) {
				return null;
			}
			return match[1] ?? null;
		};

		const withFixture = async (
			run: (dir: string, fixtureRemote: GitFixture) => Promise<CliRun>,
		): Promise<string | null> => {
			const dir = await createCliFixtureDir();
			const fixtureRemote = await createGitFixture();
			try {
				const result = await run(dir, fixtureRemote);
				return extractCode(result.stderr);
			} finally {
				await removeCliFixtureDir(dir);
				await fixtureRemote.cleanup();
			}
		};

		const scenarios: ReadonlyArray<() => Promise<string | null>> = [
			// 1. No source is linked.
			() => withFixture((dir) => runCli(dir, ["vendor"])),
			// 2. The remote cannot be reached or does not exist.
			() =>
				withFixture(async (dir) => {
					await runCli(dir, ["link", "/no/such/path/on/this/machine"]);
					return runCli(dir, ["vendor"]);
				}),
			// 3. The ref does not resolve.
			() =>
				withFixture(async (dir, fixtureRemote) => {
					await writeExportFiles(fixtureRemote, VALID_SCHEMA, VALID_FORMAT);
					fixtureRemote.commit("export v1", "2026-01-01T10:00:00Z");
					await runCli(dir, ["link", fixtureRemote.cwd]);
					return runCli(dir, ["vendor", "--ref", "no-such-ref"]);
				}),
			// 4. The resolved commit carries no export.
			() =>
				withFixture(async (dir, fixtureRemote) => {
					await writeFile(
						join(fixtureRemote.cwd, "readme.txt"),
						"no export here\n",
					);
					fixtureRemote.commit("no export here", "2026-01-01T10:00:00Z");
					await runCli(dir, ["link", fixtureRemote.cwd]);
					return runCli(dir, ["vendor"]);
				}),
			// 5. The export is present but does not answer its own format.
			() =>
				withFixture(async (dir, fixtureRemote) => {
					await writeExportFiles(
						fixtureRemote,
						'{"table":[],"functions":[],"roles":[]}',
						VALID_FORMAT,
					);
					fixtureRemote.commit("export v1", "2026-01-01T10:00:00Z");
					await runCli(dir, ["link", fixtureRemote.cwd]);
					return runCli(dir, ["vendor"]);
				}),
			// 6. The IR format is newer than this toolchain knows.
			() =>
				withFixture(async (dir, fixtureRemote) => {
					await writeExportFiles(
						fixtureRemote,
						VALID_SCHEMA,
						'{"descriptionFormat":99,"snapshotFormat":8}',
					);
					fixtureRemote.commit("export v1", "2026-01-01T10:00:00Z");
					await runCli(dir, ["link", fixtureRemote.cwd]);
					return runCli(dir, ["vendor"]);
				}),
			// 7. The lock names a commit the remote no longer has.
			() =>
				withFixture(async (dir, fixtureRemote) => {
					await writeExportFiles(fixtureRemote, VALID_SCHEMA, VALID_FORMAT);
					fixtureRemote.commit("export v1", "2026-01-01T10:00:00Z");
					await runCli(dir, ["link", fixtureRemote.cwd]);
					await runCli(dir, ["vendor"]);
					await rewriteRemoteHistory(fixtureRemote);
					return runCli(dir, ["vendor"]);
				}),
			// 8. The vendored files disagree with the lock.
			() =>
				withFixture(async (dir, fixtureRemote) => {
					await writeExportFiles(fixtureRemote, VALID_SCHEMA, VALID_FORMAT);
					fixtureRemote.commit("export v1", "2026-01-01T10:00:00Z");
					await runCli(dir, ["link", fixtureRemote.cwd]);
					await runCli(dir, ["vendor"]);
					await writeFile(
						join(dir, ".hejbro", "vendor", "schema.json"),
						'{"tables":[],"functions":[],"roles":[],"snapshot":{"formatVersion":8,"dialect":"postgres","objects":{}},"hand-edited":true}',
					);
					return runCli(dir, ["vendor", "--check"]);
				}),
			// 9. The destination holds a file this tool did not write.
			() =>
				withFixture(async (dir) => {
					await writeFile(
						join(dir, "hejbro.lock"),
						'{\n\t"commit": "0000000000000000000000000000000000000000",\n\t"resolvedFrom": "main"\n}\n',
					);
					return runCli(dir, ["vendor"]);
				}),
			// 10. The lock was resolved from somewhere other than the default
			// branch.
			() =>
				withFixture(async (dir, fixtureRemote) => {
					await writeExportFiles(fixtureRemote, VALID_SCHEMA, VALID_FORMAT);
					fixtureRemote.commit("export v1", "2026-01-01T10:00:00Z");
					execFileSync("git", ["tag", "v1"], { cwd: fixtureRemote.cwd });
					await runCli(dir, ["link", fixtureRemote.cwd]);
					await runCli(dir, ["vendor", "--ref", "v1"]);
					return runCli(dir, ["vendor", "--check"]);
				}),
		];

		const codes = await Promise.all(scenarios.map((scenario) => scenario()));
		expect(codes).toEqual([
			"vendor-source-not-linked",
			"vendor-remote-unreachable",
			"vendor-ref-not-found",
			"vendor-export-missing",
			"vendor-export-invalid",
			"vendor-export-format-unsupported",
			"vendor-lock-commit-lost",
			"vendor-check-mismatch",
			"vendor-destination-not-vendored",
			"vendor-lock-non-default-ref",
		]);
		expect(new Set(codes).size).toBe(10);
	});
});

import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Task 17 acceptance: drives the *built* CLI (dist/cli.js, not any
// in-process import) against a tmp copy of this example **with its
// committed migrations/ and snapshot already in place** — proving the
// committed chain is what a fresh `verify`/`generate` sees, mirroring
// examples/cli-smoke/test/e2e.test.ts's tmp-copy harness.

const EXAMPLE_ROOT = join(import.meta.dirname, "..");
const CLI_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "cli");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");
const CLI_INDEX_PATH = join(CLI_PACKAGE_ROOT, "dist", "index.js");
const CORE_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "core");

/** Mirrors packages/cli/test/support/cli-runner.ts's `newestMtimeMs`. */
const newestMtimeMs = (dir: string): number => {
	const entries = readdirSync(dir, { withFileTypes: true });
	return entries.reduce((newest, entry) => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			return Math.max(newest, newestMtimeMs(fullPath));
		}
		return Math.max(newest, statSync(fullPath).mtimeMs);
	}, 0);
};

/** Mirrors packages/cli/test/support/cli-runner.ts's `assertFreshBuild` (#131) — this test spawns the built CLI, so it can't see an unbuilt source edit any other way. */
const assertFreshBuild = (label: string, packageRoot: string): void => {
	const srcMtime = newestMtimeMs(join(packageRoot, "src"));
	const distMtime = newestMtimeMs(join(packageRoot, "dist"));
	if (distMtime < srcMtime) {
		throw new Error(
			`${label}'s dist/ is older than its src/ (stale build) — Next: run \`pnpm build --force\` (a plain \`pnpm build\` can replay a cached run without rewriting dist).`,
		);
	}
};

/** Mirrors packages/cli/test/support/cli-runner.ts's `assertBuiltCli` (#102, #131) — a confusing "no such file" spawn error otherwise hides an incomplete build, and a stale-but-present one hides a silent false green. */
const assertBuiltCli = (): void => {
	const missing = [CLI_PATH, CLI_INDEX_PATH].filter((p) => !existsSync(p));
	if (missing.length > 0) {
		throw new Error(
			`built CLI artifacts missing: ${missing.join(", ")} — run pnpm build (turbo should have built hejbro before its tests; if you see this under turbo, capture the turbo log for #102)`,
		);
	}
	assertFreshBuild("@hejbro/core", CORE_PACKAGE_ROOT);
	assertFreshBuild("hejbro", CLI_PACKAGE_ROOT);
};

beforeAll(assertBuiltCli);

type CliRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

// `ExecException.code` is `string | number | undefined` (unlike
// `NodeJS.ErrnoException.code`, which is `string | undefined`) — typed to
// match what `execFile`'s callback actually hands us, so this compiles
// under `exactOptionalPropertyTypes`.
const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

/** True when `stderr` is one of hejbro's own diagnostic blocks (`error[<code>]: ...`, §7 grammar) — an *expected* non-zero exit this test asserted on, not a spawn/crash symptom worth logging (#102, mirrors packages/cli/test/support/cli-runner.ts). */
const isHejbroDiagnostic = (stderr: string): boolean =>
	stderr.trimStart().startsWith("error[");

const runCli = (cwd: string, args: ReadonlyArray<string>): Promise<CliRun> =>
	new Promise((resolve) => {
		execFile(
			process.execPath,
			[CLI_PATH, ...args],
			{ cwd },
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ exitCode: 0, stdout, stderr });
					return;
				}
				const exitCode = exitCodeFrom(error);
				// Keep the full child stderr in the report even when the test's
				// own assertions don't inspect it — a flaky failure otherwise
				// leaves no trace of what the spawned CLI actually printed (#102).
				// Skip the log for hejbro's own diagnostics: those are expected
				// non-zero exits this test asserted on.
				if (!isHejbroDiagnostic(stderr)) {
					console.error(`[cli-runner] exit ${exitCode}\n${stderr}`);
				}
				resolve({ exitCode, stdout, stderr });
			},
		);
	});

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-example-postgres-"));
	await Promise.all([
		cp(join(EXAMPLE_ROOT, "hejbro.config.ts"), join(cwd, "hejbro.config.ts")),
		cp(
			join(EXAMPLE_ROOT, "hejbro.snapshot.json"),
			join(cwd, "hejbro.snapshot.json"),
		),
		cp(join(EXAMPLE_ROOT, "migrations"), join(cwd, "migrations"), {
			recursive: true,
		}),
		mkdir(join(cwd, "src"), { recursive: true }).then(() =>
			cp(
				join(EXAMPLE_ROOT, "src", "app.schema.ts"),
				join(cwd, "src", "app.schema.ts"),
			),
		),
	]);
	// A tmp dir outside the workspace has no node_modules, so the
	// fixture's `import { ... } from "hejbro"` (U2 self-import cycle)
	// can't resolve on its own — link straight to the built package.
	await mkdir(join(cwd, "node_modules"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("hejbro cli (built CLI, tmp copy of examples/postgres with its committed chain)", () => {
	it("verify passes and generate reports no changes against the committed chain", async () => {
		const verifyResult = await runCli(cwd, ["verify"]);
		expect(verifyResult.exitCode).toBe(0);
		expect(verifyResult.stdout).toContain("verify:");

		const generateResult = await runCli(cwd, ["generate"]);
		expect(generateResult.exitCode).toBe(0);
		expect(generateResult.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);

		const migrationFiles = (await readdir(join(cwd, "migrations"))).filter(
			(name) => name.endsWith(".sql"),
		);
		expect(migrationFiles).toHaveLength(6);
	});
});

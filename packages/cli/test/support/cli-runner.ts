import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcript } from "./call-transcript";

// Shared tmp-dir + built-CLI runner for generate-command.test.ts and
// golden.test.ts. Drives `dist/cli.js` via child_process rather than
// `runGenerate` in-process: `loadDeclarations` jiti-imports fixture files
// through Node's own module resolution, which can resolve a different
// `@hejbro/core` instance than a vitest-transformed in-process call to
// `generateMigration` would use (planner handoff note #2, PR B Task 10
// finding) — running the real, built CLI is how a user actually invokes it,
// so this sidesteps the mismatch entirely rather than working around it in
// test-only code.
const CLI_PACKAGE_ROOT = join(import.meta.dirname, "..", "..");
export const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");
const CLI_INDEX_PATH = join(CLI_PACKAGE_ROOT, "dist", "index.js");
const SUPABASE_PACKAGE_ROOT = join(CLI_PACKAGE_ROOT, "..", "supabase");
const CORE_PACKAGE_ROOT = join(CLI_PACKAGE_ROOT, "..", "core");

/** The most recent mtime (ms since epoch) of any file under `dir`, recursively. */
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

/**
 * Throws when `${packageRoot}/dist`'s newest file predates
 * `${packageRoot}/src`'s newest file (#131) — a subprocess test spawns the
 * built CLI directly, so it resolves every workspace package through
 * `dist`, not through vitest's own module graph; `resolve.alias`ing
 * in-process tests to source (the fix for those) can't help a child
 * process see a source edit that hasn't been rebuilt yet. Detection, not
 * prevention, is the right shape here: a checkable precondition (dist
 * newer than src) fails loudly instead of being trusted silently.
 *
 * The remedy has to say `--force`: turbo's cache is content-addressed, so
 * a src file whose *mtime* moved but whose *content* didn't (a branch
 * switch, a `git stash pop`, `touch`) still hits the cache — a plain
 * `pnpm build` then replays the previous run's logs without writing
 * `dist` again, leaving this guard red and the suggested fix unable to
 * clear it (reproduced: `touch`ed a content-unchanged src file, `pnpm
 * build` printed "cache hit" and left `dist` older than `src`, `pnpm
 * build --force` fixed it). Over-eager rather than dangerous either way
 * — the false-positive direction this guard can take is "demands a
 * rebuild turbo considers unnecessary," never "silently accepts a stale
 * one."
 */
const assertFreshBuild = (label: string, packageRoot: string): void => {
	const srcMtime = newestMtimeMs(join(packageRoot, "src"));
	const distMtime = newestMtimeMs(join(packageRoot, "dist"));
	if (distMtime < srcMtime) {
		throw new Error(
			`${label}'s dist/ is older than its src/ (stale build) — Next: run \`pnpm build --force\` (a plain \`pnpm build\` can replay a cached run without rewriting dist).`,
		);
	}
};

/**
 * Asserts the built CLI artifacts exist, and are at least as fresh as
 * their own and `@hejbro/core`'s source, before any test spawns them
 * (#102, #131): turbo should always build `hejbro` before running its
 * tests, but a flaky/incomplete build would otherwise surface as a
 * confusing "no such file" spawn error deep inside `execFile`, and a
 * stale-but-present build would surface as a silent false green. Call
 * from a `beforeAll` in every test file that spawns the built CLI.
 */
export const assertBuiltCli = (): void => {
	const missing = [CLI_PATH, CLI_INDEX_PATH].filter((p) => !existsSync(p));
	if (missing.length > 0) {
		throw new Error(
			`built CLI artifacts missing: ${missing.join(", ")} — run pnpm build (turbo should have built hejbro before its tests; if you see this under turbo, capture the turbo log for #102)`,
		);
	}
	assertFreshBuild("@hejbro/core", CORE_PACKAGE_ROOT);
	assertFreshBuild("hejbro", CLI_PACKAGE_ROOT);
};

/** `ExecException.code` is `string | number | undefined` (unlike `NodeJS.ErrnoException.code`, which is `string | undefined`) — typed to match what `execFile`'s callback actually hands us. */
const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

/** True when `stderr` is one of hejbro's own diagnostic blocks (`error[<code>]: ...`, §7 grammar) — an *expected* non-zero exit a negative-path test asserted on, not a spawn/crash symptom worth logging (#102: most of a suite's non-zero exits are intentional, and logging all of them buried the one signal that mattered). */
const isHejbroDiagnostic = (stderr: string): boolean =>
	stderr.trimStart().startsWith("error[");

export type CliRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

/** Creates a fresh tmp dir with `node_modules/hejbro` symlinked back to this package's real root, so a fixture's `import { ... } from "hejbro"` (U2 self-import cycle) resolves exactly as an installed dependency would. Also symlinks `node_modules/@hejbro/supabase`, so a preset fixture's `import { supabasePreset, storageBucket } from "@hejbro/supabase"` resolves — `hejbro`'s own `dependencies` never include `@hejbro/supabase` (it's a devDependency of the CLI package used only by these fixtures, D55). Caller is responsible for `rm`-ing the returned path. */
export const createCliFixtureDir = async (): Promise<string> => {
	const cwd = await mkdtemp(join(tmpdir(), "hejbro-cli-"));
	await mkdir(join(cwd, "node_modules", "@hejbro"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
	await symlink(
		SUPABASE_PACKAGE_ROOT,
		join(cwd, "node_modules", "@hejbro", "supabase"),
		"dir",
	);
	return cwd;
};

export const removeCliFixtureDir = (cwd: string): Promise<void> =>
	rm(cwd, { recursive: true, force: true });

/** Milliseconds remaining until the next whole-second wall-clock boundary — always in `(0, 1000]`. */
const msUntilNextSecondBoundary = (): number => 1000 - (Date.now() % 1000);

/**
 * #220: `generate`'s `timestamp`/`unix` prefixes have second resolution,
 * and production code deliberately does *not* prevent a same-second
 * collision (owner decision — detect + offer a command at `verify` time,
 * not a generate-time wait/reject). A test that drives two `generate`
 * calls back to back would otherwise be flaky: whether they land in the
 * same second is real-clock timing, and a same-second collision now trips
 * verify's own `duplicate-migration-version` check. This wait is
 * test-support only — nothing in the shipped CLI ever calls it — so it
 * buys determinism for the *test suite* without reintroducing the
 * generate-time wait the owner rejected for the product itself.
 */
const waitForNextSecondBoundary = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, msUntilNextSecondBoundary()));

export const runCli = async (
	cwd: string,
	args: ReadonlyArray<string>,
	options?: { readonly env?: NodeJS.ProcessEnv },
): Promise<CliRun> => {
	if (args[0] === "generate") {
		await waitForNextSecondBoundary();
	}
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			[CLI_PATH, ...args],
			{ cwd, env: options?.env ?? process.env },
			(error, stdout, stderr) => {
				if (error === null) {
					// #533 G2.3b: recorded unconditionally, unlike the
					// console.error below -- a call that succeeds still
					// belongs in the transcript, since the test that made
					// it can fail on its own assertions about this stdout.
					transcript.record({
						argv: [CLI_PATH, ...args],
						cwd,
						exitCode: 0,
						stdout,
						stderr,
					});
					resolve({ exitCode: 0, stdout, stderr });
					return;
				}
				const exitCode = exitCodeFrom(error);
				transcript.record({ argv: [CLI_PATH, ...args], cwd, exitCode, stdout, stderr });
				// Keep the full child stderr in the report even when the test's
				// own assertions don't inspect it — a flaky failure otherwise
				// leaves no trace of what the spawned CLI actually printed (#102).
				// Skip the log for hejbro's own diagnostics: those are expected
				// non-zero exits a negative-path test asserted on. This is a
				// narrower, separate decision from the transcript's own
				// recording above (never filtered) -- see call-transcript.ts.
				if (!isHejbroDiagnostic(stderr)) {
					console.error(`[cli-runner] exit ${exitCode}\n${stderr}`);
				}
				resolve({ exitCode, stdout, stderr });
			},
		);
	});
};

export const writeFixtureFile = async (
	cwd: string,
	relativePath: string,
	content: string,
): Promise<void> => {
	const fullPath = join(cwd, relativePath);
	await mkdir(join(fullPath, ".."), { recursive: true });
	await writeFile(fullPath, content);
};

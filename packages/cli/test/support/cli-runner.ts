import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/**
 * Asserts the built CLI artifacts exist before any test spawns them (#102):
 * turbo should always build `hejbro` before running its tests, but a
 * flaky/incomplete build would otherwise surface as a confusing "no such
 * file" spawn error deep inside `execFile`. Call from a `beforeAll` in
 * every test file that spawns the built CLI.
 */
export const assertBuiltCli = (): void => {
	const missing = [CLI_PATH, CLI_INDEX_PATH].filter((p) => !existsSync(p));
	if (missing.length > 0) {
		throw new Error(
			`built CLI artifacts missing: ${missing.join(", ")} — run pnpm build (turbo should have built hejbro before its tests; if you see this under turbo, capture the turbo log for #102)`,
		);
	}
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

export const runCli = (
	cwd: string,
	args: ReadonlyArray<string>,
	options?: { readonly env?: NodeJS.ProcessEnv },
): Promise<CliRun> =>
	new Promise((resolve) => {
		execFile(
			process.execPath,
			[CLI_PATH, ...args],
			{ cwd, env: options?.env ?? process.env },
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
				// non-zero exits a negative-path test asserted on.
				if (!isHejbroDiagnostic(stderr)) {
					console.error(`[cli-runner] exit ${exitCode}\n${stderr}`);
				}
				resolve({ exitCode, stdout, stderr });
			},
		);
	});

export const writeFixtureFile = async (
	cwd: string,
	relativePath: string,
	content: string,
): Promise<void> => {
	const fullPath = join(cwd, relativePath);
	await mkdir(join(fullPath, ".."), { recursive: true });
	await writeFile(fullPath, content);
};

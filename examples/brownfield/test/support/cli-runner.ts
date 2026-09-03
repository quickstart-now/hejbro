import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Self-contained, adapted from `packages/cli/test/support/cli-runner.ts`
 * (planner instruction, #714 bc-1: `packages/*` is read-only for this
 * piece, so this is not an import of that file) -- mirrors the pattern
 * `examples/cli-smoke/test/vendored-contract.integration.test.ts` already
 * established for driving the *built* CLI from an examples package: a
 * real `execFile` subprocess against `dist/cli.js`, a tmp fixture dir
 * with `node_modules/hejbro` symlinked back to the real package root (so
 * a fixture's `import { ... } from "hejbro"` resolves exactly as an
 * installed dependency would), and a dist-freshness guard so a stale
 * build fails loudly instead of silently passing.
 */
const CLI_PACKAGE_ROOT = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"packages",
	"cli",
);
export const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");
const CLI_INDEX_PATH = join(CLI_PACKAGE_ROOT, "dist", "index.js");
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
 * `${packageRoot}/src`'s newest file (mirrors `packages/cli/test/
 * support/cli-runner.ts`'s own `assertFreshBuild` -- see that file for
 * the full `pnpm build --force` reasoning, unchanged here).
 */
const assertFreshBuild = (label: string, packageRoot: string): void => {
	const srcMtime = newestMtimeMs(join(packageRoot, "src"));
	const distMtime = newestMtimeMs(join(packageRoot, "dist"));
	if (distMtime < srcMtime) {
		throw new Error(
			`${label}'s dist/ is older than its src/ (stale build) -- Next: run \`pnpm build --force\` (a plain \`pnpm build\` can replay a cached run without rewriting dist).`,
		);
	}
};

/** Asserts the built CLI artifacts exist and are at least as fresh as their own and `@hejbro/core`'s source, before any test spawns them. Call from a `beforeAll` in every test file here that spawns the built CLI. */
export const assertBuiltCli = (): void => {
	const missing = [CLI_PATH, CLI_INDEX_PATH].filter((p) => !existsSync(p));
	if (missing.length > 0) {
		throw new Error(
			`built CLI artifacts missing: ${missing.join(", ")} -- run pnpm build (turbo should have built hejbro before its tests)`,
		);
	}
	assertFreshBuild("@hejbro/core", CORE_PACKAGE_ROOT);
	assertFreshBuild("hejbro", CLI_PACKAGE_ROOT);
};

const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

export type CliRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

/** Creates a fresh tmp dir with `node_modules/hejbro` symlinked back to the built package's real root, so a fixture's `import { ... } from "hejbro"` (U2 self-import cycle) resolves exactly as an installed dependency would. Caller is responsible for removing the returned path (`removeCliFixtureDir`). */
export const createCliFixtureDir = async (): Promise<string> => {
	const cwd = await mkdtemp(join(tmpdir(), "hejbro-brownfield-"));
	await mkdir(join(cwd, "node_modules"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
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
				resolve({ exitCode: exitCodeFrom(error), stdout, stderr });
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

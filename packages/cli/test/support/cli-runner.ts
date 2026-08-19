import { execFile } from "node:child_process";
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

export type CliRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

/** Creates a fresh tmp dir with `node_modules/hejbro` symlinked back to this package's real root, so a fixture's `import { ... } from "hejbro"` (U2 self-import cycle) resolves exactly as an installed dependency would. Caller is responsible for `rm`-ing the returned path. */
export const createCliFixtureDir = async (): Promise<string> => {
	const cwd = await mkdtemp(join(tmpdir(), "hejbro-cli-"));
	await mkdir(join(cwd, "node_modules"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
	return cwd;
};

export const removeCliFixtureDir = (cwd: string): Promise<void> =>
	rm(cwd, { recursive: true, force: true });

export const runCli = (
	cwd: string,
	args: ReadonlyArray<string>,
): Promise<CliRun> =>
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
				const exitCode = typeof error.code === "number" ? error.code : 1;
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

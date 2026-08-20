import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Task 17 acceptance: drives the *built* CLI (dist/cli.js, not any
// in-process import) against a tmp copy of this example **with its
// committed migrations/ and snapshot already in place** — proving the
// committed chain is what a fresh `verify`/`generate` sees, mirroring
// examples/cli-smoke/test/e2e.test.ts's tmp-copy harness.

const EXAMPLE_ROOT = join(import.meta.dirname, "..");
const CLI_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "cli");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");

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
				resolve({ exitCode: exitCodeFrom(error), stdout, stderr });
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
		expect(migrationFiles).toHaveLength(4);
	});
});

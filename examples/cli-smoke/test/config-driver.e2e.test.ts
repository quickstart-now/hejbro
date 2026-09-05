import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// add-config-driver, #458, task 1.5: proves the configured `driver`
// factory over the built CLI, driven through a subprocess -- 1.2/1.3/1.4's
// own globalThis seam only works in-process and cannot reach here.

const EXAMPLE_ROOT = join(import.meta.dirname, "..");
const CLI_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "cli");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");
const NEON_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "neon");

const assertBuiltCli = (): void => {
	if (!existsSync(CLI_PATH)) {
		throw new Error(
			`built CLI artifact missing: ${CLI_PATH} -- run pnpm build (turbo should have built hejbro before its tests)`,
		);
	}
};

beforeAll(assertBuiltCli);

type ExecResult = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

const run = (
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
): Promise<ExecResult> =>
	new Promise((resolve) => {
		execFile(command, args, { cwd }, (error, stdout, stderr) => {
			if (error === null) {
				resolve({ exitCode: 0, stdout, stderr });
				return;
			}
			resolve({ exitCode: exitCodeFrom(error), stdout, stderr });
		});
	});

const runCli = (
	cwd: string,
	args: ReadonlyArray<string>,
): Promise<ExecResult> => run(process.execPath, [CLI_PATH, ...args], cwd);

/**
 * Only `hejbro` itself is linked -- deliberately never `@hejbro/pg`
 * (strong oracle, cd-planner's own instruction): if the configured
 * factory were ever bypassed, the vanilla path's dynamic `import("@hejbro/
 * pg")` would fail to resolve here, surfacing as `check-driver-missing`.
 * That diagnostic's absence is this suite's proof the factory ran,
 * observed by outcome rather than by reading the source.
 */
const linkHejbro = async (cwd: string): Promise<void> => {
	await mkdir(join(cwd, "node_modules"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
};

/** #458 review round 1, task 1.11: `@hejbro/neon` linked the same way -- a
 * real dependency of the real package (bundled as external, `type-
 * overrides.ts`'s own runtime `import { types } from "@neondatabase/
 * serverless"`) resolves from the symlink's own real location, walking
 * up through `packages/neon/node_modules` the same way `hejbro`'s own
 * workspace dependencies already do -- no second symlink needed.
 * `@hejbro/neon` is also a declared devDependency of this package: the
 * path symlink alone is invisible to turbo, so without the declaration
 * `^build` never builds neon before this suite and CI's `pnpm test`
 * (which runs before `pnpm build`) fails at the config import. */
const linkNeon = async (cwd: string): Promise<void> => {
	await mkdir(join(cwd, "node_modules", "@hejbro"), { recursive: true });
	await symlink(
		NEON_PACKAGE_ROOT,
		join(cwd, "node_modules", "@hejbro", "neon"),
		"dir",
	);
};

const SCHEMA_SOURCE = `import { schema, table, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
});
`;

/** The factory writes the connection string it receives to `callFilePath` before returning a minimal, closable driver -- so the write happens whether or not the connectivity probe that follows ever succeeds against this fixture's own non-real driver (spec: "the resolved connection string only", 1.2's own call order). */
const factoryConfigSource = (
	callFilePath: string,
): string => `import { defineConfig } from "hejbro";
import { writeFileSync } from "node:fs";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	driver: (connectionString) => {
		writeFileSync(${JSON.stringify(callFilePath)}, connectionString);
		return {
			capabilities: {
				"interactive-transactions": false,
				"session-state": false,
			},
			execute: async () => {
				throw new Error("no real database backs this e2e fixture");
			},
			transaction: async () => {
				throw new Error("transaction should not be called by this test");
			},
			setupSession: async () => {},
			client: { end: async () => {} },
		};
	},
});
`;

/**
 * #458 review round 1, task 1.11: the real `@hejbro/neon` HTTP driver
 * (`neonDriver`'s function-argument overload), fed a fake `HttpQueryable`
 * -- never the real `neon(connectionString)` client, so this stays fully
 * offline and deterministic like 1.5's own fixture. Proves the real
 * package's driver passes the CLI's closable gate and reaches the fake
 * queryable, not a reimplementation of the driver shape. `callLogPath`
 * records every call the fake queryable receives, `;`-joined.
 */
const neonHttpConfigSource = (
	callLogPath: string,
): string => `import { defineConfig } from "hejbro";
import { neonDriver } from "@hejbro/neon";
import { appendFileSync, writeFileSync } from "node:fs";

const logPath = ${JSON.stringify(callLogPath)};

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	driver: (connectionString) => {
		writeFileSync(logPath, "");
		const fakeSql = Object.assign(
			() => {
				throw new Error("tagged-template form not used by this fixture");
			},
			{
				query: () => {
					appendFileSync(logPath, "query;");
					return [];
				},
				transaction: async (members) => {
					appendFileSync(logPath, "transaction;");
					return members.map(() => []);
				},
			},
		);
		return neonDriver(fakeSql);
	},
});
`;

const STRING_DRIVER_CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	driver: "pg",
});
`;

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-config-driver-e2e-"));
	await linkHejbro(cwd);
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("a configured driver factory serves hejbro check over the built CLI (#458 task 1.5)", () => {
	it("hejbro check --url calls the factory with that string, never falling back to @hejbro/pg", async () => {
		const callFilePath = join(cwd, "factory-call.txt");
		const init = await runCli(cwd, ["init"]);
		expect(init.exitCode).toBe(0);
		await writeFile(
			join(cwd, "hejbro.config.ts"),
			factoryConfigSource(callFilePath),
		);
		await mkdir(join(cwd, "src"), { recursive: true });
		await writeFile(join(cwd, "src", "app.schema.ts"), SCHEMA_SOURCE);
		const generate = await runCli(cwd, ["generate"]);
		expect(generate.exitCode).toBe(0);

		const check = await runCli(cwd, ["check", "--url", "postgres://x"]);

		// Not exit-code 0: this fixture's own driver has no real Postgres
		// behind it, so a later catalog read can legitimately fail. The
		// proof is the file the factory itself wrote, and the two vanilla-
		// path diagnostics it must never have reached instead.
		expect(existsSync(callFilePath)).toBe(true);
		expect(readFileSync(callFilePath, "utf8")).toBe("postgres://x");
		expect(check.stderr).not.toContain("check-driver-missing");
		expect(check.stderr).not.toContain("check-connection-missing");
	});

	it("hejbro check fails at config load when driver is a string, naming the field, before any command work", async () => {
		const callFilePath = join(cwd, "factory-call.txt");
		const init = await runCli(cwd, ["init"]);
		expect(init.exitCode).toBe(0);
		await writeFile(join(cwd, "hejbro.config.ts"), STRING_DRIVER_CONFIG_SOURCE);
		await mkdir(join(cwd, "src"), { recursive: true });
		await writeFile(join(cwd, "src", "app.schema.ts"), SCHEMA_SOURCE);

		const check = await runCli(cwd, ["check", "--url", "postgres://x"]);

		expect(check.exitCode).not.toBe(0);
		expect(check.stderr).toContain("driver");
		expect(check.stderr).toContain("invalid-config");
		expect(existsSync(callFilePath)).toBe(false);
	});
});

// #458 review round 1, task 1.11: the real @hejbro/neon HTTP driver,
// configured as `driver`, passes the CLI's closable gate -- fully
// offline (a fake queryable, never a real neon(connectionString)
// client), so this stays as deterministic as 1.5's own fixture.
describe("the real @hejbro/neon HTTP driver passes the CLI's closable gate (#458 task 1.11)", () => {
	it("hejbro check --url reaches the fake queryable, never check-driver-unclosable", async () => {
		await linkNeon(cwd);
		const callLogPath = join(cwd, "neon-http-calls.txt");
		const init = await runCli(cwd, ["init"]);
		expect(init.exitCode).toBe(0);
		await writeFile(
			join(cwd, "hejbro.config.ts"),
			neonHttpConfigSource(callLogPath),
		);
		await mkdir(join(cwd, "src"), { recursive: true });
		await writeFile(join(cwd, "src", "app.schema.ts"), SCHEMA_SOURCE);
		const generate = await runCli(cwd, ["generate"]);
		expect(generate.exitCode).toBe(0);

		const check = await runCli(cwd, ["check", "--url", "postgres://x"]);

		// Not exit-code 0: the fake queryable answers every statement with
		// empty rows, so a later comparison can legitimately report a
		// difference. The proof is the call log the fake queryable itself
		// wrote, and the three diagnostics this run must never have hit.
		expect(existsSync(callLogPath)).toBe(true);
		expect(readFileSync(callLogPath, "utf8")).toContain("transaction;");
		expect(check.stderr).not.toContain("check-driver-unclosable");
		expect(check.stderr).not.toContain("check-driver-missing");
		expect(check.stderr).not.toContain("check-connection-missing");
	});
});

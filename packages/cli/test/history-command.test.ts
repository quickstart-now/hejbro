import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";
import { GIT_TEST_ENV } from "./support/git-fixture";

beforeAll(assertBuiltCli);

// hejbro history/restore's own e2e coverage (#130): the built-CLI
// child_process approach (see support/cli-runner.ts's own doc comment)
// -- loadConfig's jiti import needs the same node_modules/hejbro
// resolution generate-command.test.ts already relies on.

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
});
`;

const SCHEMA_SOURCE = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

// git environment variable names below, not a naming choice of this codebase's own
const FIXED_COMMIT_DATE_ENV = {
	...GIT_TEST_ENV,
	// biome-ignore lint/style/useNamingConvention: git environment variable name
	GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z",
	// biome-ignore lint/style/useNamingConvention: git environment variable name
	GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z",
};

const git = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: FIXED_COMMIT_DATE_ENV,
	});

describe("hejbro history", () => {
	it("not-a-git-repository: exits 1 with the shared guard message", async () => {
		const cwd = await createCliFixtureDir();
		try {
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			const result = await runCli(cwd, ["history"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[not-a-git-repository]");
			expect(result.stderr).toContain(
				"this project is not inside a git repository",
			);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("config-not-found: exits 1 even inside a git repository, before the git check", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			const result = await runCli(cwd, ["history"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error[config-not-found]");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("a single committed migration renders one ok row", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			const initResult = await runCli(cwd, ["init"]);
			expect(initResult.exitCode).toBe(0);
			const generateResult = await runCli(cwd, ["generate"]);
			expect(generateResult.exitCode).toBe(0);
			git(cwd, ["add", "-A"]);
			git(cwd, ["commit", "-q", "-m", "feat: posts table"]);

			const result = await runCli(cwd, ["history"]);
			expect(result.exitCode).toBe(0);
			const lines = result.stdout.trim().split("\n");
			expect(lines[0]).toContain("#");
			expect(lines[0]).toContain("migration");
			expect(lines[0]).toContain("commit");
			expect(lines[0]).toContain("state");
			expect(lines[1]).toContain("0001_add_app.sql");
			expect(lines[1]).toContain("ok");
			expect(lines[1]).toContain("feat: posts table");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});

	it("an uncommitted migration renders state uncommitted", async () => {
		const cwd = await createCliFixtureDir();
		try {
			git(cwd, ["init", "-q", "-b", "main"]);
			await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
			await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
			await runCli(cwd, ["init"]);
			await runCli(cwd, ["generate"]);
			// deliberately not committed

			const result = await runCli(cwd, ["history"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("(uncommitted)");
			expect(result.stdout).toContain("uncommitted");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});

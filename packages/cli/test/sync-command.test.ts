import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// Same stripped-env reasoning as check-command.test.ts's own
// envWithoutDatabaseUrl: a real DATABASE_URL in this machine's own
// environment would otherwise make "no connection" untestable.
const envWithoutDatabaseUrl = (): NodeJS.ProcessEnv => {
	const env = { ...process.env };
	env.DATABASE_URL = undefined;
	return env;
};

const AMBIGUOUS_ENTRY_CONFIG = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/one.schema.ts", "src/two.schema.ts"],
	presets: [],
});
`;

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
	await runCli(cwd, ["init"]);
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

describe("hejbro sync", () => {
	it("fails with a coded error when no connection is available", async () => {
		const result = await runCli(cwd, ["sync"], {
			env: envWithoutDatabaseUrl(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-connection-missing");
	});

	it('refuses when --out is absent and "entry" doesn\'t name a single file', async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", AMBIGUOUS_ENTRY_CONFIG);

		const result = await runCli(cwd, ["sync"], {
			env: envWithoutDatabaseUrl(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-destination-required");
	});

	it("--out reaching runSync skips the destination refusal", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", AMBIGUOUS_ENTRY_CONFIG);

		const result = await runCli(cwd, ["sync", "--out", "schema.synced.ts"], {
			env: envWithoutDatabaseUrl(),
		});

		// Past the destination check and into connection resolution --
		// proof --out was read, without needing a real database.
		expect(result.stderr).not.toContain("sync-destination-required");
		expect(result.stderr).toContain("sync-connection-missing");
	});
});

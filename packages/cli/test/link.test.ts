import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

describe("hejbro link", () => {
	it("names the config field to add, for the given source", async () => {
		const result = await runCli(cwd, [
			"link",
			"https://example.com/org/schema.git",
		]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("schemaSource");
		expect(result.stdout).toContain(
			'schemaSource: "https://example.com/org/schema.git",',
		);
	});

	it("refuses with no source given", async () => {
		const result = await runCli(cwd, ["link"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("link-source-required");
	});
});

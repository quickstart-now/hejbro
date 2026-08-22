import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_VERSION } from "../src/version";

describe("CLI_VERSION", () => {
	it("matches this package's own package.json version field, read at runtime (not hardcoded)", () => {
		const packageJsonPath = join(import.meta.dirname, "..", "package.json");
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			readonly version: string;
		};
		expect(CLI_VERSION).toBe(packageJson.version);
	});
});

import { describe, expect, it } from "vitest";

describe("package entry", () => {
	it("importing the package entry succeeds", async () => {
		const entry = await import("../src/index.ts");
		expect(entry).toBeDefined();
	});
});

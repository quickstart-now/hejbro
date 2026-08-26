import { eq } from "@hejbro/core";
import { expect, test } from "vitest";

// Scaffold guard: the package's vitest resolves `@hejbro/core` straight
// to core's public entry in source (#131 alias), so these tests can never
// pass against a stale build.
test("resolves @hejbro/core from source via the alias", () => {
	expect(typeof eq).toBe("function");
});

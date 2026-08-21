import { describe, expect, it } from "vitest";
import { asHejbroError } from "../src/errors";

describe("asHejbroError", () => {
	// #125's premise, locked in as a test (owner-directed): a `code`-bearing
	// Node error must never be misidentified as a HejbroError. Before the
	// instanceof conversion, asHejbroError duck-types on "code"/"message"
	// presence — and a Node error like ERR_MODULE_NOT_FOUND has both (its
	// own, non-enumerable `message` still satisfies `"message" in error`),
	// so it passes the duck type and is returned as-is instead of being
	// rethrown. This test must be red until asHejbroError checks
	// `instanceof HejbroError` instead.
	it("does not misidentify a code-bearing Node error as a HejbroError", () => {
		const nodeError = Object.assign(new Error("Cannot find module 'x'"), {
			code: "ERR_MODULE_NOT_FOUND",
		});

		expect(() => asHejbroError(nodeError)).toThrow(nodeError);
	});
});

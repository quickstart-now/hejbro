import { describe, expect, it } from "vitest";
import { identityFromMessage } from "../src/identity";

describe("identityFromMessage", () => {
	it("prefers an adjacent quoted pair, joined with a dot", () => {
		const message = 'table "app"."posts" is exposed. Next: declare rls(...).';
		expect(identityFromMessage(message, "fallback")).toBe("app.posts");
	});

	it("falls back to the first bare quoted token when there is no adjacent pair", () => {
		const message = 'unknown flag "--bogus" — check the spelling.';
		expect(identityFromMessage(message, "fallback")).toBe("--bogus");
	});

	it("falls back to the supplied identity when the message has no quoted substring", () => {
		const message = "something went wrong with no quotes at all";
		expect(identityFromMessage(message, "fallback")).toBe("fallback");
	});
});

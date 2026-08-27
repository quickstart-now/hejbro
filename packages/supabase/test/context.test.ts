import { describe, expect, it } from "vitest";
import { asAnon, asUser } from "../src/context";
import { anonRole, authenticatedRole } from "../src/roles";

describe("asUser(claims)/asAnon() context builders", () => {
	it("asUser builds the authenticated role plus one JSON claims setting; asAnon builds anon", () => {
		const userContext = asUser({ sub: "user-123", email: "a@example.com" });
		expect(userContext.role).toBe(authenticatedRole);
		expect(Object.keys(userContext.settings ?? {})).toEqual([
			"request.jwt.claims",
		]);
		expect(
			JSON.parse(userContext.settings?.["request.jwt.claims"] ?? "{}"),
		).toEqual({
			sub: "user-123",
			email: "a@example.com",
			role: "authenticated",
		});

		const anonContext = asAnon();
		expect(anonContext.role).toBe(anonRole);
		expect(
			JSON.parse(anonContext.settings?.["request.jwt.claims"] ?? "{}"),
		).toEqual({ role: "anon" });
	});

	it("never trusts a caller-supplied role claim -- always overwrites it with authenticated", () => {
		const userContext = asUser({ sub: "user-123", role: "service_role" });
		expect(
			JSON.parse(userContext.settings?.["request.jwt.claims"] ?? "{}"),
		).toEqual({ sub: "user-123", role: "authenticated" });
	});

	it("fails fast with claims-subject-missing when an untyped caller omits sub", () => {
		try {
			// biome-ignore lint/suspicious/noExplicitAny: exercising a caller that bypasses the type
			asUser({} as any);
			expect.unreachable("asUser should have thrown");
		} catch (error) {
			expect(error).toHaveProperty("code", "claims-subject-missing");
		}
	});
});

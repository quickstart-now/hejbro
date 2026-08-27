import { describe, expect, it } from "vitest";
import { asAnon, asUser } from "../src/context";
import { anonRole, authenticatedRole } from "../src/roles";

describe("asUser(claims)/asAnon() context builders", () => {
	it("asUser builds the authenticated role plus one JSON claims setting; asAnon builds anon", () => {
		const userContext = asUser({ sub: "user-123", email: "a@example.com" });
		expect(userContext.role).toBe(authenticatedRole);
		// exactly one setting -- never fanned out into multiple flat keys
		// (task 6.0's scout: auth.uid() reads the single request.jwt.claims
		// JSON, no separate request.jwt.claim.sub key is needed).
		expect(Object.keys(userContext.settings ?? {})).toEqual([
			"request.jwt.claims",
		]);
		// set_config($1, $2, true) binds text parameters -- the setting's
		// value must be a JSON *string*, not an object, or that call breaks
		// at the driver boundary.
		expect(typeof userContext.settings?.["request.jwt.claims"]).toBe("string");
		expect(
			JSON.parse(userContext.settings?.["request.jwt.claims"] ?? "{}"),
		).toEqual({
			sub: "user-123",
			email: "a@example.com",
			role: "authenticated",
		});

		const anonContext = asAnon();
		expect(anonContext.role).toBe(anonRole);
		expect(typeof anonContext.settings?.["request.jwt.claims"]).toBe("string");
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

	it("the type already rejects a claims object missing sub, before runtime ever sees it", () => {
		// Never actually invoked -- a compile-time-only assertion (repo
		// precedent: packages/query/test/db/fn-types.test.ts's own
		// `_neverCalled` closures). `@ts-expect-error` itself is the proof:
		// if `Claims["sub"]` were optional, this line would type-check and
		// `pnpm check-types` would fail on an unused-`@ts-expect-error`
		// directive instead.
		const _neverCalled = () =>
			// @ts-expect-error -- Claims requires "sub"; this object omits it.
			asUser({ email: "a@example.com" });
		void _neverCalled;
	});
});

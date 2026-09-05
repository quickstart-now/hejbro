import { schema, select, table, text, uuid } from "@hejbro/core";
import type { Driver, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import type { NeonAuthMode } from "../src/context";
import { neonAuth } from "../src/context";
import { anonymousRole, authenticatedRole } from "../src/roles";

describe("neonAuth(mode) -- a surface exposes only its own mode's builders", () => {
	it("the claims-mode surface exposes asUser and asAnonymous", () => {
		const surface = neonAuth("claims");
		expect(Object.keys(surface).sort()).toEqual(["asAnonymous", "asUser"]);
	});

	it("the jwt-mode surface exposes asJwtUser and asAnonymous", () => {
		const surface = neonAuth("jwt");
		expect(Object.keys(surface).sort()).toEqual(["asAnonymous", "asJwtUser"]);
	});

	it("the type layer rejects cross-mode access -- compile-time only, never invoked", () => {
		// `@ts-expect-error` itself is the proof: if either builder were
		// accessible on the wrong-mode surface, this line would type-check
		// and `pnpm check-types` would fail on an unused directive instead
		// (repo precedent: packages/supabase/test/context.test.ts).
		const _neverCalled1 = () =>
			// @ts-expect-error -- the claims-mode surface has no asJwtUser.
			neonAuth("claims").asJwtUser;
		const _neverCalled2 = () =>
			// @ts-expect-error -- the jwt-mode surface has no asUser.
			neonAuth("jwt").asUser;
		// An unnarrowed mode (e.g. an `as`-cast environment variable) SHALL
		// expose neither builder rather than both (rls-execution-context
		// spec, "An unnarrowed mode exposes neither builder").
		const unnarrowedMode = "claims" as NeonAuthMode;
		const _neverCalled3 = () =>
			// @ts-expect-error -- an unnarrowed NeonAuthMode exposes neither builder.
			neonAuth(unnarrowedMode).asUser;
		const _neverCalled4 = () =>
			// @ts-expect-error -- an unnarrowed NeonAuthMode exposes neither builder.
			neonAuth(unnarrowedMode).asJwtUser;
		void _neverCalled1;
		void _neverCalled2;
		void _neverCalled3;
		void _neverCalled4;
	});
});

describe("asUser(claims) (task 5.2)", () => {
	it("requires a subject, fixes the role, and ignores a supplied role claim", () => {
		const { asUser } = neonAuth("claims");
		const context = asUser({
			sub: "user-123",
			email: "a@example.com",
			role: "service_role",
		});

		expect(context.role).toBe(authenticatedRole);
		expect(Object.keys(context.settings ?? {})).toEqual(["request.jwt.claims"]);
		expect(typeof context.settings?.["request.jwt.claims"]).toBe("string");
		expect(
			JSON.parse(context.settings?.["request.jwt.claims"] ?? "{}"),
		).toEqual({
			sub: "user-123",
			email: "a@example.com",
			role: "authenticated",
		});
	});

	it("fails fast with claims-subject-missing when an untyped caller omits sub", () => {
		const { asUser } = neonAuth("claims");
		try {
			// biome-ignore lint/suspicious/noExplicitAny: exercising a caller that bypasses the type
			asUser({} as any);
			expect.unreachable("asUser should have thrown");
		} catch (error) {
			expect(error).toHaveProperty("code", "claims-subject-missing");
		}
	});

	it("the type already rejects a claims object missing sub, before runtime ever sees it", () => {
		const { asUser } = neonAuth("claims");
		const _neverCalled = () =>
			// @ts-expect-error -- Claims requires "sub"; this object omits it.
			asUser({ email: "a@example.com" });
		void _neverCalled;
	});
});

describe("asJwtUser(token) (task 5.3)", () => {
	it("passes the token through untouched under the jwt mode's setting", () => {
		const { asJwtUser } = neonAuth("jwt");
		// Surrounding whitespace on purpose (task 6.1's own measured gap):
		// a token with no leading/trailing space can't tell "untouched"
		// apart from "trimmed" -- a `token.trim()` inserted into the
		// builder would still pass a whitespace-free fixture.
		const token = "  header.payload.signature  ";
		const context = asJwtUser(token);

		expect(context.role).toBe(authenticatedRole);
		expect(context.settings).toEqual({ "pg_session_jwt.jwt": token });
	});
});

describe("asAnonymous() (task 5.4)", () => {
	it("applies the anonymous role with no identity setting, on both surfaces", () => {
		const claimsContext = neonAuth("claims").asAnonymous();
		const jwtContext = neonAuth("jwt").asAnonymous();

		expect(claimsContext).toEqual({ role: anonymousRole });
		expect(jwtContext).toEqual({ role: anonymousRole });
	});
});

/**
 * A minimal reduction of `@hejbro/query`'s own `recordingTransactionalDriver`
 * (`packages/query/test/db/recording-driver.ts`, read-only reference) --
 * duplicated here rather than imported, same reasoning as the oid
 * constants: a preset's tests stay inside its own package, never reaching
 * into another package's test internals.
 */
const recordingDriver = (): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<
		Array<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
	>;
} => {
	const sentPerTransaction: Array<
		Array<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
	> = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: vi.fn(async () => []),
		transaction: vi.fn(async (callback) => {
			const sent: Array<{
				readonly sql: string;
				readonly params: ReadonlyArray<unknown>;
			}> = [];
			sentPerTransaction.push(sent);
			const session: DriverSession = {
				execute: vi.fn(async (compiled) => {
					sent.push({ sql: compiled.sql, params: compiled.params });
					return [];
				}),
			};
			return callback(session);
		}),
		setupSession: vi.fn(async () => {}),
		contributedRoles: [authenticatedRole, anonymousRole],
	};
	return { driver, sentPerTransaction };
};

describe("every context applies with transaction-local scope (task 5.5)", () => {
	const appSchema = schema("app");
	const widgets = table(appSchema, "widgets", {
		id: uuid().primaryKey().defaultRandom(),
		name: text().notNull(),
	});
	const declarations = { widgets };

	it("applies identity settings with transaction-local scope -- asserted on the statement itself", async () => {
		const { driver, sentPerTransaction } = recordingDriver();
		const handle = db(declarations, driver);
		const context = neonAuth("claims").asUser({ sub: "user-123" });

		await handle.as(context).execute(select(widgets));

		// index 0 is `set local role`, index 1 is the claims set_config call
		// -- `true` (transaction-local) is indistinguishable from a plain
		// session-scoped call once you only read the value back inside the
		// same transaction (D96), so this reads the emitted SQL text
		// itself, not a value.
		const settingStatement = sentPerTransaction[0]?.[1];
		expect(settingStatement?.sql).toBe("select set_config($1, $2, true)");
		expect(settingStatement?.params).toEqual([
			"request.jwt.claims",
			context.settings?.["request.jwt.claims"],
		]);
	});

	it("applies the jwt-mode setting with transaction-local scope too", async () => {
		const { driver, sentPerTransaction } = recordingDriver();
		const handle = db(declarations, driver);
		const context = neonAuth("jwt").asJwtUser("a.b.c");

		await handle.as(context).execute(select(widgets));

		const settingStatement = sentPerTransaction[0]?.[1];
		expect(settingStatement?.sql).toBe("select set_config($1, $2, true)");
		expect(settingStatement?.params).toEqual(["pg_session_jwt.jwt", "a.b.c"]);
	});
});

import { roleName, schema, table, uuid } from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import { asAnon, asUser } from "../src/context";
import { supabaseDriver } from "../src/driver";
import { anonRole, authenticatedRole, serviceRole } from "../src/roles";

/** A minimal contract `Driver` fixture -- no concrete driver implementation, mirroring `packages/query/test/db/db.test.ts`'s own `fakeDriver`. */
const fakeDriver = (): Driver => ({
	capabilities: { "interactive-transactions": true, "session-state": true },
	execute: vi.fn(async () => []),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => []) }),
	),
	setupSession: vi.fn(async () => {}),
});

describe("supabaseDriver(driver) decorator", () => {
	it("contributes exactly the three Supabase roles", () => {
		const wrapped = supabaseDriver(fakeDriver());

		expect(wrapped.contributedRoles).toEqual([
			anonRole,
			authenticatedRole,
			serviceRole,
		]);
	});

	it("passes every wrapped driver member through unchanged", () => {
		const driver = fakeDriver();
		const wrapped = supabaseDriver(driver);

		const passthroughKeys = Object.keys(driver) as ReadonlyArray<keyof Driver>;
		expect(passthroughKeys).not.toHaveLength(0);
		passthroughKeys.forEach((key) => {
			expect(wrapped[key]).toBe(driver[key]);
		});
	});
});

describe("task 4.7 (a') union wiring proof -- driver-contributed roles on a grant-less schema", () => {
	it("driver-contributed roles unlock asUser/asAnon on a grant-less schema; undeclared roles stay rejected", () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		// zero grants, zero RLS policies -- the only role source here is
		// supabaseDriver's own contributedRoles.
		const grantlessSchema = { posts };
		const handle = db(grantlessSchema, supabaseDriver(fakeDriver()));

		expect(() => handle.as(asAnon())).not.toThrow();
		expect(() => handle.as(asUser({ sub: "user-1" }))).not.toThrow();

		try {
			handle.as({ role: roleName("nonexistent_role") });
			expect.unreachable("db.as should have thrown for an undeclared role");
		} catch (error) {
			expect(error).toHaveProperty("code", "undeclared-role");
		}
	});
});

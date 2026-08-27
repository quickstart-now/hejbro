import type { Driver } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
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

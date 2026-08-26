import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	Driver,
	DriverCapabilities,
	DriverSession,
} from "../../src/driver/contract";

describe("Driver capability contract (owner decision ①, task 4.1)", () => {
	it("a driver missing a capability key is a compile error", () => {
		// @ts-expect-error "session-state" is missing from the exhaustive capability record.
		const _missingKey: DriverCapabilities = {
			"interactive-transactions": true,
		};
	});

	it("every declared capability present compiles cleanly (positive control)", () => {
		const capabilities: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": false,
		};
		expectTypeOf(capabilities).toEqualTypeOf<DriverCapabilities>();
	});

	it("an undeclared capability key is also a compile error (excess-property check, not just a missing one)", () => {
		const _extraKey: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": true,
			// @ts-expect-error "streaming" was never declared as a capability key.
			streaming: true,
		};
	});

	it("execute is mandatory on Driver itself, not a capability flag (owner decision ①'s other half)", () => {
		// @ts-expect-error a Driver without `execute` is missing its mandatory prerequisite.
		const _missingExecute: Driver = {
			capabilities: {
				"interactive-transactions": true,
				"session-state": true,
			},
			transaction: async <T>(
				callback: (session: DriverSession) => Promise<T>,
			) => callback({ execute: async () => [] }),
			setupSession: async () => {},
		};
	});
});

describe("Driver.contributedRoles (task 4.7's role-contribution slot, batch C reopening reason)", () => {
	const baseDriver: Omit<Driver, "contributedRoles"> = {
		capabilities: { "interactive-transactions": true, "session-state": true },
		execute: async () => [],
		transaction: async (callback) => callback({ execute: async () => [] }),
		setupSession: async () => {},
	};

	it("a driver may omit contributedRoles entirely (positive control -- most drivers contribute none) -- the assignment itself is the assertion, no cast needed", () => {
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture -- compiling without a cast is the assertion.
		const driver: Driver = { ...baseDriver };
	});

	it("a driver may declare the role names it contributes, readable back as ReadonlyArray<string>", () => {
		const driver: Driver = {
			...baseDriver,
			contributedRoles: ["anon", "authenticated", "service_role"],
		};
		expect(driver.contributedRoles).toEqual([
			"anon",
			"authenticated",
			"service_role",
		]);
	});
});

import { describe, expectTypeOf, it } from "vitest";
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

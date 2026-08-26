import { describe, expect, it, vi } from "vitest";
import type { Driver } from "../../src/driver/contract";
import { assertCapability } from "../../src/driver/errors";

/** A driver whose every member is a spy, so a test can assert none of them ran. */
const spyDriver = (interactiveTransactions: boolean): Driver => ({
	capabilities: {
		"interactive-transactions": interactiveTransactions,
		"session-state": true,
	},
	execute: vi.fn(async () => []),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => []) }),
	),
	setupSession: vi.fn(async () => {}),
});

describe("assertCapability (task 4.2)", () => {
	it("transaction on a non-transactional driver fails naming the capability", () => {
		const driver = spyDriver(false);

		expect(() =>
			assertCapability(driver, "interactive-transactions", "transaction"),
		).toThrowError(/interactive-transactions/);

		try {
			assertCapability(driver, "interactive-transactions", "transaction");
			expect.unreachable("assertCapability should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "driver-missing-capability");
			expect(error).toHaveProperty("capability", "interactive-transactions");
			expect(error).toHaveProperty("operation", "transaction");
			expect((error as Error).message).toMatch(/Next:/);
		}

		// the whole point of checking capabilities first: nothing on the
		// driver ever ran, not even once -- this guard never sends anything.
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.setupSession).not.toHaveBeenCalled();
	});

	it("a declared capability passes silently (positive control)", () => {
		const driver = spyDriver(true);

		expect(() =>
			assertCapability(driver, "interactive-transactions", "transaction"),
		).not.toThrow();
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

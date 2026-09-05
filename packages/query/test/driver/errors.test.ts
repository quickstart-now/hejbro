import { describe, expect, it, vi } from "vitest";
import type { Driver, DriverCapabilityKey } from "../../src/driver/contract";
import { assertCapability } from "../../src/driver/errors";

/** A driver whose every member is a spy, so a test can assert none of them ran. */
const spyDriver = (
	interactiveTransactions: boolean,
	batchedTransactions = false,
): Driver => ({
	capabilities: {
		"interactive-transactions": interactiveTransactions,
		"session-state": true,
		"prepared-statements": false,
		"batched-transactions": batchedTransactions,
	},
	execute: vi.fn(async () => []),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => []) }),
	),
	batch: vi.fn(async () => []),
	setupSession: vi.fn(async () => {}),
});

describe("assertCapability (task 4.2)", () => {
	it("transaction on a non-transactional driver fails naming the capability", () => {
		const driver = spyDriver(false);

		expect(() =>
			assertCapability(driver, ["interactive-transactions"], "transaction"),
		).toThrowError(/interactive-transactions/);

		try {
			assertCapability(driver, ["interactive-transactions"], "transaction");
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
		expect(driver.batch).not.toHaveBeenCalled();
		expect(driver.setupSession).not.toHaveBeenCalled();
	});

	it("a declared capability passes silently (positive control)", () => {
		const driver = spyDriver(true);

		expect(() =>
			assertCapability(driver, ["interactive-transactions"], "transaction"),
		).not.toThrow();
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.batch).not.toHaveBeenCalled();
	});

	it("a single-key call's message is byte-identical to the pre-#486 wording (regression pin)", () => {
		const driver = spyDriver(false);

		expect(() =>
			assertCapability(driver, ["interactive-transactions"], "transaction"),
		).toThrow(
			'this driver does not declare the "interactive-transactions" capability, needed for transaction. Next: use a driver whose capabilities record sets "interactive-transactions": true, or avoid transaction on this driver.',
		);
	});

	it.each<
		[
			keys: ReadonlyArray<DriverCapabilityKey>,
			flags: { i: boolean; b: boolean },
			expectPass: boolean,
		]
	>([
		[["interactive-transactions"], { i: true, b: false }, true],
		[["interactive-transactions"], { i: false, b: false }, false],
		[
			["interactive-transactions", "batched-transactions"],
			{ i: true, b: false },
			true,
		],
		[
			["interactive-transactions", "batched-transactions"],
			{ i: false, b: true },
			true,
		],
		[
			["interactive-transactions", "batched-transactions"],
			{ i: false, b: false },
			false,
		],
		[
			["batched-transactions", "interactive-transactions"],
			{ i: false, b: false },
			false,
		],
	])("keys=%j flags=%j -> pass=%j", (keys, flags, expectPass) => {
		const driver = spyDriver(flags.i, flags.b);

		if (expectPass) {
			expect(() => assertCapability(driver, keys, "op")).not.toThrow();
		} else {
			expect(() => assertCapability(driver, keys, "op")).toThrow();
		}
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.batch).not.toHaveBeenCalled();
		expect(driver.setupSession).not.toHaveBeenCalled();
	});

	it("a multi-key failure names every key in the order the caller passed, never a single capability field", () => {
		const driver = spyDriver(false, false);

		try {
			assertCapability(
				driver,
				["batched-transactions", "interactive-transactions"],
				"op",
			);
			expect.unreachable("assertCapability should have thrown");
		} catch (error) {
			expect((error as Error).message).toBe(
				'this driver declares none of the "batched-transactions", "interactive-transactions" capabilities, one of which is needed for op. Next: use a driver whose capabilities record sets one of them true, or avoid op on this driver.',
			);
			expect(error).toHaveProperty("code", "driver-missing-capability");
			expect(error).toHaveProperty("capabilities", [
				"batched-transactions",
				"interactive-transactions",
			]);
			expect(error).toHaveProperty("operation", "op");
			expect(error).not.toHaveProperty("capability");
		}
	});
});

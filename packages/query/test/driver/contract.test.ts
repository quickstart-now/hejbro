import { describe, expect, expectTypeOf, it } from "vitest";
import type { CompileResult } from "../../src/compile/compile";
import type {
	Driver,
	DriverCapabilities,
	DriverSession,
} from "../../src/driver/contract";

describe("Driver capability contract (owner decision ①, task 4.1; three keys, task 1.1/#303)", () => {
	it("a driver missing a capability key is a compile error", () => {
		// @ts-expect-error "session-state" and "prepared-statements" are missing from the exhaustive capability record.
		const _missingKeys: DriverCapabilities = {
			"interactive-transactions": true,
		};
	});

	it("a driver missing only prepared-statements is a compile error (the third key, task 1.1)", () => {
		// @ts-expect-error "prepared-statements" is missing from the exhaustive capability record.
		const _missingPreparedStatements: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": false,
		};
	});

	it("every declared capability present compiles cleanly (positive control)", () => {
		const capabilities: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": false,
			"prepared-statements": false,
		};
		expectTypeOf(capabilities).toEqualTypeOf<DriverCapabilities>();
	});

	it("an undeclared capability key is also a compile error (excess-property check, not just a missing one)", () => {
		const _extraKey: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			// @ts-expect-error "streaming" was never declared as a capability key.
			streaming: true,
		};
	});

	it("naming a fourth key outside the fixed set is a compile error (the union stays closed, task 1.1)", () => {
		const _fourthKey: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": true,
			// @ts-expect-error "streaming-cursors" was never declared as a capability key.
			"streaming-cursors": true,
		};
	});

	it("execute is mandatory on Driver itself, not a capability flag (owner decision ①'s other half)", () => {
		// @ts-expect-error a Driver without `execute` is missing its mandatory prerequisite.
		const _missingExecute: Driver = {
			capabilities: {
				"interactive-transactions": true,
				"session-state": true,
				"prepared-statements": false,
			},
			transaction: async <T>(
				callback: (session: DriverSession) => Promise<T>,
			) => callback({ execute: async () => [] }),
			setupSession: async () => {},
		};
	});

	it("setupSession is mandatory on Driver itself (owner decision ④'s session-setup hook -- the IntervalStyle pin's contract slot)", () => {
		// @ts-expect-error a Driver without `setupSession` is missing its mandatory session-setup hook.
		const _missingSetupSession: Driver = {
			capabilities: {
				"interactive-transactions": true,
				"session-state": true,
				"prepared-statements": false,
			},
			execute: async () => [],
			transaction: async <T>(
				callback: (session: DriverSession) => Promise<T>,
			) => callback({ execute: async () => [] }),
		};
	});
});

describe("Driver.contributedRoles (task 4.7's role-contribution slot, batch C reopening reason)", () => {
	const baseDriver: Omit<Driver, "contributedRoles"> = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
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

describe("Driver.renderContext (task 1.1, #554 -- the context-rendering contribution)", () => {
	const baseDriver: Omit<Driver, "contributedRoles"> = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: async () => [],
		transaction: async (callback) => callback({ execute: async () => [] }),
		setupSession: async () => {},
	};

	it("a driver may declare a context-rendering contribution -- the assignment itself is the assertion, no cast needed", () => {
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture -- compiling without a cast is the assertion.
		const driver: Driver = {
			...baseDriver,
			renderContext: () => [],
		};
	});

	it("a driver may omit renderContext entirely (positive control -- most drivers contribute no rendering)", () => {
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture -- compiling without a cast is the assertion.
		const driver: Driver = { ...baseDriver };
	});

	it("the rendering's return type is exactly ReadonlyArray<CompileResult> -- extracted with infer, never compared as a whole object", () => {
		type ExtractReturn<T> = T extends (...args: never[]) => infer R ? R : never;
		type Rendering = NonNullable<Driver["renderContext"]>;
		expectTypeOf<ExtractReturn<Rendering>>().toEqualTypeOf<
			ReadonlyArray<CompileResult>
		>();
	});
});

describe("Driver.roleLessPlatform (task 1.2, #554 -- the role-less-platform declaration)", () => {
	const baseDriver: Omit<Driver, "contributedRoles"> = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: async () => [],
		transaction: async (callback) => callback({ execute: async () => [] }),
		setupSession: async () => {},
	};

	it("a driver may declare its platform has no roles -- readable back as data, no connection made to produce it", () => {
		const driver: Driver = { ...baseDriver, roleLessPlatform: true };
		expect(driver.roleLessPlatform).toBe(true);
	});

	it('a driver that omits the declaration reads as undefined -- absence means "this platform has roles"', () => {
		const driver: Driver = { ...baseDriver };
		expect(driver.roleLessPlatform).toBeUndefined();
		expectTypeOf(driver.roleLessPlatform).toEqualTypeOf<true | undefined>();
	});
});

describe("Driver.contextRequired (task 1.3, #554 -- the context-mandatory declaration)", () => {
	const baseDriver: Omit<Driver, "contributedRoles"> = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: async () => [],
		transaction: async (callback) => callback({ execute: async () => [] }),
		setupSession: async () => {},
	};

	it("a driver may declare a context is mandatory -- readable back as data before any connection is made", () => {
		const driver: Driver = { ...baseDriver, contextRequired: true };
		expect(driver.contextRequired).toBe(true);
	});

	it("a driver that omits the declaration leaves today's typing untouched -- existing driver values keep satisfying Driver unchanged", () => {
		const driver: Driver = { ...baseDriver };
		expect(driver.contextRequired).toBeUndefined();
		expectTypeOf(driver.contextRequired).toEqualTypeOf<true | undefined>();
	});
});

describe("roleLessPlatform and contextRequired are not capabilities (task 1.4, #554)", () => {
	it("DriverCapabilities still requires exactly the three keys (regression control, unaffected by the new driver declarations)", () => {
		const capabilities: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": false,
			"prepared-statements": false,
		};
		expectTypeOf(capabilities).toEqualTypeOf<DriverCapabilities>();
	});

	it("naming roleLessPlatform inside a capabilities object literal is a compile error (type mutant: the declaration must not widen DriverCapabilities)", () => {
		const _extra: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			// @ts-expect-error "roleLessPlatform" was never declared as a capability key.
			roleLessPlatform: true,
		};
	});

	it("naming contextRequired inside a capabilities object literal is a compile error (type mutant: the declaration must not widen DriverCapabilities)", () => {
		const _extra: DriverCapabilities = {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			// @ts-expect-error "contextRequired" was never declared as a capability key.
			contextRequired: true,
		};
	});
});

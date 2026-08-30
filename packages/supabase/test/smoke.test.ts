import { describe, expect, it } from "vitest";
/**
 * Type-only import (task 2.5) -- exists purely so a missing/renamed type
 * export is a `tsc` error at this import statement, not a silent gap a
 * runtime assertion could never catch (a type export produces no
 * runtime binding `Object.keys` could see). The pooler driver itself
 * (`poolerDriver`) stays module-internal (task 1.1) -- deliberately not
 * imported here.
 */
import type {
	SupabaseDriverEndpoint,
	SupabaseDriverOptions,
} from "../src/index";
import * as preset from "../src/index";

/** Referenced so the type-only import above isn't flagged unused -- a real presence assertion, not decoration. */
type _PoolerOptionTypesPresent = [
	SupabaseDriverEndpoint,
	SupabaseDriverOptions,
];

describe("package wiring", () => {
	it("imports cleanly", () => {
		expect(preset).toBeDefined();
	});
});

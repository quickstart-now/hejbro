import { describe, expectTypeOf, it } from "vitest";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import type { Driver } from "../../src/driver/contract";

type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
		};
	};
	readonly Functions: {
		readonly searchByStatus: {
			readonly Args: { readonly status: string; readonly maxRows: number };
			readonly Returns: ReadonlyArray<{
				readonly id: string;
				readonly title: string;
			}>;
		};
		readonly countPosts: {
			readonly Args: Record<string, never>;
			readonly Returns: bigint;
		};
	};
};

/**
 * A minimal, inert `Driver` stub -- every test in this file is a
 * compile-time assertion (`@ts-expect-error`/`expectTypeOf`), mirroring
 * `db/fn-types.test.ts`'s own fixture for the vendored `fn` surface
 * (#587/G3, 2.1's own `Record<string, never>` probe reused, now against
 * the client's public type rather than the emitted source text).
 */
const driver: Driver = {
	capabilities: { "interactive-transactions": true, "session-state": true },
	execute: async () => [],
	transaction: async (callback) => callback({ execute: async () => [] }),
	setupSession: async () => {},
};
const client = createNameKeyedDb<TestDatabase>(driver, {
	commit: "abc123",
	exportHash: "sha256:x",
	roles: [],
	tables: {},
	functions: {},
});

describe("the vendored fn's named-argument call signature (#587/G3)", () => {
	it("the correct call shape type-checks with no error", () => {
		const _neverCalled = () =>
			client.fn.searchByStatus({ status: "published", maxRows: 10 });
		void _neverCalled;
	});

	it("a typo'd argument key is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "staus" isn't a declared argument name.
			client.fn.searchByStatus({ staus: "published", maxRows: 10 });
		void _neverCalled;
	});

	it("a missing argument key is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "status" is required and wasn't provided.
			client.fn.searchByStatus({ maxRows: 10 });
		void _neverCalled;
	});

	it("a wrongly-typed argument value is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "status" must be a string, not a number.
			client.fn.searchByStatus({ status: 123, maxRows: 10 });
		void _neverCalled;
	});

	it("an excess argument key is rejected statically on a fresh object literal", () => {
		const _neverCalled = () =>
			client.fn.searchByStatus({
				status: "published",
				maxRows: 10,
				// @ts-expect-error "extra" isn't a declared argument.
				extra: "nope",
			});
		void _neverCalled;
	});

	it("a nonexistent fn key is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "doesNotExist" was never vendored.
			client.fn.doesNotExist({});
		void _neverCalled;
	});

	it("a no-arg function's Args rejects an excess property -- Record<string, never>, not {} (2.1's own probe, reused here)", () => {
		const _neverCalled = () =>
			// @ts-expect-error countPosts declares no arguments.
			client.fn.countPosts({ extra: 1 });
		void _neverCalled;
	});

	it("a table-returning function resolves to a readonly array of rows", () => {
		type Result = Awaited<ReturnType<typeof client.fn.searchByStatus>>;
		expectTypeOf<Result>().toEqualTypeOf<
			ReadonlyArray<{ readonly id: string; readonly title: string }>
		>();
	});

	it("a scalar-returning function resolves to the value itself, not an array", () => {
		type Result = Awaited<ReturnType<typeof client.fn.countPosts>>;
		expectTypeOf<Result>().toEqualTypeOf<bigint>();
	});
});

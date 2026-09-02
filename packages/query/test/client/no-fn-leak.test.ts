import { describe, expect, expectTypeOf, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import type { NameKeyedFn } from "../../src/client/name-keyed-db";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { recordingTransactionalDriver } from "../db/recording-driver";

type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
	};
	readonly Functions: {
		readonly totalPosts: {
			readonly Args: Record<string, never>;
			readonly Returns: bigint;
		};
	};
};

/**
 * The sibling of `no-table-leak.test.ts`'s own planner condition ① probe,
 * for `fn` (#587/G3): this is the actual guarantee `synthesizeFunction`'s
 * own doc comment leans on in place of a rejection marker (there is none
 * for a `FunctionDeclaration` — measured directly, see that file) — a
 * synthesized declaration's own shape (`declarationKind`/`args`/`returns`/
 * `body`/`security`) must never reach the client's public `fn` surface,
 * only a plain callable.
 */
describe("no FunctionDeclaration value crosses into the client's public fn (#587/G3)", () => {
	it("a fn entry's own type carries only a callable signature -- no declaration keys", () => {
		expectTypeOf<
			keyof NameKeyedFn<TestDatabase>["totalPosts"]
		>().toEqualTypeOf<never>();
	});

	it("NameKeyedFn<TDatabase> is keyed exactly by the contract's own function export names", () => {
		expectTypeOf<
			keyof NameKeyedFn<TestDatabase>
		>().toEqualTypeOf<"totalPosts">();
	});

	it("the runtime fn value is a plain callable, carrying no declarationKind/args/returns/body/security own property", () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ result: "1" }],
		});
		const metadata: ContractMetadata = {
			commit: "abc123",
			exportHash: "sha256:x",
			roles: [],
			tables: {},
			functions: {
				totalPosts: {
					schema: "app",
					name: "total_posts",
					args: [],
					returns: {
						kind: "scalar",
						typeNode: { typeName: "bigint" },
						mode: "bigint",
					},
				},
			},
		};

		const client = createNameKeyedDb<TestDatabase>(driver, metadata);

		expect(typeof client.fn.totalPosts).toBe("function");
		// A FunctionDeclaration is a plain object -- if `synthesizeFunction`'s
		// own value ever leaked through instead of a bound callable, these
		// own-enumerable-property checks would catch it (a function value's
		// own keys are never `declarationKind`/`args`/`returns`, unless
		// something explicitly attached them, the same mechanic
		// `no-table-leak.test.ts` checks for `[tableMeta]`).
		expect(Object.keys(client.fn.totalPosts)).toEqual([]);
		expect(Object.getOwnPropertySymbols(client.fn.totalPosts)).toEqual([]);
		expect("declarationKind" in client.fn.totalPosts).toBe(false);
		expect("args" in client.fn.totalPosts).toBe(false);
		expect("returns" in client.fn.totalPosts).toBe(false);
		expect("body" in client.fn.totalPosts).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
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
	readonly Functions: Record<string, never>;
};

/**
 * #659: every contract vendored before the typed function surface existed
 * (pre-#587) has no `functions` member in `contractMetadata` at all -- not
 * an empty object, an absent key. Upgrading only the installed packages
 * must not break that already-vendored file (schema-vendoring spec's own
 * "still type-checks against the client that reads it" clause, extended
 * from `source` to `functions`).
 */
describe("a contract vendored before functions builds a client with an empty fn (#659)", () => {
	it("a contract vendored before functions builds a client with an empty fn", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ id: "p1" }],
		});

		// Hand-written pre-#587 shape, passed directly at the call site (never
		// through an intermediate variable) -- a required `functions` member
		// on `ContractMetadata` would fail to compile right here.
		const client = createNameKeyedDb<TestDatabase>(driver, {
			source: "git",
			commit: "abc123",
			exportHash: "sha256:x",
			roles: [],
			tables: {
				posts: {
					schema: "app",
					name: "posts",
					columns: {
						id: {
							sqlName: "id",
							typeNode: { typeName: "uuid" },
							mode: null,
							notNullElements: false,
						},
					},
					foreignKeys: [],
				},
			},
		});

		const rows = await client.posts.select();
		expect(rows).toEqual([{ id: "p1" }]);

		expect.assertions(3);
		try {
			(
				client.fn as unknown as { readonly totalPosts: () => void }
			).totalPosts();
		} catch (error) {
			expect((error as { readonly code: string }).code).toBe(
				"unknown-contract-function",
			);
			expect((error as Error).message).toContain("(none vendored)");
		}
	});
});

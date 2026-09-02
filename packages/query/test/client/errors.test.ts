import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { recordingTransactionalDriver } from "../db/recording-driver";

// A type deliberately wider than `METADATA` actually vendors -- the
// shape a stale `Database` type (edited or generated against a
// different commit than `contractMetadata`) could disagree with at
// runtime, which is exactly the situation 6.8 names.
type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
		readonly comments: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
	};
	readonly Functions: Record<string, never>;
};

const METADATA: ContractMetadata = {
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
	functions: {},
};

/**
 * Errors name the contract, not internals (R2-G6 6.8): a table absent
 * from the contract fails with a coded, contract-naming error rather
 * than a raw "Cannot read properties of undefined" crash — the same
 * failure-naming discipline `undeclared-role` (6.7) already applies to
 * roles, applied here to table names.
 */
describe("errors name the contract, not internals (R2-G6 6.8)", () => {
	it("names a table absent from the contract", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		expect.assertions(2);
		try {
			// `comments` is in `TestDatabase`'s own type but never vendored
			// (`METADATA.tables` carries only `posts`) -- exactly the drift
			// this scenario names.
			client.comments.select();
		} catch (error) {
			expect((error as { readonly code: string }).code).toBe(
				"unknown-contract-table",
			);
			expect((error as Error).message).toContain("comments");
		}
	});

	it("a table the contract does carry works normally", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		await expect(client.posts.select()).resolves.toEqual([]);
	});

	it("names '(none vendored)' when the contract carries no tables at all", () => {
		const { driver } = recordingTransactionalDriver();
		const emptyMetadata: ContractMetadata = {
			commit: "abc123",
			exportHash: "sha256:x",
			roles: [],
			tables: {},
			functions: {},
		};
		const client = createNameKeyedDb<{
			readonly Tables: Record<string, never>;
			readonly Functions: Record<string, never>;
		}>(driver, emptyMetadata);

		expect.assertions(1);
		try {
			(
				client as unknown as { readonly posts: { select: () => void } }
			).posts.select();
		} catch (error) {
			expect((error as Error).message).toContain("(none vendored)");
		}
	});
});

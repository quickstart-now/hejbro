import type { DeclaredTable } from "@hejbro/core";
import { tableMeta } from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import type {
	NameKeyedDb,
	NameKeyedTableClient,
} from "../../src/client/name-keyed-db";
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
 * Planner condition ①: "no `Table` value in the client's public types",
 * proven as an assertion rather than a comment (6.1's design seal, "the
 * only observation that confirms the seal is kept"). Two independent
 * probes: a type-level exact-key check (a leaked `Table` would add keys
 * — its own column refs, or expose `[tableMeta]` as an enumerable member
 * type) and a runtime own-symbol-properties check (`Object.assign`
 * attaches `[tableMeta]` as an own symbol property, exactly the mechanic
 * `synthesizeTable`/`existingTable` both use — this is the one direct
 * way to prove that mechanic never reached the wrapper's own return
 * value).
 */
describe("no Table value crosses into the client's public types (R2-G6 6.1 condition ①)", () => {
	it("a table client's own keys are exactly select/insert/update/delete/columns — nothing else", () => {
		expectTypeOf<
			keyof NameKeyedTableClient<TestDatabase["Tables"]["posts"]>
		>().toEqualTypeOf<"select" | "insert" | "update" | "delete" | "columns">();
	});

	it("columns carries plain Expr values, never a Table (owner seal (가))", () => {
		expectTypeOf<
			NameKeyedTableClient<TestDatabase["Tables"]["posts"]>["columns"]["id"]
		>().not.toExtend<DeclaredTable>();
	});

	it("NameKeyedDb<TDatabase> is keyed exactly by the contract's own table names plus fn/as", () => {
		expectTypeOf<keyof NameKeyedDb<TestDatabase>>().toEqualTypeOf<
			"posts" | "fn" | "as"
		>();
	});

	it("the runtime client object carries no own tableMeta symbol property", () => {
		const { driver } = recordingTransactionalDriver();
		const metadata: ContractMetadata = {
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

		const client = createNameKeyedDb<TestDatabase>(driver, metadata);

		// `synthesizeTable`'s own Table value carries `[tableMeta]` as an own
		// symbol property (the exact mechanic this probes for) -- if it ever
		// leaked onto the client object this function returns, it would show
		// up here.
		expect(Object.getOwnPropertySymbols(client.posts)).toEqual([]);
		expect(Object.getOwnPropertySymbols(client)).toEqual([]);
		expect(tableMeta in client.posts).toBe(false);
	});
});

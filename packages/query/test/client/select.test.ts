import { eq } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { recordingTransactionalDriver } from "../db/recording-driver";

type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
		};
	};
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
				title: {
					sqlName: "title",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		},
	},
	functions: {},
};

describe("selects and types rows from the contract (R2-G6 6.3)", () => {
	it("selects every row, keyed by the contract's own TS keys", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello" }],
		});

		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const rows = await client.posts.select();

		expect(rows).toEqual([{ id: "p1", title: "hello" }]);
		expect(topLevelSent).toHaveLength(1);
		expect(topLevelSent[0]?.sql).toContain('"app"."posts"');
	});

	it("filters with .where(eq(...)) over the exposed columns bag (owner seal (가))", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello" }],
		});

		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const rows = await client.posts
			.select()
			.where(eq(client.posts.columns.id, "p1"));

		expect(rows).toEqual([{ id: "p1", title: "hello" }]);
		expect(topLevelSent[0]?.sql).toContain("where");
		expect(topLevelSent[0]?.params).toEqual(["p1"]);
	});
});

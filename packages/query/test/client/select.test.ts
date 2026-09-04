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
	readonly Functions: Record<string, never>;
};

const METADATA: ContractMetadata = {
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

// #740/D4: a list-shaped columns metadata's physical order reaches the
// rendered statement -- the explicit column list a consumer sends is the
// one the owning repository's own client would send, whatever the columns
// are named.
type DocsDatabase = {
	readonly Tables: {
		readonly docs: {
			readonly Row: {
				readonly id: string;
				readonly "0": string;
				readonly label: string;
				readonly "2": string;
			};
			readonly Insert: Record<string, never>;
			readonly Update: Record<string, never>;
		};
	};
	readonly Functions: Record<string, never>;
};

const PHYSICAL_ORDER_METADATA: ContractMetadata = {
	source: "git",
	commit: "abc123",
	exportHash: "sha256:x",
	roles: [],
	tables: {
		docs: {
			schema: "app",
			name: "docs",
			columns: [
				{
					key: "id",
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				{
					key: "0",
					sqlName: "0",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
				{
					key: "label",
					sqlName: "label",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
				{
					key: "2",
					sqlName: "2",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			],
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

	// #740/D4: a list-shaped columns metadata's physical order reaches the
	// rendered statement -- the explicit column list a consumer sends is
	// the one the owning repository's own client would send, whatever the
	// columns are named.
	it("a select over a vendored table lists columns in physical order", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "d1", "0": "a", label: "b", "2": "c" }],
		});

		const client = createNameKeyedDb<DocsDatabase>(
			driver,
			PHYSICAL_ORDER_METADATA,
		);
		await client.docs.select();

		expect(topLevelSent[0]?.sql).toContain(
			'"id", "0", "label", "2" from "app"."docs"',
		);
	});
});

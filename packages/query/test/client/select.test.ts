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

// #667: the runtime half of "A consumer reads a platform-owned table"
// (schema-vendoring) used to be witnessed only by the Docker-gated
// two-repository test; this is the in-process observer over a recording
// driver, so a default `pnpm test` sees the statement the client sends
// for an existing table and the relation the contract carries onto it.
type BrownfieldDatabase = {
	readonly Tables: {
		readonly users: {
			readonly Row: { readonly id: string; readonly email: string };
			readonly Insert: Record<string, never>;
			readonly Update: Record<string, never>;
		};
		readonly posts: {
			readonly Row: { readonly id: string; readonly authorId: string };
			readonly Insert: { readonly id?: string; readonly authorId: string };
			readonly Update: { readonly authorId?: string };
		};
	};
	readonly Functions: Record<string, never>;
};

const BROWNFIELD_METADATA: ContractMetadata = {
	source: "git",
	commit: "abc123",
	exportHash: "sha256:x",
	roles: [],
	tables: {
		users: {
			schema: "auth",
			name: "users",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				email: {
					sqlName: "email",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
			existing: true,
		},
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
				authorId: {
					sqlName: "author_id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [
				{
					name: "posts_author_id_fk",
					columns: ["author_id"],
					referencesSchema: "auth",
					referencesTable: "users",
					referencedColumns: ["id"],
				},
			],
		},
	},
	functions: {},
};

describe("reads an existing table through the vendored client (#667)", () => {
	it("selects the platform-owned table's declared columns, in process", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "u1", email: "a@example.test" }],
		});

		const client = createNameKeyedDb<BrownfieldDatabase>(
			driver,
			BROWNFIELD_METADATA,
		);
		const rows = await client.users.select();

		expect(rows).toEqual([{ id: "u1", email: "a@example.test" }]);
		expect(topLevelSent).toHaveLength(1);
		expect(topLevelSent[0]?.sql).toBe(
			'select "id", "email" from "auth"."users"',
		);
	});

	it("the managed table referencing it reads through the same client", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", author_id: "u1" }],
		});

		const client = createNameKeyedDb<BrownfieldDatabase>(
			driver,
			BROWNFIELD_METADATA,
		);
		const rows = await client.posts
			.select()
			.where(eq(client.posts.columns.authorId, "u1"));

		expect(rows).toEqual([{ id: "p1", authorId: "u1" }]);
		expect(topLevelSent[0]?.sql).toContain('from "app"."posts"');
		expect(topLevelSent[0]?.params).toEqual(["u1"]);
	});
});

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

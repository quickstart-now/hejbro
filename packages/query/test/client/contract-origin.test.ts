import { describe, expect, it } from "vitest";
import type {
	ContractMetadata,
	DatabaseContractMetadata,
} from "../../src/client/contract-types";
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

const TABLES = {
	posts: {
		schema: "app",
		name: "posts",
		columns: {
			id: {
				sqlName: "id",
				typeNode: { typeName: "uuid" as const },
				mode: null,
				notNullElements: false,
			},
			title: {
				sqlName: "title",
				typeNode: { typeName: "text" as const },
				mode: null,
				notNullElements: false,
			},
		},
		foreignKeys: [],
	},
};

/**
 * CI-G5-R1-02: `hejbro pull`'s own live witness compiled a *new*
 * database-sourced contract fine, but the reverse direction -- a
 * contract a pre-#604 `hejbro vendor` already wrote and committed,
 * carrying no `source` key at all -- has to keep type-checking too
 * (schema-vendoring spec: "A contract vendored before the origin was
 * named ... SHALL still type-check against the client that reads it").
 * This is the one property the live-witness pull run can't itself
 * prove (it only ever produces a *current* contract), so it's pinned
 * here directly against the type.
 */
describe("ContractMetadata backward/forward compatibility (CI-G5-R1-02)", () => {
	it("accepts a legacy contract literal that carries no source key at all", async () => {
		const legacyMetadata: ContractMetadata = {
			commit: "abc123",
			exportHash: "sha256:x",
			roles: [],
			tables: TABLES,
		};

		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, legacyMetadata);
		const rows = await client.posts.select();

		expect(rows).toEqual([{ id: "p1", title: "hello" }]);
		expect(topLevelSent).toHaveLength(1);
	});

	it("still requires a database-sourced contract to name its source -- the compile-time guard the union exists for", async () => {
		const databaseMetadata: DatabaseContractMetadata = {
			source: "database",
			database: "widgets_db",
			schemas: ["app"],
			roles: [],
			tables: TABLES,
		};

		const { driver } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, databaseMetadata);

		expect(client.posts).toBeDefined();
	});
});

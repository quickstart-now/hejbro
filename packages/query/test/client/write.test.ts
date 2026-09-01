import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { recordingTransactionalDriver } from "../db/recording-driver";

/**
 * A `slug` computed column has no key at all in `Insert` — the same
 * ALWAYS-family exclusion the contract's own static type synthesis
 * already applies (R2-G5 5.3): the client's job here is not to
 * re-derive that rule, only to type its own `insert`/`update` off the
 * contract's already-correct `Insert`/`Update` types.
 */
type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: {
				readonly id: string;
				readonly title: string;
				readonly slug: string;
			};
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
				slug: {
					sqlName: "slug",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		},
	},
};

describe("insert and update honour the contract's write optionality (R2-G6 6.4)", () => {
	it("inserts a row and sends real SQL to the driver", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello", slug: "hello" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const rows = await client.posts.insert({ title: "hello" });

		expect(rows).toEqual([{ id: "p1", title: "hello", slug: "hello" }]);
		expect(topLevelSent[0]?.sql).toContain("insert into");
		expect(topLevelSent[0]?.sql).toContain('"app"."posts"');
	});

	it("updates a row and sends real SQL to the driver", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "renamed", slug: "hello" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const rows = await client.posts.update({ title: "renamed" });

		expect(rows).toEqual([{ id: "p1", title: "renamed", slug: "hello" }]);
		expect(topLevelSent[0]?.sql).toContain("update");
	});

	it("rejects a computed column in an insert -- it has no key in Insert at all", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		// @ts-expect-error `slug` is a computed column -- absent from Insert
		// entirely (5.3), so this object literal has an excess property.
		client.posts.insert({ title: "hello", slug: "not allowed" });
	});

	it("rejects a computed column in an update -- it has no key in Update at all", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		// @ts-expect-error same exclusion, the update side.
		client.posts.update({ slug: "not allowed" });
	});
});

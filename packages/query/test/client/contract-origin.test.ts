import { describe, expect, it } from "vitest";
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
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello" }],
		});
		// The literal is the call argument itself, not a variable typed
		// ContractMetadata first -- this exercises createNameKeyedDb's own
		// declared parameter type directly (lead condition, CI-G5-R1-07):
		// an intermediate variable would only prove the *type* accepts the
		// shape, not that the *real call site* does.
		const client = createNameKeyedDb<TestDatabase>(driver, {
			commit: "abc123",
			exportHash: "sha256:x",
			roles: [],
			tables: TABLES,
			functions: {},
		});
		const rows = await client.posts.select();

		expect(rows).toEqual([{ id: "p1", title: "hello" }]);
		expect(topLevelSent).toHaveLength(1);
	});

	it("accepts a current git-sourced contract literal that names source explicitly", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, {
			source: "git",
			commit: "abc123",
			exportHash: "sha256:x",
			roles: [],
			tables: TABLES,
			functions: {},
		});
		const rows = await client.posts.select();

		expect(rows).toEqual([{ id: "p1", title: "hello" }]);
		expect(topLevelSent).toHaveLength(1);
	});

	it("still requires a database-sourced contract to name its source -- the compile-time guard the union exists for", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ id: "p1", title: "hello" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, {
			source: "database",
			database: "widgets_db",
			schemas: ["app"],
			roles: [],
			tables: TABLES,
			functions: {},
		});

		expect(client.posts).toBeDefined();
	});

	/**
	 * The negative control the lead required (CI-G5-R1-03): a
	 * database-sourced contract carrying a `commit` is rejected outright,
	 * not silently widened -- the whole reason `source` discriminates a
	 * union instead of every field just being optional on one shape.
	 * `@ts-expect-error` is this package's own established idiom for
	 * "must fail to compile" (`test/types/*.test.ts`'s own convention,
	 * checked by the same `tsc --noEmit` this repo already gates on --
	 * never a spawned second `tsc` process, which is `examples/cli-smoke`'s
	 * own answer to a different problem, an external consumer's package
	 * resolution, not this package's own internal type shape).
	 */
	it("rejects a database-sourced contract that also names a commit", () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		createNameKeyedDb<TestDatabase>(driver, {
			source: "database",
			database: "widgets_db",
			schemas: ["app"],
			// @ts-expect-error a database-sourced contract has no commit field.
			commit: "abc123",
			roles: [],
			tables: TABLES,
			functions: {},
		});
	});
});

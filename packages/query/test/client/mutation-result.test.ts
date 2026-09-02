import { eq } from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
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

/**
 * #654: a bare `insert()`/`update()`/`delete()` sends no `RETURNING`
 * clause, so it always resolves an empty array — the client's own type
 * SHALL say so, never the table's row type it does not deliver. Four
 * type observers, not three: the requirement names `insert`/`update`/
 * `delete`, and `.where()` is a fourth terminal (`update`/`delete`'s
 * own filterable stage) that could silently keep the old row-typed
 * shape while the three bare calls above it were fixed — one observer
 * per terminal, so none of them is an unobserved SHALL. The observer is
 * `pnpm check-types`, not vitest (which strips types before running).
 */
describe("a bare vendored mutation resolves to no rows, and says so in its type (#654)", () => {
	it("insert(): Awaited type is exactly ReadonlyArray<never>", () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		expectTypeOf<
			Awaited<ReturnType<typeof client.posts.insert>>
		>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("update(): Awaited type is exactly ReadonlyArray<never>", () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const chain = client.posts.update({ title: "renamed" });

		expectTypeOf<Awaited<typeof chain>>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("delete(): Awaited type is exactly ReadonlyArray<never>", () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const chain = client.posts.delete();

		expectTypeOf<Awaited<typeof chain>>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("update().where(): the filterable terminal's own Awaited type is exactly ReadonlyArray<never>", () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const chain = client.posts
			.update({ title: "renamed" })
			.where(eq(client.posts.columns.id, "p1"));

		expectTypeOf<Awaited<typeof chain>>().toEqualTypeOf<ReadonlyArray<never>>();
	});

	it("insert() resolves to [] at runtime, with no RETURNING clause sent", async () => {
		// A real driver hands back no rows for a statement with no
		// `RETURNING` clause -- `rows: []` here stands in for that, not for
		// "this fixture happens to have nothing configured" (contrast
		// `write.test.ts`'s own fixture, which configures non-empty rows
		// only because the recording driver -- unlike a real one -- doesn't
		// vary its response by the compiled SQL's own shape).
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const rows = await client.posts.insert({ title: "hello" });

		expect(rows).toEqual([]);
		expect(topLevelSent[0]?.sql.toLowerCase()).not.toContain("returning");
	});

	it("update() compiles with no RETURNING clause", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const { sql } = client.posts.update({ title: "renamed" }).compile();

		expect(sql.toLowerCase()).not.toContain("returning");
	});

	it("delete() compiles with no RETURNING clause", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const { sql } = client.posts.delete().compile();

		expect(sql.toLowerCase()).not.toContain("returning");
	});
});

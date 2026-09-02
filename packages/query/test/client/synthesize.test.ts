import {
	emptySnapshot,
	generateMigration,
	getTableMeta,
	HejbroError,
	isTable,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractTableMeta } from "../../src/client/contract-types";
import { synthesizeTable } from "../../src/client/synthesize";

const POSTS_META: ContractTableMeta = {
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
};

describe("synthesizeTable (R2-G6 6.1)", () => {
	it("builds a real, recognizable Table value", () => {
		const posts = synthesizeTable(POSTS_META);

		expect(isTable(posts)).toBe(true);
		const meta = getTableMeta(posts);
		expect(meta.schema.schemaName).toBe("app");
		expect(meta.tableName).toBe("posts");
		expect(meta.columns.map((column) => column.columnName)).toEqual([
			"id",
			"title",
		]);
	});

	it("exposes every column as a top-level ref, keyed by its TS key", () => {
		const posts = synthesizeTable(POSTS_META);

		expect((posts as unknown as { id: unknown }).id).toBeDefined();
		expect((posts as unknown as { title: unknown }).title).toBeDefined();
	});

	// Planner condition ③: a query-time-only reconstruction must not become
	// a second way to author a migration -- distinct from R2-G5 5.12's own
	// loader-level refusal (a different layer: that one refuses a file as
	// a *declaration entry point*; this one refuses the *value itself* at
	// the migration engine, the same chokepoint `existingTable()`'s own
	// values already go through).
	it("is refused by generateMigration, the same way existingTable() is", () => {
		const posts = synthesizeTable(POSTS_META);

		expect.assertions(2);
		try {
			generateMigration({
				declarations: [posts],
				previousSnapshot: emptySnapshot,
			});
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as InstanceType<typeof HejbroError>).code).toBe(
				"existing-table-declared",
			);
		}
	});
});

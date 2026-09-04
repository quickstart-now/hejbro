import type { DeclaredTable, HejbroInput } from "@hejbro/core";
import {
	emptySnapshot,
	generateMigration,
	getTableMeta,
	HejbroError,
	isTable,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type {
	ContractColumnEntry,
	ContractTableMeta,
} from "../../src/client/contract-types";
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
	// the migration engine). Pinned at two layers (add-unmanaged-objects,
	// J3): `authority: "usage"` (not `existing`) is the discriminator, so
	// this is now the SAME chokepoint `HejbroInput`'s own type narrowing
	// and `resolveTableDeclarations`'s `"usage"` guard already apply to any
	// synced/vendored table value, not a second one of its own.
	it("is rejected by HejbroInput's own type, not just at runtime (type pin — evidence is check-types, not vitest; mirrors core/test/types/declared-table.test.ts's own usage-table pin)", () => {
		const posts = synthesizeTable(POSTS_META);
		// @ts-expect-error a "usage"-authority Table is not a HejbroInput
		const input: HejbroInput = posts;
		expect(input).toBe(posts);
	});

	it('is refused at runtime too, for the caller the type layer never saw (a JS/jiti caller with no compile step, engine/generate.ts\'s own `authority === "usage"` guard)', () => {
		const posts = synthesizeTable(POSTS_META) as unknown as DeclaredTable;

		expect.assertions(2);
		try {
			generateMigration({
				declarations: [posts],
				previousSnapshot: emptySnapshot,
			});
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as InstanceType<typeof HejbroError>).code).toBe(
				"synced-table-declared",
			);
		}
	});

	// D106 R3, #658 (table half): `synced-table-declared`'s own message
	// names both ways to declare a table this repository authors, not
	// just that the value is refused -- a reader who only owns the
	// table's shape needs to see `existingTable()` named as the fix, not
	// just `table()`.
	it("names both table() and existingTable() as the way to author a migration", () => {
		const posts = synthesizeTable(POSTS_META) as unknown as DeclaredTable;

		expect.assertions(1);
		try {
			generateMigration({
				declarations: [posts],
				previousSnapshot: emptySnapshot,
			});
		} catch (error) {
			expect((error as InstanceType<typeof HejbroError>).message).toContain(
				"declare it with table() (if this repository owns its DDL) or existingTable() (if it only owns the table's shape)",
			);
		}
	});

	// #740/D4: every column-name class (an integer-like name, __proto__,
	// constructor, an upper-case name, a name needing quoting) keeps its
	// physical position from a list-shaped columns metadata.
	describe("physical column order (#740)", () => {
		const columnEntry = (
			key: string,
			sqlName: string,
		): ContractColumnEntry => ({
			key,
			sqlName,
			typeNode: { typeName: "text" },
			mode: null,
			notNullElements: false,
		});
		const PhysicalOrder = [
			"id",
			"0",
			"label",
			"2",
			"__proto__",
			"constructor",
			"Zeta",
			"user-id",
		];
		const DocsMeta: ContractTableMeta = {
			schema: "app",
			name: "docs",
			columns: PhysicalOrder.map((key) => columnEntry(key, key)),
			foreignKeys: [],
		};

		it("a list-shaped columns metadata yields the table's columns in list order, integer-like keys included", () => {
			const docs = synthesizeTable(DocsMeta);
			const meta = getTableMeta(docs);
			expect(meta.columns.map((column) => column.columnKey)).toEqual(
				PhysicalOrder,
			);
			expect(meta.columns.map((column) => column.columnName)).toEqual(
				PhysicalOrder,
			);
			// The ref object's own keys -- checked as a set, not by
			// Object.keys() enumeration order: JavaScript itself always lists
			// an integer-like own key ahead of any insertion order, for any
			// object literal or Object.fromEntries result alike (the very
			// constraint #740 exists to route around at the rendered-SQL
			// layer, not something this reconstruction can undo at the JS
			// object level). Physical order is asserted on the declaration's
			// own array above, and again on the rendered statement in
			// select.test.ts.
			const refKeys = Object.keys(docs).filter((key) =>
				PhysicalOrder.includes(key),
			);
			expect(refKeys.sort()).toEqual([...PhysicalOrder].sort());
			PhysicalOrder.forEach((key) => {
				expect((docs as unknown as Record<string, unknown>)[key]).toBeDefined();
			});
		});

		it("the object-keyed map still builds a table, its own JS key order", () => {
			const meta: ContractTableMeta = {
				schema: "app",
				name: "docs",
				columns: {
					title: {
						sqlName: "title",
						typeNode: { typeName: "text" },
						mode: null,
						notNullElements: false,
					},
					id: {
						sqlName: "id",
						typeNode: { typeName: "uuid" },
						mode: null,
						notNullElements: false,
					},
				},
				foreignKeys: [],
			};
			const docs = synthesizeTable(meta);
			const declarationMeta = getTableMeta(docs);
			expect(declarationMeta.columns.map((column) => column.columnKey)).toEqual(
				["title", "id"],
			);
			expect((docs as unknown as { id: unknown }).id).toBeDefined();
			expect((docs as unknown as { title: unknown }).title).toBeDefined();
		});
	});
});

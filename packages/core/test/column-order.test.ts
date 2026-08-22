import { describe, expect, it } from "vitest";
import { getTableMeta } from "../src/dsl/table";
import { emptySnapshot, schema, table, text } from "../src/index";
import {
	applyColumnOrderToQuery,
	applyColumnOrderToSelect,
	computeColumnOrder,
} from "../src/snapshot/column-order";
import type { Snapshot } from "../src/snapshot/snapshot";

const app = schema("app");
const ref = { schemaName: "app", tableName: "projects" };

const parentWith = (columns: ReadonlyArray<string>): Snapshot => ({
	...emptySnapshot,
	objects: {
		"table:app.projects": {
			schema: "app",
			name: "projects",
			columns: columns.map((name) => ({
				name,
				typeNode: { typeName: "text" },
			})),
			indexes: [],
			foreignKeys: [],
		},
	},
});

const declared = (...names: ReadonlyArray<string>) =>
	getTableMeta(
		table(
			app,
			"projects",
			Object.fromEntries(names.map((name) => [name, text()])),
		),
	);

describe("computeColumnOrder", () => {
	it("keeps declaration order for a table absent from the parent", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "title")],
			emptySnapshot,
			[],
		);
		expect(oracle(ref)).toEqual(["id", "title"]);
	});

	it("inherits the parent's order and appends new columns in declaration order", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "title", "description", "level", "archivedAt")],
			parentWith(["id", "title", "archived_at"]),
			[],
		);
		expect(oracle(ref)).toEqual([
			"id",
			"title",
			"archived_at",
			"description",
			"level",
		]);
	});

	it("ignores a reorder of existing columns", () => {
		const oracle = computeColumnOrder(
			[app, declared("archivedAt", "title", "id")],
			parentWith(["id", "title", "archived_at"]),
			[],
		);
		expect(oracle(ref)).toEqual(["id", "title", "archived_at"]);
	});

	it("keeps a renamed column in place", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "name", "archivedAt")],
			parentWith(["id", "title", "archived_at"]),
			[
				{
					target: "column",
					schemaName: "app",
					tableName: "projects",
					oldName: "title",
					newName: "name",
				},
			],
		);
		expect(oracle(ref)).toEqual(["id", "name", "archived_at"]);
	});

	it("looks a renamed table up under its old name", () => {
		const parentTable = parentWith(["id", "title", "archived_at"]).objects[
			"table:app.projects"
		];
		if (parentTable === undefined) {
			throw new Error("unreachable — parentWith always sets this key");
		}
		const oracle = computeColumnOrder(
			[app, declared("id", "title", "archivedAt", "description")],
			{
				...emptySnapshot,
				objects: { "table:app.items": parentTable },
			},
			[
				{
					target: "table",
					schemaName: "app",
					oldName: "items",
					newName: "projects",
				},
			],
		);
		expect(oracle(ref)).toEqual(["id", "title", "archived_at", "description"]);
	});

	it("drops a column that left the declaration and appends it again if it comes back", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "archivedAt", "title")],
			parentWith(["id", "archived_at"]), // "title" was dropped in an earlier migration
			[],
		);
		expect(oracle(ref)).toEqual(["id", "archived_at", "title"]);
	});

	it("returns null for a table it knows nothing about", () => {
		const oracle = computeColumnOrder([app], emptySnapshot, []);
		expect(oracle({ schemaName: "auth", tableName: "users" })).toBeNull();
	});
});

describe("applyColumnOrderTo*", () => {
	const oracle = computeColumnOrder(
		[app, declared("id", "title", "description", "archivedAt")],
		parentWith(["id", "title", "archived_at"]),
		[],
	);
	const allColumns = {
		projectionKind: "allColumns",
		columnNames: ["id", "title", "description", "archived_at"],
	} as const;
	const select = {
		queryKind: "select",
		projection: allColumns,
		from: ref,
		joins: [],
		where: null,
		orderBy: [],
		limit: null,
	} as const;

	it("re-orders an allColumns projection by the oracle", () => {
		expect(applyColumnOrderToSelect(select, oracle).projection).toEqual({
			projectionKind: "allColumns",
			columnNames: ["id", "title", "archived_at", "description"],
		});
	});

	it("leaves a columns projection and an unknown table alone", () => {
		const unknown = {
			...select,
			from: { schemaName: "auth", tableName: "users" },
		};
		expect(applyColumnOrderToSelect(unknown, oracle)).toBe(unknown);
	});

	it("re-orders an allColumns returning on insert/update/delete", () => {
		const update = {
			queryKind: "update",
			table: ref,
			set: [],
			where: null,
			returning: {
				returningKind: "allColumns",
				columnNames: ["id", "title", "description", "archived_at"],
			},
		} as const;
		expect(applyColumnOrderToQuery(update, oracle)).toMatchObject({
			returning: { columnNames: ["id", "title", "archived_at", "description"] },
		});
	});
});

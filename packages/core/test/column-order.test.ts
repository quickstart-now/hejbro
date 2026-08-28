import { describe, expect, it } from "vitest";
import { getTableMeta } from "../src/dsl/table";
import { encodeExprNode } from "../src/expr/codec";
import { emptySnapshot, numeric, schema, sql, table, text } from "../src/index";
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

	// D81 review fix (#277): a `ColumnRenameSpec.tableName` is the table's
	// *old* name, always -- `applyColumnRename` (rename-plan.ts) resolves a
	// same-run table rename through `tableNameByOldKey`, keyed by the old
	// identity, and CLI parsing rejects a column-rename spec spelled
	// against the *new* table name as unknown-rename-target/ambiguous.
	// Measured regression before this fix: v1 items(id,title,archivedAt) ->
	// v2 projects(id,name,archivedAt) with both renames produced
	// ["id","archived_at","name"] (the column rename silently dropped,
	// since the oracle filtered on the new name only) instead of the
	// physically correct ["id","name","archived_at"].
	it("keeps a renamed column in place on a table renamed in the same run", () => {
		const parentTable = parentWith(["id", "title", "archived_at"]).objects[
			"table:app.projects"
		];
		if (parentTable === undefined) {
			throw new Error("unreachable — parentWith always sets this key");
		}
		const oracle = computeColumnOrder(
			[app, declared("id", "name", "archivedAt")],
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
				{
					target: "column",
					schemaName: "app",
					tableName: "items",
					oldName: "title",
					newName: "name",
				},
			],
		);
		expect(oracle(ref)).toEqual(["id", "name", "archived_at"]);
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

// D100: an expression-change rebuild is a real `drop column` + `add column`
// on Postgres, which physically re-appends the column at the end of the
// table -- the oracle must route that column through the newcomer branch,
// not its pre-rebuild position.
describe("computeColumnOrder — expression-change rebuild (D100)", () => {
	const generatedField = (generated: string | undefined) => {
		if (generated === undefined) {
			return {};
		}
		return { generated: encodeExprNode(sql.raw(generated).exprNode) };
	};

	const numericColumn = (generated?: string) => ({
		typeNode: { typeName: "numeric", precision: null, scale: null },
		...generatedField(generated),
	});

	const parentWithGenerated = (
		columns: ReadonlyArray<{
			readonly name: string;
			readonly generated?: string;
		}>,
	): Snapshot => ({
		...emptySnapshot,
		objects: {
			"table:app.projects": {
				schema: "app",
				name: "projects",
				columns: columns.map(({ name, generated }) => ({
					name,
					...numericColumn(generated),
				})),
				indexes: [],
				foreignKeys: [],
			},
		},
	});

	const totalColumn = (expression: string | null) => {
		if (expression === null) {
			return numeric();
		}
		return numeric().generatedAlwaysAs(sql.raw(expression));
	};

	const declaredNumeric = (spec: {
		readonly a: true;
		readonly total: string | null;
		readonly b: true;
	}) =>
		getTableMeta(
			table(app, "projects", {
				a: numeric(),
				total: totalColumn(spec.total),
				b: numeric(),
			}),
		);

	it("moves a rebuilt column (same name, changed expression) to the end", () => {
		const oracle = computeColumnOrder(
			[app, declaredNumeric({ a: true, total: "a * 2", b: true })],
			parentWithGenerated([
				{ name: "a" },
				{ name: "total", generated: "a" },
				{ name: "b" },
			]),
			[],
		);
		expect(oracle(ref)).toEqual(["a", "b", "total"]);
	});

	it("keeps an unchanged generated column in place", () => {
		const oracle = computeColumnOrder(
			[app, declaredNumeric({ a: true, total: "a", b: true })],
			parentWithGenerated([
				{ name: "a" },
				{ name: "total", generated: "a" },
				{ name: "b" },
			]),
			[],
		);
		expect(oracle(ref)).toEqual(["a", "total", "b"]);
	});

	it("keeps a generated-to-plain transition in place -- drop expression is in-place, not a rebuild", () => {
		const oracle = computeColumnOrder(
			[app, declaredNumeric({ a: true, total: null, b: true })],
			parentWithGenerated([
				{ name: "a" },
				{ name: "total", generated: "a" },
				{ name: "b" },
			]),
			[],
		);
		expect(oracle(ref)).toEqual(["a", "total", "b"]);
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
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	} as const;

	it("recurses into both set-op branches, keeping identity when nothing moves (add-set-operations)", () => {
		const setOp = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: select,
			right: select,
			orderBy: [],
			limit: null,
			offset: null,
		} as const;
		const reordered = applyColumnOrderToQuery(setOp, oracle);
		expect(reordered).not.toBe(setOp);
		expect((reordered as typeof setOp).left.projection).toEqual({
			projectionKind: "allColumns",
			columnNames: ["id", "title", "archived_at", "description"],
		});
		// branches over a table the oracle doesn't know stay untouched --
		// and the set-op node itself keeps reference identity.
		const unknownSelect = {
			...select,
			from: { schemaName: "app", tableName: "unknown" },
		} as const;
		const inertSetOp = {
			...setOp,
			left: unknownSelect,
			right: unknownSelect,
		} as const;
		expect(applyColumnOrderToQuery(inertSetOp, oracle)).toBe(inertSetOp);
	});

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

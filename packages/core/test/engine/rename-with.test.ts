import { describe, expect, it } from "vitest";
import { retargetViewFields } from "../../src/engine/rename/retarget";
import type { SelectNode, WithNode } from "../../src/expr/ast";
import { encodeWithNode } from "../../src/expr/codec";
import type { RenameTarget } from "../../src/expr/retarget";
import type { ViewSnapshot } from "../../src/kinds/view-kind";
import { viewSelectSql } from "../../src/kinds/view-kind";

const columnRenameTarget: RenameTarget = {
	oldSchema: "app",
	oldTable: "posts",
	newSchema: "app",
	newTable: "posts",
	oldColumn: "title",
	newColumn: "headline",
};

const anchor: SelectNode = {
	queryKind: "select",
	projection: { projectionKind: "constantOne" },
	from: { schemaName: "app", tableName: "posts" },
	joins: [],
	where: null,
	groupBy: [],
	having: null,
	orderBy: [],
	limit: null,
	offset: null,
	distinct: null,
};

describe("retargetViewFields descends through a stored view's WITH wrapper (add-ctes task 4.3)", () => {
	it("a rename rewrites a column referenced only inside a stored view's CTE body", () => {
		const entryQuery: SelectNode = {
			...anchor,
			where: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "title",
			},
		};
		const node: WithNode = {
			queryKind: "with",
			ctes: [{ name: "ranked", query: entryQuery, materialized: null }],
			recursive: false,
			body: {
				...anchor,
				from: { cteName: "ranked" },
				projection: {
					projectionKind: "columns",
					columns: [
						{
							alias: "id",
							expr: {
								nodeKind: "columnRef",
								schemaName: null,
								tableName: "ranked",
								columnName: "id",
							},
						},
					],
				},
			},
		};
		const snapshot: ViewSnapshot = {
			schema: "app",
			name: "ranked_posts",
			columns: ["id"],
			query: encodeWithNode(node),
		};

		const retargeted = retargetViewFields(snapshot, columnRenameTarget);

		expect(retargeted).not.toBeNull();
		expect(viewSelectSql(retargeted as ViewSnapshot)).toContain(
			'"app"."posts"."headline"',
		);
		expect(viewSelectSql(retargeted as ViewSnapshot)).not.toContain(
			'"app"."posts"."title"',
		);
	});

	it("leaves a view alone when the rename target doesn't reach its CTE body at all", () => {
		const entryQuery: SelectNode = {
			...anchor,
			where: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "status",
			},
		};
		const node: WithNode = {
			queryKind: "with",
			ctes: [{ name: "ranked", query: entryQuery, materialized: null }],
			recursive: false,
			body: { ...anchor, from: { cteName: "ranked" } },
		};
		const snapshot: ViewSnapshot = {
			schema: "app",
			name: "ranked_posts",
			columns: [],
			query: encodeWithNode(node),
		};

		expect(retargetViewFields(snapshot, columnRenameTarget)).toBeNull();
	});
});

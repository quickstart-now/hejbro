import { describe, expect, it } from "vitest";
import type { ExprNode, SelectNode } from "../../src/index";
import { renderExpr, renderTableBoundExpr } from "../../src/index";

const projectsTable = { schemaName: "app", tableName: "projects" };
const tasksTable = { schemaName: "app", tableName: "tasks" };
const auditTasksTable = { schemaName: "audit", tableName: "tasks" };

const projectsName: ExprNode = {
	nodeKind: "columnRef",
	schemaName: "app",
	tableName: "projects",
	columnName: "name",
};

const cteColumnRef: ExprNode = {
	nodeKind: "columnRef",
	schemaName: null,
	tableName: "active_projects",
	columnName: "name",
};

/** The spec's own correlated-subquery scenario: a policy on `app.tasks` reading `exists (select 1 from app.projects where projects.id = tasks.project_id and projects.archived_at is null)`. */
const correlatedExists: ExprNode = {
	nodeKind: "exists",
	negated: false,
	query: {
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: projectsTable,
		joins: [],
		where: {
			nodeKind: "logical",
			operator: "and",
			operands: [
				{
					nodeKind: "comparison",
					operator: "=",
					left: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "projects",
						columnName: "id",
					},
					right: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "tasks",
						columnName: "project_id",
					},
				},
				{
					nodeKind: "nullTest",
					negated: false,
					operand: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "projects",
						columnName: "archived_at",
					},
				},
			],
		},
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	} satisfies SelectNode,
};

/** The spec's own ambiguity scenario: a policy on `app.tasks` whose subquery `from` names `audit.tasks` — a bare-name collision under a different schema. */
const ambiguousBareNameExists: ExprNode = {
	nodeKind: "exists",
	negated: false,
	query: {
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: auditTasksTable,
		joins: [],
		where: {
			nodeKind: "comparison",
			operator: "=",
			left: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "tasks",
				columnName: "id",
			},
			right: {
				nodeKind: "columnRef",
				schemaName: "audit",
				tableName: "tasks",
				columnName: "task_id",
			},
		},
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	} satisfies SelectNode,
};

const sqlTemplateWithRef: ExprNode = {
	nodeKind: "sqlTemplate",
	chunks: [
		{ chunkKind: "text", text: "char_length(" },
		{ chunkKind: "expr", expr: projectsName },
		{ chunkKind: "text", text: ") > 3" },
	],
};

describe("renderTableBoundExpr (fix-nile-findings task 1.1)", () => {
	it("renders a top-level column reference two-part", () => {
		expect(renderTableBoundExpr(projectsName, [projectsTable])).toBe(
			'"projects"."name"',
		);
	});

	it("renders a column reference inside a sql template chunk two-part", () => {
		expect(renderTableBoundExpr(sqlTemplateWithRef, [projectsTable])).toBe(
			'char_length("projects"."name") > 3',
		);
	});

	it("renders a CTE column reference unchanged (schemaName === null is untouched)", () => {
		expect(renderTableBoundExpr(cteColumnRef)).toBe('"active_projects"."name"');
	});

	it("renders both the outer table's and the subquery's own table's column references two-part inside a correlated exists(), while the subquery's from target stays three-part", () => {
		expect(renderTableBoundExpr(correlatedExists, [tasksTable])).toBe(
			'exists (select 1 from "app"."projects" where ("projects"."id" = "tasks"."project_id") and ("projects"."archived_at" is null))',
		);
	});

	it("renders both references three-part when a subquery's from names a same-bare-name table under another schema", () => {
		expect(renderTableBoundExpr(ambiguousBareNameExists, [tasksTable])).toBe(
			'exists (select 1 from "audit"."tasks" where "app"."tasks"."id" = "audit"."tasks"."task_id")',
		);
	});
});

describe("renderExpr (plain, table-bound-unaffected — a view body renders exactly as before)", () => {
	it("renders the same nodes schema-qualified, three-part, without the table-bound marker", () => {
		expect(renderExpr(projectsName, [projectsTable])).toBe(
			'"app"."projects"."name"',
		);
		expect(renderExpr(sqlTemplateWithRef, [projectsTable])).toBe(
			'char_length("app"."projects"."name") > 3',
		);
		expect(renderExpr(cteColumnRef)).toBe('"active_projects"."name"');
		expect(renderExpr(correlatedExists, [tasksTable])).toBe(
			'exists (select 1 from "app"."projects" where ("app"."projects"."id" = "app"."tasks"."project_id") and ("app"."projects"."archived_at" is null))',
		);
		expect(renderExpr(ambiguousBareNameExists, [tasksTable])).toBe(
			'exists (select 1 from "audit"."tasks" where "app"."tasks"."id" = "audit"."tasks"."task_id")',
		);
	});
});

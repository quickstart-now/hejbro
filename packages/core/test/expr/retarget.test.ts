import { describe, expect, it } from "vitest";
import type {
	ExprNode,
	SelectNode,
	SetOpNode,
	WithNode,
} from "../../src/expr/ast";
import type { RenameTarget } from "../../src/expr/retarget";
import {
	retargetExprNode,
	retargetSelectNode,
	retargetSetOpNode,
	retargetWithNode,
} from "../../src/expr/retarget";
import { buildUnrelatedCase, REACHABLE_NODE_KINDS } from "./reachable-kinds";

const tableRenameTarget: RenameTarget = {
	oldSchema: "app",
	oldTable: "posts",
	newSchema: "app",
	newTable: "articles",
	oldColumn: null,
	newColumn: null,
};

const columnRenameTarget: RenameTarget = {
	oldSchema: "app",
	oldTable: "posts",
	newSchema: "app",
	newTable: "posts",
	oldColumn: "title",
	newColumn: "headline",
};

describe("retargetExprNode (#110 item 7/18: rename retargeting)", () => {
	it("retargets a direct columnRef on a table rename", () => {
		const node: ExprNode = {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "id",
		};
		expect(retargetExprNode(node, tableRenameTarget)).toEqual({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "articles",
			columnName: "id",
		});
	});

	it("retargets only the matching column on a column rename, leaving other columns alone", () => {
		const node: ExprNode = {
			nodeKind: "comparison",
			operator: "=",
			left: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "title",
			},
			right: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "subtitle",
			},
		};
		expect(retargetExprNode(node, columnRenameTarget)).toEqual({
			nodeKind: "comparison",
			operator: "=",
			left: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "headline",
			},
			right: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "subtitle",
			},
		});
	});

	it("leaves an unrelated table's columnRef untouched", () => {
		const node: ExprNode = {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "comments",
			columnName: "id",
		};
		expect(retargetExprNode(node, tableRenameTarget)).toBe(node);
	});

	// #110 item 23/24, reviewer round 2/3: on a COLUMN rename
	// (oldSchema===newSchema, oldTable===newTable), EVERY reference-bearing
	// node kind that mentions the same table but is otherwise unaffected
	// must come back as the exact SAME reference -- schema/table matching
	// the rename target is not enough on its own to mean "this node
	// changed" (a table rename always changes schema/table, so reaching a
	// match branch there always means something changed; a column rename
	// does not have that property).
	//
	// This was fixed twice, for two DIFFERENT node kinds, because the
	// first test (a bare `columnRef` case) only exercised
	// `retargetExprNode`'s own `columnRef` branch and never
	// `retargetTableRef` -- a structurally different function, reached
	// only through `exists()`'s `from`/`join`, with its own separate (and
	// separately buggy) copy of the same comparison. Round 2's fix
	// ("add one more case for the gap that was just found") was *itself*
	// the same narrow-test pattern that caused the miss in the first
	// place, one level up -- adding cases one at a time as gaps are found
	// doesn't make the next gap visible.
	//
	// This is why the loop below iterates `REACHABLE_NODE_KINDS`
	// (`reachable-kinds.ts`) rather than a hand-picked list living only in
	// this file: it's the SAME array the D70 completeness test in
	// `naming-conventions.test.ts` iterates (#110 item 72) -- a future
	// `ExprNode` kind added to the codec's map lands in both tests'
	// coverage automatically, or requires an explicit, reasoned exclusion
	// visible in one shared place, not a silent gap in whichever test
	// nobody happened to update.
	//
	// `buildUnrelatedCase` (moved to `reachable-kinds.ts` in #157, item 96
	// — the same shared source this loop and #157's own `retargetSelectNode`
	// loop both use, so a new node kind can't be added to one without the
	// other) is an exhaustive switch over the full `ExprNode["nodeKind"]`
	// union (compiler-enforced via `assertNever`), so a new node kind
	// fails to compile there until it's given a case -- every builder
	// constructs a minimal, valid node of that kind that does NOT
	// reference `columnRenameTarget`'s column anywhere in its subtree
	// (some wrap `unrelatedColumnRef`, a column on the same table but a
	// different column, to also exercise composite nodes' own
	// identity-preservation branches, not just their leaves). `exists`
	// alone covers BOTH `retargetTableRef` call sites at once (`query.from`
	// and `join.table`), matching the same table as the rename target on
	// both, since that's precisely the shape that was broken.
	it.each(
		REACHABLE_NODE_KINDS.map(
			(kind) => [kind, buildUnrelatedCase(kind)] as const,
		),
	)(
		"returns the exact same reference on an unrelated column rename: %s",
		(_kind, node) => {
			expect(retargetExprNode(node, columnRenameTarget)).toBe(node);
		},
	);

	it("retargets a columnRef nested arbitrarily deep (logical/not/inList/between/functionCall/sqlTemplate)", () => {
		const ref: ExprNode = {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "status",
		};
		const node: ExprNode = {
			nodeKind: "logical",
			operator: "and",
			operands: [
				{ nodeKind: "not", operand: { ...ref } },
				{
					nodeKind: "inList",
					negated: false,
					operand: { ...ref },
					values: [
						{
							nodeKind: "literal",
							literal: { literalKind: "string", value: "x" },
						},
					],
				},
				{
					nodeKind: "between",
					negated: false,
					operand: { ...ref },
					lowerBound: {
						nodeKind: "literal",
						literal: { literalKind: "number", value: 0 },
					},
					upperBound: {
						nodeKind: "literal",
						literal: { literalKind: "number", value: 1 },
					},
				},
				{
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "lower",
					args: [{ ...ref }],
				},
				{
					nodeKind: "sqlTemplate",
					chunks: [
						{ chunkKind: "text", text: "(" },
						{ chunkKind: "expr", expr: { ...ref } },
						{ chunkKind: "text", text: ")" },
					],
				},
			],
		};
		const retargeted = retargetExprNode(node, tableRenameTarget);
		// every columnRef nested inside not/inList/between/functionCall/
		// sqlTemplate followed the rename -- no "posts" survives anywhere
		// in the tree, and "articles" appears once per nested ref (5).
		const serialized = JSON.stringify(retargeted);
		expect(serialized).not.toContain('"posts"');
		expect(serialized.match(/"articles"/g)).toHaveLength(5);
	});

	// add-aggregate-filter task 1.3 (#501/R2): a filtered aggregate's
	// condition is a sibling ExprNode -- retargetExprNode's generic
	// fallback (exprChildren/replaceExprChildren) already recurses through
	// it once expr-children.ts's own aggregateFilter entry (task 1.2)
	// yields [fn, where]; this test proves BOTH positions retarget, not
	// just structural identity-preservation the REACHABLE_NODE_KINDS loop
	// above already covers.
	it("retargets a columnRef inside a filtered aggregate's condition, and inside its own argument", () => {
		const node: ExprNode = {
			nodeKind: "aggregateFilter",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "sum",
				args: [
					{
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "posts",
						columnName: "id",
					},
				],
			},
			where: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "id",
			},
		};
		expect(retargetExprNode(node, tableRenameTarget)).toEqual({
			nodeKind: "aggregateFilter",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "sum",
				args: [
					{
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "articles",
						columnName: "id",
					},
				],
			},
			where: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "articles",
				columnName: "id",
			},
		});
	});

	it("retargets a columnRef inside an exists() subquery's where/join/orderBy, and the subquery's own from/join table refs", () => {
		const node: ExprNode = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constantOne" },
				from: { schemaName: "app", tableName: "posts" },
				joins: [
					{
						joinKind: "inner",
						table: { schemaName: "app", tableName: "authors" },
						on: {
							nodeKind: "comparison",
							operator: "=",
							left: {
								nodeKind: "columnRef",
								schemaName: "app",
								tableName: "posts",
								columnName: "author_id",
							},
							right: {
								nodeKind: "columnRef",
								schemaName: "app",
								tableName: "authors",
								columnName: "id",
							},
						},
					},
				],
				where: {
					nodeKind: "comparison",
					operator: "=",
					left: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "posts",
						columnName: "id",
					},
					right: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "comments",
						columnName: "post_id",
					},
				},
				orderBy: [
					{
						expr: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "posts",
							columnName: "created_at",
						},
						direction: "desc",
					},
				],
				limit: 1,
				offset: null,
				groupBy: [],
				having: null,
				distinct: null,
			},
		};
		const retargeted = retargetExprNode(node, tableRenameTarget);
		const serialized = JSON.stringify(retargeted);
		// every "posts" reference became "articles" -- the from ref, the
		// join's on-clause left side, the where clause, and the orderBy term
		expect(serialized).not.toContain('"posts"');
		// unrelated tables (authors, comments) are untouched
		expect(serialized).toContain('"authors"');
		expect(serialized).toContain('"comments"');
	});

	it("returns the exact same reference when nothing matches (cheap no-op check)", () => {
		const node: ExprNode = {
			nodeKind: "literal",
			literal: { literalKind: "boolean", value: true },
		};
		expect(retargetExprNode(node, tableRenameTarget)).toBe(node);
	});
});

// add-window-functions task 1.5: the exhaustive registries force a handler
// to be WRITTEN, not to DESCEND -- `window: (node) => node` compiles and
// passes the it.each unrelated-rename loop above just as well as a real
// descent would. This is the hand-written positive-descent proof the
// registries can't provide on their own.
describe("retargetExprNode window descent (#416/D104 task 1.5)", () => {
	const buildWindow = (partitionBy: ReadonlyArray<ExprNode>): ExprNode => ({
		nodeKind: "window",
		fn: {
			nodeKind: "functionCall",
			schemaName: null,
			functionName: "rank",
			args: [],
		},
		partitionBy,
		orderBy: [],
	});

	it("a column referenced only inside over()'s partitionBy is rewritten by a rename", () => {
		const node = buildWindow([
			{
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "title",
			},
		]);
		expect(retargetExprNode(node, columnRenameTarget)).toEqual(
			buildWindow([
				{
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "headline",
				},
			]),
		);
	});

	it("a column referenced only inside over()'s orderBy is rewritten by a rename", () => {
		const buildOrderedWindow = (columnName: string): ExprNode => ({
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "rank",
				args: [],
			},
			partitionBy: [],
			orderBy: [
				{
					expr: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "posts",
						columnName,
					},
					direction: "asc",
				},
			],
		});
		expect(
			retargetExprNode(buildOrderedWindow("title"), columnRenameTarget),
		).toEqual(buildOrderedWindow("headline"));
	});

	it("a column referenced only inside the windowed function's own argument is rewritten by a rename", () => {
		const node: ExprNode = {
			nodeKind: "window",
			fn: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "sum",
				args: [
					{
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "posts",
						columnName: "title",
					},
				],
			},
			partitionBy: [],
			orderBy: [],
		};
		const retargeted = retargetExprNode(node, columnRenameTarget);
		expect(JSON.stringify(retargeted)).toContain('"headline"');
		expect(JSON.stringify(retargeted)).not.toContain('"title"');
	});
});

// #157/D72, item 96: `retargetSelectNode` was previously reachable only
// through `retargetExists` (nested inside an `ExprNode`); #157 exports it
// so `rename-plan.ts` can retarget a view's own top-level query
// (`retargetSelectField`/`retargetViewFields`) the same way. A newly
// top-level-reachable function is new code with a new blind spot, even
// though its own body is unchanged -- #110's `retargetTableRef` bug was
// exactly this shape (a function reached through a different call site
// than the one the original test covered), found three times before the
// fix stopped being "add one more case". This loop applies the same
// REACHABLE_NODE_KINDS-sourced, one-case-per-kind discipline to
// `retargetSelectNode` itself, directly, rather than trusting that
// `retargetExprNode`'s own loop (above) is enough by inference.
describe("retargetSelectNode (#157 item 96: same identity-preservation discipline, at its own newly-top-level entry point)", () => {
	const buildQuery = (whereClause: ExprNode | null): SelectNode => ({
		queryKind: "select",
		projection: { projectionKind: "allColumns", columnNames: ["id"] },
		from: { schemaName: "app", tableName: "posts" },
		joins: [],
		where: whereClause,
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	});

	it.each(REACHABLE_NODE_KINDS)(
		"returns the exact same reference on an unrelated column rename when where is: %s",
		(kind) => {
			const query = buildQuery(buildUnrelatedCase(kind));
			const retargeted = retargetSelectNode(query, columnRenameTarget);
			expect(retargeted).toBe(query);
			expect(retargeted.where).toBe(query.where);
		},
	);

	// #154 ratchet-5: every buildQuery() above sets orderBy: [], so an
	// unrelated-rename query never reaches the identity-preservation check
	// with a non-empty orderBy term to compare -- this is the one case
	// that does.
	it("returns the exact same reference on an unrelated column rename with a populated, unrelated orderBy term", () => {
		const query: SelectNode = {
			...buildQuery(null),
			orderBy: [
				{
					expr: {
						nodeKind: "columnRef",
						schemaName: "app",
						tableName: "posts",
						columnName: "id",
					},
					direction: "asc",
				},
			],
		};
		const retargeted = retargetSelectNode(query, columnRenameTarget);
		expect(retargeted).toBe(query);
		expect(retargeted.orderBy).toBe(query.orderBy);
	});

	it("retargets a view-shaped query's from/where when the rename actually matches", () => {
		const query = buildQuery({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "id",
		});
		const retargeted = retargetSelectNode(query, tableRenameTarget);
		expect(retargeted).toEqual({
			...query,
			from: { schemaName: "app", tableName: "articles" },
			where: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "articles",
				columnName: "id",
			},
		});
	});
});

// A `"columns"` projection (an explicit column list, e.g. `defineView`'s
// own selected/aliased expressions) is a wholly separate ProjectionNode
// variant from the `"allColumns"` shape every other retargetSelectNode
// test above builds -- unreached by any of them, and by nothing else in
// this file either, until now (0% coverage on this branch specifically,
// #154 PR4's own retargetColumnsProjection extraction).
describe('retargetSelectNode with a "columns" projection (defineView\'s own column list)', () => {
	const buildColumnsQuery = (
		columns: ReadonlyArray<{ readonly alias: string; readonly expr: ExprNode }>,
	): SelectNode => ({
		queryKind: "select",
		projection: { projectionKind: "columns", columns },
		from: { schemaName: "app", tableName: "posts" },
		joins: [],
		where: null,
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	});

	it("retargets the matching column's own expr, leaving an unrelated column entry's reference untouched", () => {
		const untouched = {
			alias: "id",
			expr: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "id",
			} as ExprNode,
		};
		const renamed = {
			alias: "title",
			expr: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "title",
			} as ExprNode,
		};
		const query = buildColumnsQuery([untouched, renamed]);
		const retargeted = retargetSelectNode(query, columnRenameTarget);
		expect(retargeted).not.toBe(query);
		if (retargeted.projection.projectionKind !== "columns") {
			throw new Error("expected a columns projection");
		}
		expect(retargeted.projection.columns[0]).toBe(untouched);
		expect(retargeted.projection.columns[1]).toEqual({
			alias: "title",
			expr: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "headline",
			},
		});
	});

	it("returns the exact same reference when no column entry's expr matches the rename", () => {
		const query = buildColumnsQuery([
			{
				alias: "id",
				expr: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "id",
				},
			},
		]);
		const retargeted = retargetSelectNode(query, columnRenameTarget);
		expect(retargeted).toBe(query);
	});
});

// #444 F3: retargetSelectNode used to hand-list projection/from/joins/
// where/orderBy only, missing groupBy/having/distinct on -- a rename left
// stale identifiers behind in those three clauses.
describe("retargetSelectNode groupBy/having/distinctOn (#444 F3)", () => {
	const renamedRef: ExprNode = {
		nodeKind: "columnRef",
		schemaName: "app",
		tableName: "posts",
		columnName: "title",
	};
	const buildQuery = (fields: {
		readonly groupBy?: ReadonlyArray<ExprNode>;
		readonly having?: ExprNode | null;
		readonly distinct?: SelectNode["distinct"];
	}): SelectNode => ({
		queryKind: "select",
		projection: { projectionKind: "allColumns", columnNames: ["id"] },
		from: { schemaName: "app", tableName: "posts" },
		joins: [],
		where: null,
		groupBy: fields.groupBy ?? [],
		having: fields.having ?? null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: fields.distinct ?? null,
	});

	it("retargets a column reference inside groupBy/having/distinctOn", () => {
		const query = buildQuery({
			groupBy: [renamedRef],
			having: renamedRef,
			distinct: { distinctKind: "on", columns: [renamedRef] },
		});
		const retargeted = retargetSelectNode(query, columnRenameTarget);
		const renamed: ExprNode = { ...renamedRef, columnName: "headline" };
		expect(retargeted.groupBy).toEqual([renamed]);
		expect(retargeted.having).toEqual(renamed);
		expect(retargeted.distinct).toEqual({
			distinctKind: "on",
			columns: [renamed],
		});
	});

	it("returns the exact same reference when groupBy/having/distinctOn mention no renamed column", () => {
		const unrelated: ExprNode = {
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "id",
		};
		const query = buildQuery({
			groupBy: [unrelated],
			having: unrelated,
			distinct: { distinctKind: "on", columns: [unrelated] },
		});
		const retargeted = retargetSelectNode(query, columnRenameTarget);
		expect(retargeted).toBe(query);
		expect(retargeted.groupBy).toBe(query.groupBy);
		expect(retargeted.having).toBe(query.having);
		expect(retargeted.distinct).toBe(query.distinct);
	});
});

describe("set-op retarget (add-set-operations task 1.4)", () => {
	it("retargets both branches and returns the same reference when unrelated", () => {
		const base: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: {
				queryKind: "select",
				projection: { projectionKind: "allColumns", columnNames: ["id"] },
				from: { schemaName: "app", tableName: "posts" },
				joins: [],
				where: null,
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
			right: {
				queryKind: "select",
				projection: { projectionKind: "allColumns", columnNames: ["id"] },
				from: { schemaName: "app", tableName: "others" },
				joins: [],
				where: null,
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
			orderBy: [],
			limit: null,
			offset: null,
		};
		const renamed = retargetSetOpNode(base, {
			oldSchema: "app",
			oldTable: "posts",
			newSchema: "app",
			newTable: "entries",
			oldColumn: null,
			newColumn: null,
		});
		expect(JSON.stringify(renamed)).toContain('"entries"');
		expect(JSON.stringify(renamed)).not.toContain('"posts"');
		const untouched = retargetSetOpNode(base, {
			oldSchema: "app",
			oldTable: "elsewhere",
			newSchema: "app",
			newTable: "nowhere",
			oldColumn: null,
			newColumn: null,
		});
		expect(untouched).toBe(base);
	});
});

describe("set-op right-branch rename (review F5)", () => {
	it("a rename touching only the right branch retargets it", () => {
		const leaf = (tableName: string): SelectNode => ({
			queryKind: "select",
			projection: { projectionKind: "allColumns", columnNames: ["id"] },
			from: { schemaName: "app", tableName },
			joins: [],
			where: null,
			groupBy: [],
			having: null,
			orderBy: [],
			limit: null,
			offset: null,
			distinct: null,
		});
		const node: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: leaf("keepers"),
			right: leaf("movers"),
			orderBy: [],
			limit: null,
			offset: null,
		};
		const renamed = retargetSetOpNode(node, {
			oldSchema: "app",
			oldTable: "movers",
			newSchema: "app",
			newTable: "settlers",
			oldColumn: null,
			newColumn: null,
		});
		expect(renamed).not.toBe(node);
		expect(JSON.stringify(renamed.right)).toContain('"settlers"');
		expect(JSON.stringify(renamed.left)).toContain('"keepers"');
	});
});

describe("retargetWithNode (add-ctes tasks 2.2/2.3/2.4)", () => {
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

	// task 2.3, positive descent proof: the registry forces retargetWithNode
	// to be *written*, not to *descend* -- `with: (node) => node` would
	// compile and pass every reference-identity check just as well as this
	// does. Only a rewritten column, reached through an entry's own body
	// (never touched by the top-level identifier-only pass), proves it
	// actually walks in.
	it("a column referenced only inside a CTE body is rewritten by a rename", () => {
		const entryQuery: SelectNode = {
			...anchor,
			where: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "id",
			},
		};
		const node: WithNode = {
			queryKind: "with",
			ctes: [{ name: "recent", query: entryQuery, materialized: null }],
			recursive: false,
			body: anchor,
		};
		const retargeted = retargetWithNode(node, tableRenameTarget);
		expect(retargeted).not.toBe(node);
		const retargetedEntryQuery = retargeted.ctes[0]?.query;
		expect(retargetedEntryQuery?.queryKind).toBe("select");
		expect((retargetedEntryQuery as SelectNode | undefined)?.where).toEqual({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "articles",
			columnName: "id",
		});
	});

	// task 2.4, the negative pin -- the sentinel-schema hazard D105 rejected
	// an alternative over: a rename identifies its target by schema and
	// table together, and a CTE has neither, so a same-named CTE (and its
	// own column references) must be left exactly alone.
	it("a table rename leaves a same-named CTE alone", () => {
		const body: SelectNode = {
			...anchor,
			from: { cteName: "posts" },
			projection: {
				projectionKind: "columns",
				columns: [
					{
						alias: "id",
						expr: {
							nodeKind: "columnRef",
							schemaName: null,
							tableName: "posts",
							columnName: "id",
						},
					},
				],
			},
		};
		const node: WithNode = {
			queryKind: "with",
			ctes: [{ name: "posts", query: anchor, materialized: null }],
			recursive: false,
			body,
		};
		const retargeted = retargetWithNode(node, tableRenameTarget);
		expect(retargeted.body).toBe(body);
		expect(retargeted.body).toEqual(body);
	});

	it("returns the exact same reference when nothing in the list or body matches", () => {
		const node: WithNode = {
			queryKind: "with",
			ctes: [{ name: "recent", query: anchor, materialized: null }],
			recursive: false,
			body: anchor,
		};
		expect(retargetWithNode(node, columnRenameTarget)).toBe(node);
	});
});

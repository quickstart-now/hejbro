import { describe, expect, it } from "vitest";
import type { ExprNode, SelectNode } from "../../src/expr/ast";
import {
	replaceSelectChildExprs,
	SELECT_CLAUSE_TRAVERSALS,
	selectChildExprs,
} from "../../src/expr/select-children";

const literal = (value: string): ExprNode => ({
	nodeKind: "literal",
	literal: { literalKind: "string", value },
});

/** A select carrying a distinguishable literal in every clause that can hold one, plus a non-expression `limit`/`offset`/`from` untouched — task 1.1's own red fixture. */
const fullyPopulatedQuery: SelectNode = {
	queryKind: "select",
	distinct: { distinctKind: "on", columns: [literal("distinct")] },
	projection: {
		projectionKind: "columns",
		columns: [{ alias: "p", expr: literal("projection") }],
	},
	from: { schemaName: "app", tableName: "posts" },
	joins: [
		{
			joinKind: "inner",
			table: { schemaName: "app", tableName: "comments" },
			on: literal("join"),
		},
	],
	where: literal("where"),
	groupBy: [literal("groupBy")],
	having: literal("having"),
	orderBy: [{ expr: literal("orderBy"), direction: "asc" }],
	limit: 5,
	offset: 1,
};

describe("selectChildExprs (group 1: one traversal table, keyed by the node itself)", () => {
	it("collects one child expression per clause of a fully populated select, in render order", () => {
		const exprs = selectChildExprs(fullyPopulatedQuery);
		expect(exprs).toEqual([
			literal("distinct"),
			literal("projection"),
			literal("join"),
			literal("where"),
			literal("groupBy"),
			literal("having"),
			literal("orderBy"),
		]);
	});

	it("every SelectNode field has a traversal entry", () => {
		const fieldsOnANode = new Set(Object.keys(fullyPopulatedQuery));
		const fieldsInTheTable = new Set(Object.keys(SELECT_CLAUSE_TRAVERSALS));
		expect(fieldsInTheTable).toEqual(fieldsOnANode);
	});

	it("returns nothing for a select with no clause carrying an expression beyond the mandatory from/projection identifiers", () => {
		const bare: SelectNode = {
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
		};
		expect(selectChildExprs(bare)).toEqual([]);
	});
});

describe("replaceSelectChildExprs (round-trip and ratchet proof, task 1.2)", () => {
	it("round-trips: replacing a node's own child exprs with themselves returns an equal node", () => {
		const roundTripped = replaceSelectChildExprs(
			fullyPopulatedQuery,
			selectChildExprs(fullyPopulatedQuery),
		);
		expect(roundTripped).toEqual(fullyPopulatedQuery);
	});

	// task 1.2: a rebuild that turns `distinct: null`/`{ distinctKind: "all" }`
	// into `{ distinctKind: "on", columns: [] }` would silently change the
	// SQL (`select` vs `select distinct` vs `select distinct on ()`) --
	// nothing else in this file's other round-trip case (which only ever
	// builds the "on" state) would catch that.
	it.each([
		["null", null],
		["all", { distinctKind: "all" as const }],
		["on", { distinctKind: "on" as const, columns: [literal("distinct")] }],
	])("round-trips distinct in its %s state", (_label, distinct) => {
		const query: SelectNode = { ...fullyPopulatedQuery, distinct };
		const roundTripped = replaceSelectChildExprs(
			query,
			selectChildExprs(query),
		);
		expect(roundTripped).toEqual(query);
		expect(roundTripped.distinct).toEqual(distinct);
	});

	// `retarget.ts` (task 2.2) depends on this: an unrelated rename must
	// return the exact same `SelectNode` reference, which only holds if
	// replacing a clause's exprs with themselves never allocates a new
	// wrapper for a clause that didn't change.
	it("returns the exact same node reference when every replacement expr is referentially identical to the original", () => {
		const roundTripped = replaceSelectChildExprs(
			fullyPopulatedQuery,
			selectChildExprs(fullyPopulatedQuery),
		);
		expect(roundTripped).toBe(fullyPopulatedQuery);
	});

	it("rebuilds each clause from a same-length replacement list, preserving every non-expression part", () => {
		const exprs = selectChildExprs(fullyPopulatedQuery).map(
			(_expr, index): ExprNode => literal(`replaced-${index}`),
		);
		const rebuilt = replaceSelectChildExprs(fullyPopulatedQuery, exprs);
		expect(rebuilt).toEqual({
			...fullyPopulatedQuery,
			distinct: { distinctKind: "on", columns: [literal("replaced-0")] },
			projection: {
				projectionKind: "columns",
				columns: [{ alias: "p", expr: literal("replaced-1") }],
			},
			joins: [{ ...fullyPopulatedQuery.joins[0], on: literal("replaced-2") }],
			where: literal("replaced-3"),
			groupBy: [literal("replaced-4")],
			having: literal("replaced-5"),
			orderBy: [{ expr: literal("replaced-6"), direction: "asc" }],
		});
	});
});

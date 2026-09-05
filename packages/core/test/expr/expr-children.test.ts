import { describe, expect, it } from "vitest";
import type {
	AggregateFilterNode,
	ExprNode,
	WindowNode,
} from "../../src/expr/ast";
import {
	exprChildren,
	replaceExprChildren,
} from "../../src/expr/expr-children";
import * as CoreIndex from "../../src/index";
import { buildUnrelatedCase, REACHABLE_NODE_KINDS } from "./reachable-kinds";

describe("exprChildren/replaceExprChildren (#473)", () => {
	// Structural, not a hand-written list (tasks.md 2.1): a node kind added
	// to REACHABLE_NODE_KINDS without a matching case here fails
	// automatically, the same protection this file's own header explains
	// retarget.test.ts/naming-conventions.test.ts once lacked.
	REACHABLE_NODE_KINDS.forEach((kind) => {
		it(`${kind}: replacing with its own read-out children round-trips to the same reference`, () => {
			const node = buildUnrelatedCase(kind);
			const children = exprChildren(node);
			expect(replaceExprChildren(node, children)).toBe(node);
		});
	});

	it("window reports its children in render order: fn, then partitionBy, then orderBy's own expressions", () => {
		const node = buildUnrelatedCase("window") as WindowNode;
		const children = exprChildren(node);
		expect(children).toEqual([
			node.fn,
			...node.partitionBy,
			...node.orderBy.map((term) => term.expr),
		]);
	});

	// add-aggregate-filter task 1.2 (#501/R2 Q2): a filtered aggregate's
	// two child positions -- the aggregate call, then its condition -- in
	// the exact order the delta's own scenario names them.
	it("aggregateFilter reports its children in render order: fn, then where", () => {
		const node = buildUnrelatedCase("aggregateFilter") as AggregateFilterNode;
		const children = exprChildren(node);
		expect(children).toEqual([node.fn, node.where]);
	});

	it("sqlTemplate reports only its expr chunks, in chunk order, skipping text chunks", () => {
		const node = buildUnrelatedCase("sqlTemplate");
		if (node.nodeKind !== "sqlTemplate") {
			throw new Error("expected a sqlTemplate node");
		}
		const expected = node.chunks
			.filter((chunk) => chunk.chunkKind === "expr")
			.map((chunk) => (chunk as { readonly expr: ExprNode }).expr);
		expect(exprChildren(node)).toEqual(expected);
	});

	it("exists/selectExpr report zero direct ExprNode children (their query is a SelectNode, out of this registry's vocabulary)", () => {
		expect(exprChildren(buildUnrelatedCase("exists"))).toEqual([]);
		expect(exprChildren(buildUnrelatedCase("selectExpr"))).toEqual([]);
	});

	it("leaf kinds (literal, columnRef, rawSql) report zero children", () => {
		expect(exprChildren(buildUnrelatedCase("literal"))).toEqual([]);
		expect(exprChildren(buildUnrelatedCase("columnRef"))).toEqual([]);
		expect(exprChildren(buildUnrelatedCase("rawSql"))).toEqual([]);
	});

	it("replace substitutes real children, preserving every non-ExprNode field (comparison.operator survives)", () => {
		const node = buildUnrelatedCase("comparison");
		if (node.nodeKind !== "comparison") {
			throw new Error("expected a comparison node");
		}
		const replacementLeft: ExprNode = {
			nodeKind: "literal",
			literal: { literalKind: "number", value: 42 },
		};
		const replacementRight: ExprNode = {
			nodeKind: "literal",
			literal: { literalKind: "number", value: 43 },
		};
		const replaced = replaceExprChildren(node, [
			replacementLeft,
			replacementRight,
		]);
		expect(replaced).toEqual({
			nodeKind: "comparison",
			operator: node.operator,
			left: replacementLeft,
			right: replacementRight,
		});
	});

	it("is re-exported from index.ts as extension surface (#515)", () => {
		expect(CoreIndex.exprChildren).toBe(exprChildren);
		expect(CoreIndex.replaceExprChildren).toBe(replaceExprChildren);
	});
});

import { describe, expect, it } from "vitest";
import type { ComparisonNode, ExprNode, LiteralNode } from "../src/expr/ast";
import {
	exprChildren,
	replaceExprChildren,
	requireBoth,
	requireNext,
	requirePrevious,
} from "../src/index";
import type { KindChange } from "../src/kind/object-kind";

/**
 * Pins that the five traversal/guard exports resolve through the package
 * entry (`../src/index`) and are live bindings — every other core test
 * imports its subject from a module path, so an entry that silently drops
 * one of these names would stay green everywhere else (#515).
 */

const literal = (value: number): LiteralNode => ({
	nodeKind: "literal",
	literal: { literalKind: "number", value },
});

const comparison = (left: ExprNode, right: ExprNode): ComparisonNode => ({
	nodeKind: "comparison",
	operator: "=",
	left,
	right,
});

const change = (overrides: Partial<KindChange> = {}): KindChange => ({
	kind: "function",
	operation: "create",
	identity: "app.f",
	previous: null,
	next: null,
	notes: [],
	...overrides,
});

describe("the five exports resolve through the package entry (#515)", () => {
	it("exprChildren of a comparison node yields [left, right] by reference", () => {
		const left = literal(1);
		const right = literal(2);
		const node = comparison(left, right);
		const children = exprChildren(node);
		expect(children).toHaveLength(2);
		expect(children[0]).toBe(left);
		expect(children[1]).toBe(right);
	});

	it("replaceExprChildren returns the same object when every replacement child is reference-identical", () => {
		const left = literal(1);
		const right = literal(2);
		const node = comparison(left, right);
		expect(replaceExprChildren(node, [left, right])).toBe(node);
	});

	it("replaceExprChildren returns a new node with only the changed child replaced", () => {
		const left = literal(1);
		const right = literal(2);
		const node = comparison(left, right);
		const newRight = literal(3);
		const rebuilt = replaceExprChildren(node, [
			left,
			newRight,
		]) as ComparisonNode;
		expect(rebuilt).not.toBe(node);
		expect(rebuilt.left).toBe(left);
		expect(rebuilt.right).toBe(newRight);
	});

	it("requireNext returns change.next unchanged when present", () => {
		const next = { schema: "app", name: "f" };
		expect(requireNext(change({ next }))).toBe(next);
	});

	it("requireNext throws invalid-kind-change when next is null", () => {
		expect(() =>
			requireNext(change({ kind: "view", operation: "create" })),
		).toThrow("view create change is missing its next snapshot.");
	});

	it("requirePrevious returns change.previous unchanged when present", () => {
		const previous = { schema: "app", name: "f" };
		expect(requirePrevious(change({ previous }))).toBe(previous);
	});

	it("requirePrevious throws invalid-kind-change when previous is null", () => {
		expect(() =>
			requirePrevious(change({ kind: "view", operation: "drop" })),
		).toThrow("view drop change is missing its previous snapshot.");
	});

	it("requireBoth returns both snapshots unchanged when present", () => {
		const previous = { v: 1 };
		const next = { v: 2 };
		expect(requireBoth(change({ previous, next }))).toEqual({
			previous,
			next,
		});
	});

	it("requireBoth throws invalid-kind-change when only previous is present", () => {
		expect(() =>
			requireBoth(
				change({ kind: "enum", operation: "alter", previous: { v: 1 } }),
			),
		).toThrow("enum alter change is missing its previous or next snapshot.");
	});

	it("requireBoth throws invalid-kind-change when only next is present", () => {
		expect(() =>
			requireBoth(change({ kind: "enum", operation: "alter", next: { v: 1 } })),
		).toThrow("enum alter change is missing its previous or next snapshot.");
	});
});

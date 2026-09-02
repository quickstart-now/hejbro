import { describe, expect, it } from "vitest";
import type { TopoEdge } from "../src/declare-emit/topo-order";
import {
	foreignKeyEdgeKey,
	topologicalTableOrder,
} from "../src/declare-emit/topo-order";

describe("topologicalTableOrder / 2.1", () => {
	it("orders independent tables by identity when no edge relates them", () => {
		const result = topologicalTableOrder(
			["app.widgets", "app.accounts", "app.orders"],
			[],
		);
		expect(result.order).toEqual(["app.accounts", "app.orders", "app.widgets"]);
		expect(result.cycleClosingEdges.size).toBe(0);
	});

	it("orders a referenced table before the table that references it", () => {
		const edges: ReadonlyArray<TopoEdge> = [
			{
				from: "app.projects",
				to: "app.members",
				foreignKeyName: "projects_owner_id_fkey",
			},
		];
		const result = topologicalTableOrder(
			["app.projects", "app.members"],
			edges,
		);
		expect(result.order).toEqual(["app.members", "app.projects"]);
		expect(result.cycleClosingEdges.size).toBe(0);
	});

	it("is unaffected by the input identity/edge order (determinism pin)", () => {
		const edges: ReadonlyArray<TopoEdge> = [
			{
				from: "app.projects",
				to: "app.members",
				foreignKeyName: "projects_owner_id_fkey",
			},
		];
		const reversed = topologicalTableOrder(
			["app.members", "app.projects"],
			[...edges].reverse(),
		);
		expect(reversed.order).toEqual(["app.members", "app.projects"]);
	});

	it("breaks a tie between two tables with no path between them by identity", () => {
		const edges: ReadonlyArray<TopoEdge> = [
			{
				from: "app.tasks",
				to: "app.zebras",
				foreignKeyName: "tasks_zebra_id_fkey",
			},
			{
				from: "app.tasks",
				to: "app.aardvarks",
				foreignKeyName: "tasks_aardvark_id_fkey",
			},
		];
		const result = topologicalTableOrder(
			["app.tasks", "app.zebras", "app.aardvarks"],
			edges,
		);
		// both `zebras` and `aardvarks` are visited only as tasks' own
		// dependencies (sorted by target identity), so they land in that
		// order, and `tasks` -- the table with the FKs -- lands last.
		expect(result.order).toEqual(["app.aardvarks", "app.zebras", "app.tasks"]);
	});

	it("closes a two-table cycle on the back edge, not the forward one", () => {
		const edges: ReadonlyArray<TopoEdge> = [
			{ from: "app.a", to: "app.b", foreignKeyName: "a_b_id_fkey" },
			{ from: "app.b", to: "app.a", foreignKeyName: "b_a_id_fkey" },
		];
		const result = topologicalTableOrder(["app.a", "app.b"], edges);
		// visiting starts at "app.a" (identity order): a -> b is followed
		// (b not yet on the stack), b -> a closes the cycle (a is an
		// ancestor) -- so b is ordered first, and b's own edge to a is the
		// one reported, not a's edge to b.
		const closingEdge = edges[1];
		if (closingEdge === undefined) {
			throw new Error("expected a second edge");
		}
		expect(result.order).toEqual(["app.b", "app.a"]);
		expect(result.cycleClosingEdges).toEqual(
			new Set([foreignKeyEdgeKey(closingEdge)]),
		);
	});

	it("does not close a cycle on a self-reference (the caller never passes one)", () => {
		// column-level self-FKs are excluded from the edge list entirely
		// (they're a table's own `t.column` ref, never a graph edge) --
		// this pins that an edge whose from/to happen to be equal (the
		// caller's own bug, not real inference output) is still not
		// treated as a cross-table cycle in a way that drops the table.
		const edges: ReadonlyArray<TopoEdge> = [
			{
				from: "app.comments",
				to: "app.comments",
				foreignKeyName: "comments_parent_id_fkey",
			},
		];
		const result = topologicalTableOrder(["app.comments"], edges);
		expect(result.order).toEqual(["app.comments"]);
	});
});

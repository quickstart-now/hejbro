import { describe, expect, it } from "vitest";
import type { SchemaCrossing } from "../src/declare-emit/file-cycle";
import { buildSchemaFileGraph } from "../src/declare-emit/file-cycle";

describe("buildSchemaFileGraph / CI-G2-R1-19: the schema graph's own deterministic back-edge selection", () => {
	it("names no back edge when the file graph is acyclic", () => {
		const graph = buildSchemaFileGraph(
			["app", "audit"],
			[
				{
					fromSchema: "audit",
					toSchema: "app",
					edgeId: "audit.x audit_x_app_fkey",
				},
			],
		);
		expect(graph.isBackEdge("audit", "app", "audit.x audit_x_app_fkey")).toBe(
			false,
		);
	});

	it("names the back edge on a two-schema cycle by identity order (app < billing, so billing -> app is visited second and closes it)", () => {
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "app", toSchema: "billing", edgeId: "app.a a_b_id_fkey" },
			{
				fromSchema: "billing",
				toSchema: "app",
				edgeId: "billing.b b_a_id_fkey",
			},
		];
		const graph = buildSchemaFileGraph(["app", "billing"], crossings);
		expect(graph.isBackEdge("billing", "app", "billing.b b_a_id_fkey")).toBe(
			true,
		);
		expect(graph.isBackEdge("app", "billing", "app.a a_b_id_fkey")).toBe(false);
	});

	it("judges the cycle on the file graph, not the table graph: two schemas with no table-level cycle still import each other (app.a -> audit.x and audit.y -> app.b)", () => {
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "app", toSchema: "audit", edgeId: "app.a app_a_x_id_fkey" },
			{
				fromSchema: "audit",
				toSchema: "app",
				edgeId: "audit.y audit_y_b_id_fkey",
			},
		];
		const graph = buildSchemaFileGraph(["app", "audit"], crossings);
		// exactly one direction is the back edge (app < audit, so app -> audit
		// is visited first and audit -> app is what closes it) even though no
		// single *table* pair forms a cycle of its own.
		expect(graph.isBackEdge("audit", "app", "audit.y audit_y_b_id_fkey")).toBe(
			true,
		);
		expect(graph.isBackEdge("app", "audit", "app.a app_a_x_id_fkey")).toBe(
			false,
		);
	});

	it("names every back edge on a longer (three-schema) cycle", () => {
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "a", toSchema: "b", edgeId: "a.t1 e1" },
			{ fromSchema: "b", toSchema: "c", edgeId: "b.t1 e2" },
			{ fromSchema: "c", toSchema: "a", edgeId: "c.t1 e3" },
		];
		const graph = buildSchemaFileGraph(["a", "b", "c"], crossings);
		expect(graph.isBackEdge("c", "a", "c.t1 e3")).toBe(true);
		expect(graph.isBackEdge("a", "b", "a.t1 e1")).toBe(false);
		expect(graph.isBackEdge("b", "c", "b.t1 e2")).toBe(false);
	});

	it("is independent of the order crossings are given in (the same tie-break rule as the table graph: identity order, not catalog row order)", () => {
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "app", toSchema: "billing", edgeId: "app.a a_b_id_fkey" },
			{
				fromSchema: "billing",
				toSchema: "app",
				edgeId: "billing.b b_a_id_fkey",
			},
		];
		const forward = buildSchemaFileGraph(["app", "billing"], crossings);
		const reversed = buildSchemaFileGraph(
			["billing", "app"],
			[...crossings].reverse(),
		);
		expect(forward.isBackEdge("billing", "app", "billing.b b_a_id_fkey")).toBe(
			reversed.isBackEdge("billing", "app", "billing.b b_a_id_fkey"),
		);
	});
});

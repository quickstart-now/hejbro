import { describe, expect, it } from "vitest";
import type { SchemaCrossing } from "../src/declare-emit/file-cycle";
import { buildSchemaFileGraph } from "../src/declare-emit/file-cycle";

describe("buildSchemaFileGraph / CI-G2-R1-14", () => {
	it("reports no crossing on a cycle when the file graph is acyclic", () => {
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "audit", toSchema: "app" },
		];
		const graph = buildSchemaFileGraph(crossings);
		expect(graph.isOnCycle("audit", "app")).toBe(false);
	});

	it("reports both directions on a cycle for two schemas that import each other", () => {
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "app", toSchema: "billing" },
			{ fromSchema: "billing", toSchema: "app" },
		];
		const graph = buildSchemaFileGraph(crossings);
		expect(graph.isOnCycle("app", "billing")).toBe(true);
		expect(graph.isOnCycle("billing", "app")).toBe(true);
	});

	it("judges the cycle on the file graph, not the table graph: two schemas with no direct mutual table pair still import each other", () => {
		// app.a -> audit.x and audit.y -> app.b: no single table pair forms
		// a cycle, but app and audit's own *files* still import each other.
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "app", toSchema: "audit" },
			{ fromSchema: "audit", toSchema: "app" },
		];
		const graph = buildSchemaFileGraph(crossings);
		expect(graph.isOnCycle("app", "audit")).toBe(true);
		expect(graph.isOnCycle("audit", "app")).toBe(true);
	});

	it("reports every crossing on a longer (three-schema) cycle, not only the one edge a DFS would call closing", () => {
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "a", toSchema: "b" },
			{ fromSchema: "b", toSchema: "c" },
			{ fromSchema: "c", toSchema: "a" },
		];
		const graph = buildSchemaFileGraph(crossings);
		expect(graph.isOnCycle("a", "b")).toBe(true);
		expect(graph.isOnCycle("b", "c")).toBe(true);
		expect(graph.isOnCycle("c", "a")).toBe(true);
	});

	it("is independent of the order crossings are given in (no tie-break rule needed -- mutual reachability alone decides it)", () => {
		const forward: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "app", toSchema: "billing" },
			{ fromSchema: "billing", toSchema: "app" },
		];
		const reversed = [...forward].reverse();
		expect(buildSchemaFileGraph(forward).isOnCycle("app", "billing")).toBe(
			buildSchemaFileGraph(reversed).isOnCycle("app", "billing"),
		);
	});
});

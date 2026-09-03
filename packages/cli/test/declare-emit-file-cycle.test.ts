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

describe("buildSchemaFileGraph / D106 R2-B1 (CI-R2-02): no back-edge kind is preferred -- the plain DFS's own visit order decides which crossing is cut", () => {
	/** The reviewer's own repro (`evaluation.md`): `app.users.kind` types against `audit.event_kind` (enum crossing, app -> audit), `audit.logs.user_id` references `app.users` (FK crossing, audit -> app) -- a genuine cycle a foreign-key-only graph never saw. */
	const reviewerFixture: ReadonlyArray<SchemaCrossing> = [
		{
			fromSchema: "app",
			toSchema: "audit",
			edgeId: "app.users kind",
			kind: "enum",
		},
		{
			fromSchema: "audit",
			toSchema: "app",
			edgeId: "audit.logs user_id_fkey",
			kind: "foreignKey",
		},
	];

	it("cuts the FK crossing here because visiting starts at 'app' (alphabetically first), not because a foreign key is preferred", () => {
		const graph = buildSchemaFileGraph(["app", "audit"], reviewerFixture);
		expect(
			graph.isBackEdge("audit", "app", "audit.logs user_id_fkey", "foreignKey"),
		).toBe(true);
		expect(graph.isBackEdge("app", "audit", "app.users kind", "enum")).toBe(
			false,
		);
	});

	/**
	 * D106 R2-B1: round-1's `preferForeignKeyBackEdges` swapped this case's
	 * raw back edge (the enum crossing) for its reverse FK, since the FK
	 * had a proven handle -- the removed behaviour this test now pins the
	 * absence of. With no preference, the plain DFS's own raw back edge is
	 * cut: still the enum crossing here (visiting starts at 'app', whose
	 * only edge is the FK to 'audit', so the enum back to 'app' is what
	 * closes the cycle).
	 */
	it("cuts the enum crossing (not the FK) when the enum and FK directions are swapped, now that no kind is preferred", () => {
		const swapped: ReadonlyArray<SchemaCrossing> = [
			{
				fromSchema: "app",
				toSchema: "audit",
				edgeId: "app.users audit_ref_fkey",
				kind: "foreignKey",
			},
			{
				fromSchema: "audit",
				toSchema: "app",
				edgeId: "audit.logs kind",
				kind: "enum",
			},
		];
		const graph = buildSchemaFileGraph(["app", "audit"], swapped);
		expect(graph.isBackEdge("audit", "app", "audit.logs kind", "enum")).toBe(
			true,
		);
		expect(
			graph.isBackEdge(
				"app",
				"audit",
				"app.users audit_ref_fkey",
				"foreignKey",
			),
		).toBe(false);
	});

	it("still cuts the enum crossing on an enum-only cycle (no foreign key crossing exists at all)", () => {
		const enumOnly: ReadonlyArray<SchemaCrossing> = [
			{
				fromSchema: "app",
				toSchema: "audit",
				edgeId: "app.users kind",
				kind: "enum",
			},
			{
				fromSchema: "audit",
				toSchema: "app",
				edgeId: "audit.logs status",
				kind: "enum",
			},
		];
		const graph = buildSchemaFileGraph(["app", "audit"], enumOnly);
		expect(graph.isBackEdge("audit", "app", "audit.logs status", "enum")).toBe(
			true,
		);
		expect(graph.isBackEdge("app", "audit", "app.users kind", "enum")).toBe(
			false,
		);
	});

	it("picks the same edge to cut regardless of crossing order or schema-name order (determinism pin)", () => {
		const forward = buildSchemaFileGraph(["app", "audit"], reviewerFixture);
		const reversed = buildSchemaFileGraph(
			["audit", "app"],
			[...reviewerFixture].reverse(),
		);
		expect(
			forward.isBackEdge(
				"audit",
				"app",
				"audit.logs user_id_fkey",
				"foreignKey",
			),
		).toBe(
			reversed.isBackEdge(
				"audit",
				"app",
				"audit.logs user_id_fkey",
				"foreignKey",
			),
		);
		expect(
			forward.isBackEdge(
				"audit",
				"app",
				"audit.logs user_id_fkey",
				"foreignKey",
			),
		).toBe(true);
	});
});

/**
 * D106 R2-B1 (CI-R2-02): the residual graph -- every crossing minus the
 * ones `isBackEdge` names -- must never contain a cycle, checked here by
 * an independent DFS (not `topologicalTableOrder`'s own) so the property
 * isn't proved by re-running the same algorithm that produced the cut.
 * `preferForeignKeyBackEdges` broke exactly this property on a chorded
 * graph: it cut an edge that was not on the cycle the raw back edge
 * closed, so the cycle survived the cut.
 */
const residualEdges = (
	graph: ReturnType<typeof buildSchemaFileGraph>,
	crossings: ReadonlyArray<SchemaCrossing>,
): ReadonlyArray<{ readonly from: string; readonly to: string }> =>
	crossings
		.filter(
			(crossing) =>
				!graph.isBackEdge(
					crossing.fromSchema,
					crossing.toSchema,
					crossing.edgeId,
					crossing.kind,
				),
		)
		.map((crossing) => ({ from: crossing.fromSchema, to: crossing.toSchema }));

const hasCycle = (
	schemaNames: ReadonlyArray<string>,
	edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): boolean => {
	const adjacency = edges.reduce((map, edge) => {
		const existing = map.get(edge.from) ?? [];
		map.set(edge.from, [...existing, edge.to]);
		return map;
	}, new Map<string, ReadonlyArray<string>>());
	const state = new Map<string, "visiting" | "done">();
	const visit = (node: string): boolean => {
		const status = state.get(node);
		if (status === "done") {
			return false;
		}
		if (status === "visiting") {
			return true;
		}
		state.set(node, "visiting");
		const cyclic = (adjacency.get(node) ?? []).some((next) => visit(next));
		state.set(node, "done");
		return cyclic;
	};
	return schemaNames.some((name) => visit(name));
};

describe("buildSchemaFileGraph / D106 R2-B1 (CI-R2-02): the residual graph is acyclic across several shapes, independent of the cutting algorithm's own DFS", () => {
	it("cuts the chorded three-schema graph the reviewer measured (a->b FK, a->c FK, b->c FK, c->a enum) into something acyclic", () => {
		const schemas = ["a", "b", "c"];
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{
				fromSchema: "a",
				toSchema: "b",
				edgeId: "a.ta b_id_fkey",
				kind: "foreignKey",
			},
			{
				fromSchema: "a",
				toSchema: "c",
				edgeId: "a.ta2 c_id_fkey",
				kind: "foreignKey",
			},
			{
				fromSchema: "b",
				toSchema: "c",
				edgeId: "b.tb c_id_fkey",
				kind: "foreignKey",
			},
			{ fromSchema: "c", toSchema: "a", edgeId: "c.tc kind", kind: "enum" },
		];
		const graph = buildSchemaFileGraph(schemas, crossings);
		expect(hasCycle(schemas, residualEdges(graph, crossings))).toBe(false);
		// pin the actual cut too: the raw DFS back edge (c -> a, enum), not
		// the chord (a -> c) round-1's preference step swapped onto.
		expect(graph.isBackEdge("c", "a", "c.tc kind", "enum")).toBe(true);
		expect(graph.isBackEdge("a", "c", "a.ta2 c_id_fkey", "foreignKey")).toBe(
			false,
		);
	});

	it("cuts a four-schema mixed-kind cycle (a->b FK, b->c enum, c->d FK, d->a enum) into something acyclic", () => {
		const schemas = ["a", "b", "c", "d"];
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "a", toSchema: "b", edgeId: "a.t1 e1", kind: "foreignKey" },
			{ fromSchema: "b", toSchema: "c", edgeId: "b.t1 e2", kind: "enum" },
			{ fromSchema: "c", toSchema: "d", edgeId: "c.t1 e3", kind: "foreignKey" },
			{ fromSchema: "d", toSchema: "a", edgeId: "d.t1 e4", kind: "enum" },
		];
		const graph = buildSchemaFileGraph(schemas, crossings);
		expect(hasCycle(schemas, residualEdges(graph, crossings))).toBe(false);
	});

	it("cuts two overlapping two-schema cycles sharing a vertex (a<->b, b<->c, each an FK/enum pair) into something acyclic", () => {
		const schemas = ["a", "b", "c"];
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{ fromSchema: "a", toSchema: "b", edgeId: "a.t1 e1", kind: "foreignKey" },
			{ fromSchema: "b", toSchema: "a", edgeId: "b.t1 e2", kind: "enum" },
			{ fromSchema: "b", toSchema: "c", edgeId: "b.t2 e3", kind: "foreignKey" },
			{ fromSchema: "c", toSchema: "b", edgeId: "c.t1 e4", kind: "enum" },
		];
		const graph = buildSchemaFileGraph(schemas, crossings);
		expect(hasCycle(schemas, residualEdges(graph, crossings))).toBe(false);
	});

	it("cuts the same edges from the chorded graph regardless of crossing order or schema-name order (determinism pin)", () => {
		const schemas = ["a", "b", "c"];
		const crossings: ReadonlyArray<SchemaCrossing> = [
			{
				fromSchema: "a",
				toSchema: "b",
				edgeId: "a.ta b_id_fkey",
				kind: "foreignKey",
			},
			{
				fromSchema: "a",
				toSchema: "c",
				edgeId: "a.ta2 c_id_fkey",
				kind: "foreignKey",
			},
			{
				fromSchema: "b",
				toSchema: "c",
				edgeId: "b.tb c_id_fkey",
				kind: "foreignKey",
			},
			{ fromSchema: "c", toSchema: "a", edgeId: "c.tc kind", kind: "enum" },
		];
		const forward = buildSchemaFileGraph(schemas, crossings);
		const reversed = buildSchemaFileGraph(
			[...schemas].reverse(),
			[...crossings].reverse(),
		);
		expect(forward.isBackEdge("c", "a", "c.tc kind", "enum")).toBe(
			reversed.isBackEdge("c", "a", "c.tc kind", "enum"),
		);
		expect(forward.isBackEdge("c", "a", "c.tc kind", "enum")).toBe(true);
	});
});

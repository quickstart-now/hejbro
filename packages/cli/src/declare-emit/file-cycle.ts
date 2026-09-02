import type { TopoEdge } from "./topo-order";
import { foreignKeyEdgeKey, topologicalTableOrder } from "./topo-order";

/**
 * A cross-schema foreign key crossing, `fromSchema` (the table declaring
 * the FK) to `toSchema` (its target), carrying `edgeId` -- unique per
 * crossing FK (the FK's own owning table identity plus its own name), so
 * two different FKs crossing the same schema pair are judged on their
 * own merits, matching the table graph's own edge model exactly
 * (`topo-order.ts`'s `TopoEdge`, reused unchanged here with schema names
 * standing in for table identities).
 *
 * This is the *file*-level (schema-to-schema) graph a declaration-file
 * cycle is judged on (CI-G2-R1-14/18/19), never the table graph alone:
 * two schemas' *files* import each other whenever a foreign key crosses
 * in either direction, even when no single table pair forms a cycle of
 * its own (e.g. `app.a -> audit.x` and `audit.y -> app.b`) -- that
 * mismatch between the file graph and the table graph is exactly what an
 * eager cross-file reference can crash on, depending on which file a
 * loader happens to reach first.
 */
export type SchemaCrossing = {
	readonly fromSchema: string;
	readonly toSchema: string;
	readonly edgeId: string;
};

export type SchemaFileGraph = {
	/**
	 * Whether the crossing `fromSchema -> toSchema` (named `edgeId`) is
	 * the *back edge* a deterministic depth-first walk of the schema
	 * graph finds (CI-G2-R1-18/19, lead-adopted refinement over R1-16's
	 * own first cut): only this edge needs a handle -- severing it alone
	 * already makes the remaining import graph acyclic, so every other
	 * crossing keeps a real, type-carrying cross-file import. Ties are
	 * broken by schema name, the same rule the table graph's own
	 * topological order uses, so a different catalog row order can never
	 * flip which direction gets the handle.
	 */
	readonly isBackEdge: (
		fromSchema: string,
		toSchema: string,
		edgeId: string,
	) => boolean;
};

/**
 * Builds the schema-level graph from every cross-schema crossing this
 * run's own foreign keys produce, reusing `topologicalTableOrder`
 * unchanged (one schema per vertex, one edge per crossing FK) -- the
 * exact same deterministic DFS and tie-break rule the table graph uses,
 * just at schema granularity.
 */
export const buildSchemaFileGraph = (
	schemaNames: ReadonlyArray<string>,
	crossings: ReadonlyArray<SchemaCrossing>,
): SchemaFileGraph => {
	const edges: ReadonlyArray<TopoEdge> = crossings.map((crossing) => ({
		from: crossing.fromSchema,
		to: crossing.toSchema,
		foreignKeyName: crossing.edgeId,
	}));
	const topo = topologicalTableOrder(schemaNames, edges);
	return {
		isBackEdge: (fromSchema, toSchema, edgeId) =>
			topo.cycleClosingEdges.has(
				foreignKeyEdgeKey({
					from: fromSchema,
					to: toSchema,
					foreignKeyName: edgeId,
				}),
			),
	};
};

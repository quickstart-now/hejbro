import type { TopoEdge } from "./topo-order";
import { foreignKeyEdgeKey, topologicalTableOrder } from "./topo-order";

/**
 * A cross-schema crossing, `fromSchema` (the file needing the reference) to
 * `toSchema` (the file it reaches for), carrying `edgeId` -- unique per
 * crossing within its own `kind` (a foreign key's owning-table identity
 * plus its own name; an enum reference's owning-table identity plus the
 * enum's own identity), so two different crossings of the same schema
 * pair are judged on their own merits, matching the table graph's own
 * edge model exactly (`topo-order.ts`'s `TopoEdge`, reused unchanged here
 * with schema names standing in for table identities).
 *
 * This is the *file*-level (schema-to-schema) graph a declaration-file
 * cycle is judged on (CI-G2-R1-14/18/19, widened by D106 B1/CI-D106-R2-02
 * to also count an enum reference as an edge): two schemas' *files* import
 * each other whenever a foreign key crosses in either direction, or one
 * schema's table types a column against another schema's enum, or both --
 * even when no single table pair forms a cycle of its own (e.g.
 * `app.a -> audit.x` and `audit.y -> app.b`) -- that mismatch between the
 * file graph and the table graph is exactly what an eager cross-file
 * reference can crash on, depending on which file a loader happens to
 * reach first.
 *
 * `kind` defaults to `"foreignKey"` when omitted, so every crossing this
 * graph was built against before D106 B1 (a plain FK-only fixture, e.g.
 * `declare-emit-file-cycle.test.ts`'s own) keeps meaning exactly what it
 * always meant.
 */
export type SchemaCrossing = {
	readonly fromSchema: string;
	readonly toSchema: string;
	readonly edgeId: string;
	readonly kind?: "foreignKey" | "enum";
};

export type SchemaFileGraph = {
	/**
	 * Whether the crossing `fromSchema -> toSchema` (named `edgeId`, of
	 * `kind`) is the *back edge* a deterministic depth-first walk of the
	 * schema graph finds (CI-G2-R1-18/19, lead-adopted refinement over
	 * R1-16's own first cut): only this edge needs a handle -- severing
	 * it alone already makes the remaining import graph acyclic (a DFS
	 * back edge is, by construction, the only kind of edge a cycle can
	 * close, so cutting every one the walk reports is always enough --
	 * D106 R2-B1/CI-R2-02), so every other crossing keeps a real,
	 * type-carrying cross-file import. Ties are broken by schema name,
	 * the same rule the table graph's own topological order uses, so a
	 * different catalog row order can never flip which direction gets
	 * the handle. `kind` defaults to `"foreignKey"`, matching
	 * `SchemaCrossing`'s own default.
	 *
	 * A round-1 correction here (`preferForeignKeyBackEdges`, since
	 * removed) swapped a raw enum back edge for a same-pair reverse
	 * foreign key when one existed, so the FK side (already carrying a
	 * proven handle) got cut instead and the enum's own real import
	 * stayed. It never checked that the "mirror" FK lay on the very
	 * cycle the raw back edge closed -- only that it was the exact
	 * reverse crossing. On a graph with a chord (an edge between two
	 * schemas that are also connected by a longer path) the mirror can
	 * be a chord itself: cutting it leaves the real cycle untouched, and
	 * every entry order crashes. Restoring that optimization would need
	 * re-deriving whether the candidate replacement is itself on the
	 * closed cycle -- exactly the check "cut what the DFS found" already
	 * gets for free -- so it is not attempted; fewer handles and more
	 * real imports is given up in favor of the correctness guarantee.
	 */
	readonly isBackEdge: (
		fromSchema: string,
		toSchema: string,
		edgeId: string,
		kind?: "foreignKey" | "enum",
	) => boolean;
};

const crossingKind = (crossing: SchemaCrossing): "foreignKey" | "enum" =>
	crossing.kind ?? "foreignKey";

/** The compound key a crossing's own `kind` and `edgeId` resolve to inside the underlying graph -- prevents an FK crossing and an enum crossing from ever colliding on the same graph edge key by accident (their `edgeId`s are built from unrelated vocabularies -- an FK's own name vs. a column's own name -- so a collision would need both to coincide *and* go unprefixed). */
const compoundEdgeId = (edgeId: string, kind: "foreignKey" | "enum"): string =>
	`${kind}:${edgeId}`;

/**
 * Builds the schema-level graph from every cross-schema crossing this
 * run's own foreign keys and enum references produce, reusing
 * `topologicalTableOrder` unchanged (one schema per vertex, one edge per
 * crossing) -- the exact same deterministic DFS and tie-break rule the
 * table graph uses, just at schema granularity. Every back edge the DFS
 * reports is cut, with no further selection on top (D106 R2-B1).
 */
export const buildSchemaFileGraph = (
	schemaNames: ReadonlyArray<string>,
	crossings: ReadonlyArray<SchemaCrossing>,
): SchemaFileGraph => {
	const edges: ReadonlyArray<TopoEdge> = crossings.map((crossing) => ({
		from: crossing.fromSchema,
		to: crossing.toSchema,
		foreignKeyName: compoundEdgeId(crossing.edgeId, crossingKind(crossing)),
	}));
	const topo = topologicalTableOrder(schemaNames, edges);
	return {
		isBackEdge: (fromSchema, toSchema, edgeId, kind = "foreignKey") =>
			topo.cycleClosingEdges.has(
				foreignKeyEdgeKey({
					from: fromSchema,
					to: toSchema,
					foreignKeyName: compoundEdgeId(edgeId, kind),
				}),
			),
	};
};

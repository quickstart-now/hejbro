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
	 * R1-16's own first cut; D106 B1/CI-D106-R2-02's own kind-preference
	 * correction on top): only this edge needs a handle -- severing it
	 * alone already makes the remaining import graph acyclic, so every
	 * other crossing keeps a real, type-carrying cross-file import. Ties
	 * are broken by schema name, the same rule the table graph's own
	 * topological order uses, so a different catalog row order can never
	 * flip which direction gets the handle. `kind` defaults to
	 * `"foreignKey"`, matching `SchemaCrossing`'s own default.
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

const crossingGraphKey = (crossing: SchemaCrossing): string =>
	foreignKeyEdgeKey({
		from: crossing.fromSchema,
		to: crossing.toSchema,
		foreignKeyName: compoundEdgeId(crossing.edgeId, crossingKind(crossing)),
	});

/**
 * D106 B1 (lead verdict: candidate B+A) -- among the raw back edges a
 * plain DFS finds, prefer cutting a foreign-key crossing over an enum
 * crossing when both are available for the very same schema pair in
 * opposite directions: a foreign key's own back edge already has a
 * proven handle (`existingTable`); severing the FK side instead of the
 * enum side leaves the enum's own real, type-carrying import in place,
 * which is one more genuine cross-file reference than cutting the enum
 * side would. An enum-only cycle (no mirroring FK crossing to swap onto)
 * is still cut -- candidate A's own limit is exactly what candidate B
 * covers. Scoped to the direct two-schema mutual-pair shape (an edge and
 * its exact reverse): a longer cycle with no such mirror is left as the
 * plain DFS found it. Deterministic: when more than one FK mirror
 * candidate exists, the one sorting first by its own compound key wins,
 * so a different catalog/table row order can never flip which edge is
 * cut.
 */
const preferForeignKeyBackEdges = (
	crossings: ReadonlyArray<SchemaCrossing>,
	rawBackEdgeKeys: ReadonlySet<string>,
): ReadonlySet<string> =>
	crossings.reduce((backEdgeKeys, crossing) => {
		if (
			crossingKind(crossing) !== "enum" ||
			!backEdgeKeys.has(crossingGraphKey(crossing))
		) {
			return backEdgeKeys;
		}
		const mirrorKey = crossings
			.filter(
				(candidate) =>
					crossingKind(candidate) === "foreignKey" &&
					candidate.fromSchema === crossing.toSchema &&
					candidate.toSchema === crossing.fromSchema &&
					!backEdgeKeys.has(crossingGraphKey(candidate)),
			)
			.map((candidate) => crossingGraphKey(candidate))
			.sort()
			.at(0);
		if (mirrorKey === undefined) {
			return backEdgeKeys;
		}
		// A fresh copy, mutated locally -- never the shared `backEdgeKeys`
		// this iteration started from, and never spread back into itself
		// (`lint/performance/noAccumulatingSpread`).
		const swapped = new Set(backEdgeKeys);
		swapped.delete(crossingGraphKey(crossing));
		swapped.add(mirrorKey);
		return swapped;
	}, rawBackEdgeKeys);

/**
 * Builds the schema-level graph from every cross-schema crossing this
 * run's own foreign keys and enum references produce, reusing
 * `topologicalTableOrder` unchanged (one schema per vertex, one edge per
 * crossing) -- the exact same deterministic DFS and tie-break rule the
 * table graph uses, just at schema granularity -- then applies D106 B1's
 * own FK-preference correction on top.
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
	const backEdgeKeys = preferForeignKeyBackEdges(
		crossings,
		topo.cycleClosingEdges,
	);
	return {
		isBackEdge: (fromSchema, toSchema, edgeId, kind = "foreignKey") =>
			backEdgeKeys.has(
				foreignKeyEdgeKey({
					from: fromSchema,
					to: toSchema,
					foreignKeyName: compoundEdgeId(edgeId, kind),
				}),
			),
	};
};

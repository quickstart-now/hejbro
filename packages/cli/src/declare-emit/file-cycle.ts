/**
 * A cross-schema foreign key crossing, `fromSchema` (the table declaring
 * the FK) to `toSchema` (its target) -- the file-level (schema-to-schema)
 * graph a declaration-file cycle is judged on (CI-G2-R1-14), never the
 * table graph alone: two schemas' *files* import each other whenever a
 * foreign key crosses in either direction, even when no single table
 * pair forms a cycle of its own (e.g. `app.a -> audit.x` and
 * `audit.y -> app.b`) -- that mismatch between the file graph and the
 * table graph is exactly what an eager cross-file reference can crash
 * on, depending on which file a loader happens to reach first.
 */
export type SchemaCrossing = {
	readonly fromSchema: string;
	readonly toSchema: string;
};

/** One schema reachable from another via zero or more crossings -- built once per `fromSchema` query, recursively (no loop). */
const reachableSchemasFrom = (
	start: string,
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> => {
	const visit = (
		visited: ReadonlySet<string>,
		schema: string,
	): ReadonlySet<string> => {
		if (visited.has(schema)) {
			return visited;
		}
		const nextVisited = new Set([...visited, schema]);
		return [...(adjacency.get(schema) ?? [])].reduce(visit, nextVisited);
	};
	return visit(new Set(), start);
};

const addToAdjacency = (
	adjacency: Map<string, Set<string>>,
	crossing: SchemaCrossing,
): Map<string, Set<string>> => {
	const existing = adjacency.get(crossing.fromSchema) ?? new Set<string>();
	existing.add(crossing.toSchema);
	adjacency.set(crossing.fromSchema, existing);
	return adjacency;
};

export type SchemaFileGraph = {
	/** Whether `toSchema` can reach back to `fromSchema` through some path of crossings -- true exactly when the direct crossing `fromSchema -> toSchema` sits on a cycle of the file graph (CI-G2-R1-14's own superset rule: every crossing on a cycle, not only the one edge a table-level topological sort would call "closing"). */
	readonly isOnCycle: (fromSchema: string, toSchema: string) => boolean;
};

/**
 * Builds the file-level graph from every cross-schema crossing this run's
 * own foreign keys produce, and answers `isOnCycle` by mutual
 * reachability -- a pure function of the crossing set, so it needs no
 * tie-break rule of its own (unlike a DFS-order-dependent "closing edge"
 * pick): two schemas are mutually cyclic, or they are not, independent
 * of the order `crossings` is given in.
 */
export const buildSchemaFileGraph = (
	crossings: ReadonlyArray<SchemaCrossing>,
): SchemaFileGraph => {
	const adjacency = crossings.reduce(
		addToAdjacency,
		new Map<string, Set<string>>(),
	);
	return {
		isOnCycle: (fromSchema, toSchema) =>
			reachableSchemasFrom(toSchema, adjacency).has(fromSchema),
	};
};

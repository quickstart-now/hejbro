import { guardSnapshotRead, throwHejbroError } from "../error";
import type { KindChange } from "../kind/object-kind";
import type { KindRegistry, RegisteredObjectKind } from "../kind/registry";
import { asTableSnapshot, tableExisting } from "../kinds/table-snapshot";
import type { Snapshot } from "../snapshot/snapshot";
import type { JsonValue } from "../snapshot/stable-json";
import { compareKeys } from "../sort";

const splitObjectKey = (
	key: string,
): { readonly kind: string; readonly identity: string } => {
	const colonIndex = key.indexOf(":");
	if (colonIndex === -1) {
		return throwHejbroError(
			"invalid-snapshot-key",
			`snapshot object key "${key}" is missing a "kind:identity" separator. Next: restore the snapshot from version control, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it — a snapshot key should never need hand-editing.`,
		);
	}
	return {
		kind: key.slice(0, colonIndex),
		identity: key.slice(colonIndex + 1),
	};
};

const lookupNode = (
	objects: Snapshot["objects"],
	key: string,
): JsonValue | null => {
	if (Object.hasOwn(objects, key)) {
		const value = objects[key];
		if (value !== undefined) {
			return value;
		}
	}
	return null;
};

/** `kind.canonicalize?.(node) ?? node` (#701, D3), `null` passing straight through -- a side a change's operation never carries (a create's `previous`, a drop's `next`) has nothing to canonicalize. */
const canonicalizeNode = (
	node: JsonValue | null,
	kind: RegisteredObjectKind,
): JsonValue | null => {
	if (node === null) {
		return null;
	}
	return kind.canonicalize?.(node) ?? node;
};

/**
 * Topologically sorts every registered kind name by `dependsOn`
 * (dependencies before dependents), via `reduce` over each kind's
 * dependency list. Throws on a `dependsOn` cycle or an unregistered
 * dependency name.
 */
const topoSortKindNames = (registry: KindRegistry): ReadonlyArray<string> => {
	const kinds = registry.list();
	const dependsOnByKind = new Map(
		kinds.map((kind) => [kind.kind, kind.dependsOn] as const),
	);

	type ResolveState = {
		readonly ordered: ReadonlyArray<string>;
		readonly visiting: ReadonlySet<string>;
	};

	const resolve = (state: ResolveState, kindName: string): ResolveState => {
		if (state.ordered.includes(kindName)) {
			return state;
		}
		if (state.visiting.has(kindName)) {
			return throwHejbroError(
				"cyclic-kind-dependency",
				`kind "${kindName}" is part of a dependsOn cycle. Next: check hejbro.config.ts's presets array for two presets whose kinds depend on each other and remove one, or if you're authoring the kind, break the cycle in its dependsOn array.`,
			);
		}
		const dependencies = dependsOnByKind.get(kindName);
		if (dependencies === undefined) {
			return throwHejbroError(
				"unknown-kind-dependency",
				`kind "${kindName}" is not registered, but another kind depends on it. Next: register a preset that provides a kind named "${kindName}" in hejbro.config.ts's presets array, or if you're authoring the kind that depends on it, remove "${kindName}" from its dependsOn array.`,
			);
		}
		const visitingState: ResolveState = {
			ordered: state.ordered,
			visiting: new Set([...state.visiting, kindName]),
		};
		const afterDependencies = dependencies.reduce(resolve, visitingState);
		return {
			ordered: [...afterDependencies.ordered, kindName],
			visiting: state.visiting,
		};
	};

	const finalState = kinds
		.map((kind) => kind.kind)
		.reduce(resolve, { ordered: [], visiting: new Set<string>() });
	return finalState.ordered;
};

/**
 * Builds a `kindName -> rank` lookup from `dependsOn` topological order
 * (dependencies first, rank 0). Shared by `diffSnapshots` (create/alter
 * ascending, drop descending) and `generateMigration`'s `predrop`-stage
 * ordering (also descending, by the same reasoning as a `drop` change: a
 * dependent kind's predrop statement must run before the kind it depends
 * on is altered).
 */
export const rankKinds = (
	registry: KindRegistry,
): ((kindName: string) => number) => {
	const kindOrder = topoSortKindNames(registry);
	const kindRank = new Map(
		kindOrder.map((kindName, index) => [kindName, index] as const),
	);
	return (kindName: string): number => {
		const rank = kindRank.get(kindName);
		if (rank === undefined) {
			return throwHejbroError(
				"unknown-kind-dependency",
				`change references unregistered kind "${kindName}".`,
			);
		}
		return rank;
	};
};

/**
 * `key`'s owning table's own snapshot node (per `kind.ownerTableIdentity`,
 * D106 R1, B2) — `next`'s own entry for that table identity, falling
 * back to `previous`'s when the table's declaration was removed
 * outright (so `next` carries no entry for it at all). `null` when
 * `kind` doesn't implement `ownerTableIdentity` at all (a `grant`, for
 * instance — the user's own standalone declaration, never a table
 * fan-out, is never asked).
 *
 * Internal invariant: `diffSnapshots`' own caller draws `key` from the
 * union of `previous.objects`'/`next.objects`' keys, so at least one of
 * `previousNode`/`nextNode` is always non-null here — the cast below
 * narrows that guarantee rather than adding a runtime branch nothing
 * can ever take (a fan-out object's own key only ever exists because
 * some run once serialized it from a real table declaration). This
 * breaks the moment a second caller passes a `previousNode`/`nextNode`
 * pair for a key it invented rather than one drawn from that same
 * union — the compiler cannot catch that; only this comment can warn
 * the next caller.
 */
const authoritativeOwnerNode = (
	kind: RegisteredObjectKind,
	previous: Snapshot,
	next: Snapshot,
	previousNode: JsonValue | null,
	nextNode: JsonValue | null,
): JsonValue | null => {
	if (kind.ownerTableIdentity === undefined) {
		return null;
	}
	const ownerNode = (nextNode ?? previousNode) as JsonValue;
	const ownerTableKey = `table:${kind.ownerTableIdentity(ownerNode)}`;
	return (
		lookupNode(next.objects, ownerTableKey) ??
		lookupNode(previous.objects, ownerTableKey)
	);
};

/**
 * `true` when `key`'s owning table is existing — read via
 * {@link authoritativeOwnerNode}, so `next`'s own record decides except
 * when the table's declaration was removed outright (`next` having
 * nothing to say being exactly the removal case). This is not `previous
 * || existing-in-next`: on adoption, `next`'s own record says the table
 * is managed again, and a fanned-out object's create must proceed then,
 * never suppressed merely because the table once was existing.
 */
const ownerIsExisting = (
	kind: RegisteredObjectKind,
	previous: Snapshot,
	next: Snapshot,
	previousNode: JsonValue | null,
	nextNode: JsonValue | null,
): boolean => {
	const authoritative = authoritativeOwnerNode(
		kind,
		previous,
		next,
		previousNode,
		nextNode,
	);
	if (authoritative === null) {
		return false;
	}
	return tableExisting(asTableSnapshot(authoritative));
};

/** The node `dependsOnIdentities` reads for ordering purposes: `next` for a create/alter, `previous` for a drop -- exactly the side that change actually carries a real node on (a create's `previous` is always `null`, a drop's `next` is always `null`; `ObjectKind.diff`'s own contract guarantees the side this function reads here is never null). */
const nodeForOrdering = (change: KindChange): JsonValue => {
	if (change.operation === "drop") {
		return change.previous as JsonValue;
	}
	return change.next as JsonValue;
};

/** Which side of a same-kind dependency edge a target/predecessor pair falls on, by direction: on create, a dependency precedes its dependent (same sense as `rankKinds`); on drop, a dependent precedes what it depends on (the reverse — #753/task 1.2). */
const edgeTargetAndPredecessor = (
	direction: "create" | "drop",
	changeIdentity: string,
	dependencyIdentity: string,
): { readonly target: string; readonly predecessor: string } => {
	if (direction === "create") {
		return { target: changeIdentity, predecessor: dependencyIdentity };
	}
	return { target: dependencyIdentity, predecessor: changeIdentity };
};

/**
 * `identity -> the identities that must be placed before it`, built from
 * `kind.dependsOnIdentities` over `changes` (already narrowed to one kind,
 * one direction). An edge naming an identity outside `changes`' own
 * identity set is dropped (task 1.2: "an ordinary, unrelated reference,
 * not a constraint on this run's order").
 */
const buildPredecessors = (
	dependsOnIdentities: (node: JsonValue) => ReadonlyArray<string>,
	changes: ReadonlyArray<KindChange>,
	identitySet: ReadonlySet<string>,
	direction: "create" | "drop",
): ReadonlyMap<string, ReadonlySet<string>> =>
	changes.reduce<ReadonlyMap<string, ReadonlySet<string>>>((acc, change) => {
		const dependencies = dependsOnIdentities(nodeForOrdering(change)).filter(
			(identity) => identitySet.has(identity) && identity !== change.identity,
		);
		return dependencies.reduce((innerAcc, dependencyIdentity) => {
			const { target, predecessor } = edgeTargetAndPredecessor(
				direction,
				change.identity,
				dependencyIdentity,
			);
			const existing = innerAcc.get(target) ?? new Set<string>();
			return new Map(innerAcc).set(target, new Set([...existing, predecessor]));
		}, acc);
	}, new Map());

type WaveState = {
	readonly placed: ReadonlySet<string>;
	readonly ordered: ReadonlyArray<string>;
};

const isReady = (
	predecessorsOf: ReadonlyMap<string, ReadonlySet<string>>,
	placed: ReadonlySet<string>,
	identity: string,
): boolean =>
	Array.from(predecessorsOf.get(identity) ?? new Set<string>()).every(
		(predecessor) => placed.has(predecessor),
	);

/**
 * A stable, cycle-tolerant topological sort over `identities` (already in
 * their existing identity order), by waves: each step places every
 * currently-unblocked identity (in its existing relative order), never
 * one at a time by insertion order — this is what keeps an unconstrained
 * pair in identity order (task 1.2: "a table referencing two independent
 * tables... only 'referencing before both' is asserted"). When no
 * identity is ever unblocked (a genuine cycle among what's left),
 * `#753`/task 1.2 says never throw: the remaining identities are flushed
 * in their existing relative order instead, since no order satisfies a
 * cycle either way.
 */
const runWaves = (
	identities: ReadonlyArray<string>,
	predecessorsOf: ReadonlyMap<string, ReadonlySet<string>>,
	state: WaveState,
): WaveState => {
	const remaining = identities.filter(
		(identity) => !state.placed.has(identity),
	);
	if (remaining.length === 0) {
		return state;
	}
	const ready = remaining.filter((identity) =>
		isReady(predecessorsOf, state.placed, identity),
	);
	if (ready.length === 0) {
		return {
			placed: new Set([...state.placed, ...remaining]),
			ordered: [...state.ordered, ...remaining],
		};
	}
	return runWaves(identities, predecessorsOf, {
		placed: new Set([...state.placed, ...ready]),
		ordered: [...state.ordered, ...ready],
	});
};

/**
 * Refines one same-kind, same-direction group of changes (already sorted
 * by identity) by `kind.dependsOnIdentities` (#753/task 1.2) — a no-op
 * when the kind doesn't implement it (every kind but `tableKind` today)
 * or the group has nothing to reorder.
 */
const refineByDependsOnIdentities = (
	kind: RegisteredObjectKind,
	changes: ReadonlyArray<KindChange>,
	direction: "create" | "drop",
): ReadonlyArray<KindChange> => {
	const dependsOnIdentities = kind.dependsOnIdentities;
	if (dependsOnIdentities === undefined || changes.length <= 1) {
		return changes;
	}
	// A kind may report more than one change for the same identity (#774);
	// they travel as one unit, adjacent and in reported order, keyed by
	// their shared identity rather than collapsed to it (`.push` into a
	// local accumulator, never `Map` spread — `groupContiguousByKind`'s
	// own quadratic-cost precedent).
	const changesByIdentity = changes.reduce<Map<string, Array<KindChange>>>(
		(groups, change) => {
			const group = groups.get(change.identity);
			if (group !== undefined) {
				group.push(change);
				return groups;
			}
			groups.set(change.identity, [change]);
			return groups;
		},
		new Map(),
	);
	const identities = Array.from(changesByIdentity.keys());
	const identitySet = new Set(identities);
	const predecessorsOf = buildPredecessors(
		dependsOnIdentities,
		changes,
		identitySet,
		direction,
	);
	const refined = runWaves(identities, predecessorsOf, {
		placed: new Set(),
		ordered: [],
	});
	return refined.ordered.flatMap(
		(identity) => changesByIdentity.get(identity) as ReadonlyArray<KindChange>,
	);
};

/**
 * Groups `sortedChanges` (already sorted by kind rank, so same-kind
 * entries are already contiguous) into contiguous same-kind runs, via
 * `reduce` accumulating by `.push` (never spread — quadratic on a large
 * change set, `with.ts`'s own `entries.push()` precedent) into a local
 * accumulator this function alone ever sees; the type this returns stays
 * `ReadonlyArray`, so no caller can mutate it back.
 */
const groupContiguousByKind = (
	sortedChanges: ReadonlyArray<KindChange>,
): ReadonlyArray<ReadonlyArray<KindChange>> =>
	sortedChanges.reduce<Array<Array<KindChange>>>((groups, change) => {
		const lastGroup = groups.at(-1);
		if (lastGroup !== undefined && lastGroup[0]?.kind === change.kind) {
			lastGroup.push(change);
			return groups;
		}
		groups.push([change]);
		return groups;
	}, []);

/** Applies {@link refineByDependsOnIdentities} within every contiguous same-kind run of `sortedChanges`, leaving cross-kind order (already correct via `rankOf`) untouched. */
const refineWithinKindGroups = (
	sortedChanges: ReadonlyArray<KindChange>,
	registry: KindRegistry,
	direction: "create" | "drop",
): ReadonlyArray<KindChange> =>
	groupContiguousByKind(sortedChanges).flatMap((group) => {
		const [first] = group;
		if (first === undefined) {
			return group;
		}
		return refineByDependsOnIdentities(
			registry.get(first.kind),
			group,
			direction,
		);
	});

/**
 * Diffs two snapshots into an ordered list of {@link KindChange}s.
 * Creates and alters are ordered by kind dependency order (topological
 * over `dependsOn`), sorted by identity (byte order) within a kind, then
 * refined by any same-kind dependency edges a kind's own
 * `dependsOnIdentities` names (#753/task 1.2: a table's own foreign keys,
 * today — dependencies before dependents). Drops are ordered in the
 * reverse kind order, also sorted by identity then refined the same way,
 * reversed (a dependent before what it depends on).
 */
export const diffSnapshots = (
	previous: Snapshot,
	next: Snapshot,
	registry: KindRegistry,
): ReadonlyArray<KindChange> => {
	const rankOf = rankKinds(registry);

	const allKeys = Array.from(
		new Set([...Object.keys(previous.objects), ...Object.keys(next.objects)]),
	);

	const rawChanges = allKeys.flatMap((key) =>
		guardSnapshotRead(`reading snapshot entry "${key}"`, () => {
			const { kind: kindName, identity } = splitObjectKey(key);
			const kind = registry.get(kindName);
			// #701/D3: canonicalize each side's node before anything reads it,
			// so a set-shaped array's order (whichever side carries it -- a
			// hand-written previous, or a file on disk written before this
			// order was canonical) never reaches a kind's own sameJson gate, or
			// the create/drop guard below, as a difference. Inside this guard
			// (not a whole-snapshot pass ahead of it), so a malformed node still
			// crashes into `malformed-snapshot-node` here, not a raw TypeError
			// from inside `canonicalize` itself.
			const previousNode = canonicalizeNode(
				lookupNode(previous.objects, key),
				kind,
			);
			const nextNode = canonicalizeNode(lookupNode(next.objects, key), kind);
			if (ownerIsExisting(kind, previous, next, previousNode, nextNode)) {
				return [];
			}
			return kind.diff(previousNode, nextNode, identity);
		}),
	);

	const createOrAlterChanges = refineWithinKindGroups(
		rawChanges
			.filter((change) => change.operation !== "drop")
			.sort((a, b) => {
				const rankDelta = rankOf(a.kind) - rankOf(b.kind);
				if (rankDelta !== 0) {
					return rankDelta;
				}
				return compareKeys(a.identity, b.identity);
			}),
		registry,
		"create",
	);

	const dropChanges = refineWithinKindGroups(
		rawChanges
			.filter((change) => change.operation === "drop")
			.sort((a, b) => {
				const rankDelta = rankOf(b.kind) - rankOf(a.kind);
				if (rankDelta !== 0) {
					return rankDelta;
				}
				return compareKeys(a.identity, b.identity);
			}),
		registry,
		"drop",
	);

	return [...createOrAlterChanges, ...dropChanges];
};

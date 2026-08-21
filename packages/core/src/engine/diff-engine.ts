import { throwHejbroError } from "../error";
import type { KindChange } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
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
			`snapshot object key "${key}" is missing a "kind:identity" separator.`,
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
				`kind "${kindName}" is part of a dependsOn cycle — check the dependsOn arrays of your registered kinds.`,
			);
		}
		const dependencies = dependsOnByKind.get(kindName);
		if (dependencies === undefined) {
			return throwHejbroError(
				"unknown-kind-dependency",
				`kind "${kindName}" is not registered, but another kind depends on it.`,
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
 * Diffs two snapshots into an ordered list of {@link KindChange}s.
 * Creates and alters are ordered by kind dependency order (topological
 * over `dependsOn`), sorted by identity (byte order) within a kind. Drops
 * are ordered in the reverse kind order, also sorted by identity.
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

	const rawChanges = allKeys.flatMap((key) => {
		const { kind: kindName, identity } = splitObjectKey(key);
		const kind = registry.get(kindName);
		const previousNode = lookupNode(previous.objects, key);
		const nextNode = lookupNode(next.objects, key);
		return kind.diff(previousNode, nextNode, identity);
	});

	const createOrAlterChanges = rawChanges
		.filter((change) => change.operation !== "drop")
		.sort((a, b) => {
			const rankDelta = rankOf(a.kind) - rankOf(b.kind);
			if (rankDelta !== 0) {
				return rankDelta;
			}
			return compareKeys(a.identity, b.identity);
		});

	const dropChanges = rawChanges
		.filter((change) => change.operation === "drop")
		.sort((a, b) => {
			const rankDelta = rankOf(b.kind) - rankOf(a.kind);
			if (rankDelta !== 0) {
				return rankDelta;
			}
			return compareKeys(a.identity, b.identity);
		});

	return [...createOrAlterChanges, ...dropChanges];
};

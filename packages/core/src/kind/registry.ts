import { hejbroError } from "../error";
import { enumKind } from "../kinds/enum-kind";
import { functionKind } from "../kinds/function-kind";
import { grantKind } from "../kinds/grant-kind";
import { policyKind } from "../kinds/policy-kind";
import { rlsKind } from "../kinds/rls-kind";
import { schemaKind } from "../kinds/schema-kind";
import { tableKind } from "../kinds/table-kind";
import { triggerKind } from "../kinds/trigger-kind";
import { viewKind } from "../kinds/view-kind";
import type { HejbroDeclaration, ObjectKind } from "./object-kind";

/**
 * A kind as held by the registry: the declaration type is erased at
 * storage (a registry is heterogeneous across kinds), so `owns` narrows to
 * `boolean` here instead of a type predicate. Individual kind objects
 * (e.g. `schemaKind`, `tableKind`) still expose the full type-predicate
 * `owns` from {@link ObjectKind} when used directly.
 */
export type RegisteredObjectKind = Omit<
	ObjectKind<HejbroDeclaration>,
	"owns"
> & {
	owns(declaration: HejbroDeclaration): boolean;
};

/** A registry of {@link ObjectKind}s, keyed by their `kind` name. */
export type KindRegistry = {
	readonly register: <TDeclaration extends HejbroDeclaration>(
		kind: ObjectKind<TDeclaration>,
	) => void;
	readonly get: (kindName: string) => RegisteredObjectKind;
	readonly list: () => ReadonlyArray<RegisteredObjectKind>;
};

/**
 * The kind objects `createDefaultRegistry` registers, held as one array so
 * {@link CORE_KIND_IDS} is *derived* from the same source that registers
 * them (D73, #196) rather than hand-maintained alongside it — a future core
 * kind is added here once, and both the registry and the id set pick it up
 * together. `packages/core/test/naming-conventions.test.ts` also asserts
 * this array's ids equal `createDefaultRegistry().list()`'s, so drift
 * between "what's in this array" and "what actually gets registered" (the
 * only way the two could still separate, since both already read from it)
 * fails loudly.
 */
const CORE_KINDS: ReadonlyArray<ObjectKind<HejbroDeclaration>> = [
	schemaKind,
	enumKind,
	tableKind,
	functionKind,
	triggerKind,
	rlsKind,
	policyKind,
	viewKind,
	grantKind,
];

/**
 * Every kind id core itself owns, as of *this build* — not "every kind id
 * core will ever own". Used only to rule out one `unknown-kind` cause: a
 * name in this set that isn't registered in the current {@link KindRegistry}
 * means this registry was built without one of core's own kinds (a
 * hand-rolled registry that skipped a `register()` call — see
 * {@link createKindRegistry}), never a missing preset or a newer hejbro,
 * since this build already knows the name. A name *not* in this set is not
 * thereby known to be preset-owned: it's equally consistent with "a core
 * kind added after this build shipped" (D73's motivating case, #193's
 * `sequence`) and "a preset that isn't registered" — this build cannot
 * tell those apart, so `unknownKindMessage` states both rather than
 * guessing from the name's shape (a hyphen/prefix heuristic was tried and
 * rejected: the one real preset kind, `supabase-storage-bucket`, is a
 * sample of one, nothing enforces the convention on a *user's own* preset,
 * and a wrong guess reproduces this exact issue's bug in a new shape).
 */
export const CORE_KIND_IDS: ReadonlySet<string> = new Set(
	CORE_KINDS.map((kind) => kind.kind),
);

/**
 * `unknown-kind` for a name in {@link CORE_KIND_IDS} that this particular
 * registry doesn't have registered — this build knows the kind, so neither
 * "upgrade hejbro" nor "register a preset" applies; the registry itself was
 * built incomplete.
 */
const missingCoreRegistrationMessage = (kindName: string): string =>
	`no kind named "${kindName}" is registered, even though it's one of hejbro's own built-in kinds — this registry was built without registering it. Next: if you built this registry by hand with createKindRegistry(), register every core kind you need (or start from createDefaultRegistry() instead, which registers them all).`;

/**
 * `unknown-kind` for a name outside {@link CORE_KIND_IDS} — this build has
 * never heard of it, for one of two reasons it cannot tell apart from the
 * name alone: **(1)** the snapshot was written by a newer hejbro that added
 * this kind after this build shipped (a core kind needs no `formatVersion`
 * bump to be added, D68/D73, so `parseSnapshot` sees nothing wrong — the
 * gap only surfaces here, once diffing actually needs the kind); or
 * **(2)** a preset that provides it isn't registered. States both, in that
 * order, rather than guessing (D73, #196 — see {@link CORE_KIND_IDS}'s own
 * comment for why a name-shape guess was rejected).
 */
const ambiguousUnknownKindMessage = (kindName: string): string =>
	`no kind named "${kindName}" is registered. This has two possible causes: (1) this snapshot was written by a newer hejbro that added "${kindName}" as one of its own kinds, and this build predates it; or (2) "${kindName}" is provided by a preset that isn't registered here. Next: check your hejbro version against whatever generated this snapshot and upgrade if it's older, and check hejbro.config.ts's presets array for a preset that provides "${kindName}" if one exists.`;

/** Picks between {@link missingCoreRegistrationMessage} and {@link ambiguousUnknownKindMessage} by {@link CORE_KIND_IDS} membership (D73, #196). */
const unknownKindMessage = (kindName: string): string => {
	if (CORE_KIND_IDS.has(kindName)) {
		return missingCoreRegistrationMessage(kindName);
	}
	return ambiguousUnknownKindMessage(kindName);
};

/**
 * Creates an empty {@link KindRegistry}. Mutation is confined to the `Map`
 * captured in this closure — no exported `let`.
 */
export const createKindRegistry = (): KindRegistry => {
	const kinds = new Map<string, RegisteredObjectKind>();

	const register = <TDeclaration extends HejbroDeclaration>(
		kind: ObjectKind<TDeclaration>,
	): void => {
		if (kinds.has(kind.kind)) {
			throw hejbroError(
				"duplicate-kind",
				`kind "${kind.kind}" is already registered. Next: remove one of the presets that register a kind named "${kind.kind}" from your presets array in hejbro.config.ts, or if you're authoring a preset, prefix your kind names to avoid colliding with others.`,
			);
		}
		kinds.set(kind.kind, kind);
	};

	const get = (kindName: string): RegisteredObjectKind => {
		const found = kinds.get(kindName);
		if (found === undefined) {
			throw hejbroError("unknown-kind", unknownKindMessage(kindName));
		}
		return found;
	};

	const list = (): ReadonlyArray<RegisteredObjectKind> =>
		Array.from(kinds.values());

	return { register, get, list };
};

/**
 * Creates a {@link KindRegistry} pre-registered with hejbro's built-in
 * object kinds: schema, enum, table, function, trigger, rls, policy,
 * view, and grant.
 */
export const createDefaultRegistry = (): KindRegistry => {
	const registry = createKindRegistry();
	CORE_KINDS.forEach((kind) => {
		registry.register(kind);
	});
	return registry;
};

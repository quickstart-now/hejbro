import { hejbroError } from "../error";
import { enumKind } from "../kinds/enum-kind";
import { functionKind } from "../kinds/function-kind";
import { grantKind } from "../kinds/grant-kind";
import { policyKind } from "../kinds/policy-kind";
import { rlsKind } from "../kinds/rls-kind";
import { schemaKind } from "../kinds/schema-kind";
import { sequenceKind } from "../kinds/sequence-kind";
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
	sequenceKind,
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
 * core will ever own". One meaning ("is this one of core's own kind
 * ids"), consulted from two places below; this set itself only ever
 * changes when core's own kind list does, regardless of how many places
 * read it.
 *
 * **`unknown-kind`** (`unknownKindMessage`): rules out one cause for
 * certain. A name in this set that isn't registered in the current
 * {@link KindRegistry} means this registry was built without one of
 * core's own kinds (a hand-rolled registry that skipped a `register()`
 * call — see {@link createKindRegistry}), never a missing preset or a
 * newer hejbro, since this build already knows the name. A name *not* in
 * this set is not thereby known to be preset-owned: it's equally
 * consistent with "a core kind added after this build shipped" (D73's
 * motivating case, #193's `sequence`) and "a preset that isn't
 * registered" — this build cannot tell those apart, so
 * `unknownKindMessage` states both rather than guessing from the name's
 * shape (a hyphen/prefix heuristic was tried and rejected: the one real
 * preset kind, `supabase-storage-bucket`, is a sample of one, nothing
 * enforces the convention on a *user's own* preset, and a wrong guess
 * reproduces this exact issue's bug in a new shape) — and that shape
 * guess wouldn't just be *unreliable today*, it would be *wrong by
 * design* the moment core needs it: `.claude/rules/naming.md` Rule 2
 * (D57) requires every snapshot identity token, kind ids included, to be
 * kebab-case, so a multi-word core kind id **must** itself carry a hyphen
 * (`materialized-view` is the standing example) — that isn't a
 * convention someone forgot to follow, it's the shape D57 mandates. The
 * first three reasons above are all "this could go wrong"; this one is
 * "this is guaranteed to go wrong, the day core has a two-word kind
 * name".
 *
 * **`register()`'s namespace-prefix requirement** (#201, below): exempts
 * every kind `createDefaultRegistry` itself registers from needing a
 * prefix — the same "is this core's own" question, just asked about one
 * kind object at registration time rather than about an unregistered
 * name at lookup time. See {@link hasNamespacePrefix}'s own comment for
 * what this exemption does and does not buy.
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
 * Does `kindName` carry a namespace prefix (a hyphen)? `register()` (below)
 * enforces this for every kind id outside {@link CORE_KIND_IDS}
 * (`preset-kind-needs-prefix`, #201) — `register()`'s own `duplicate-kind`
 * message already told preset authors to do this, but only a name
 * *collision* ever surfaced it; this makes it visible every time, at the
 * point a preset first registers its kind. `@hejbro/supabase`'s own kind,
 * `supabase-storage-bucket`, already satisfies it.
 *
 * **What this buys, and what it deliberately does not**: predictable
 * preset kind ids and an earlier, clearer registration-time error — never
 * a sound core-vs-preset *classification* for `unknown-kind` (above).
 * Enforcing this makes "has a prefix ⇒ preset" a real guarantee, but the
 * reverse, "no prefix ⇒ core", can never be enforced the same way:
 * `CORE_KIND_IDS`'s own comment explains why (D57 Rule 2 requires kind
 * ids, as snapshot identity tokens, to be kebab-case, so a future
 * multi-word *core* kind id — `materialized-view` is the standing
 * example — would legitimately carry a hyphen too). A guarantee sound in
 * only one direction cannot be inverted into a classifier for the other,
 * which is exactly why `unknownKindMessage` above states both possible
 * causes instead of picking one from this shape.
 */
const hasNamespacePrefix = (kindName: string): boolean =>
	kindName.includes("-");

/**
 * `preset-kind-needs-prefix`: a non-core kind id with no namespace prefix.
 * `register()`'s pre-existing `duplicate-kind` message already told
 * preset authors to prefix their kind names to avoid colliding with core
 * or another preset — this makes that guidance a registration-time error
 * instead of something only visible after a collision already happened.
 */
const missingNamespacePrefixMessage = (kindName: string): string =>
	`kind "${kindName}" has no namespace prefix — every preset-provided kind needs one, to avoid colliding with core's own vocabulary or another preset's (hejbro's built-in kinds are exempt from this check). Next: rename it to something like "<your-preset-name>-${kindName}".`;

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
		if (!CORE_KIND_IDS.has(kind.kind) && !hasNamespacePrefix(kind.kind)) {
			throw hejbroError(
				"preset-kind-needs-prefix",
				missingNamespacePrefixMessage(kind.kind),
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
 * object kinds: schema, enum, sequence, table, function, trigger, rls,
 * policy, view, and grant.
 */
export const createDefaultRegistry = (): KindRegistry => {
	const registry = createKindRegistry();
	CORE_KINDS.forEach((kind) => {
		registry.register(kind);
	});
	return registry;
};

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
 * A rough classification of an *unregistered* kind id, used only to choose
 * the right `unknown-kind` message (D73, #196). It cannot be a lookup
 * against a known-names list — the whole point is telling apart a name
 * this build has never heard of because it's newer than this build (a
 * future core kind) from one it's never heard of because nothing
 * registered it (a preset the user hasn't added). Neither name is in any
 * list this build can hold.
 *
 * The proxy: every core-owned kind id today is a single bare lowercase
 * word (`schema`, `table`, `trigger`, `rls`, `policy`, ...; `#193`'s
 * `sequence` keeps the pattern). Every preset-owned kind id carries a
 * namespace prefix joined by a hyphen (`supabase-storage-bucket`) —
 * `register()`'s own `duplicate-kind` message already tells preset authors
 * to do exactly that, to avoid colliding with another preset or with core.
 * A hyphen is therefore evidence the id was *meant* to be preset-owned;
 * its absence is evidence it belongs to core's own, still-growing
 * vocabulary. This can misclassify a hypothetical future multi-word core
 * kind id (none exists today, so there's nothing to test it against) or a
 * preset author who skips the prefix despite the guidance — a heuristic
 * over the *shape* of a name that was never registered, not a proof.
 */
const looksLikePresetShapedKindName = (kindName: string): boolean =>
	kindName.includes("-");

/**
 * `unknown-kind` for a kind id shaped like core's own vocabulary (no
 * namespace prefix) — most likely a kind this build predates, not a
 * missing preset. Mirrors {@link newerVersionMessage}'s
 * (`snapshot/snapshot.ts`) wording for the structurally identical
 * "this file is newer than this build" case, one level down: that one
 * fires when the snapshot's `formatVersion` itself is too new; this one
 * fires when an individual *kind id* inside an otherwise-current-version
 * snapshot is one this build has never registered (#193/#23: a new core
 * kind needs no `formatVersion` bump, D68, so `parseSnapshot` sees nothing
 * wrong — the mismatch only surfaces here, once diffing actually needs
 * the kind).
 */
const unknownCoreShapedKindMessage = (kindName: string): string =>
	`no kind named "${kindName}" is registered — its name has no preset namespace prefix, which is how every hejbro-owned kind is spelled ("table", "trigger", "rls", ...), so this snapshot was likely written by a newer hejbro than the one reading it, one that knows a kind this build doesn't. Next: upgrade hejbro to a version that supports "${kindName}" and try again.`;

/** `unknown-kind` for a kind id shaped like a preset's (namespace-prefixed) — the original, still-correct advice for a preset the user hasn't registered. */
const unknownPresetShapedKindMessage = (kindName: string): string =>
	`no kind named "${kindName}" is registered. Next: check the spelling, or register the preset that provides it in hejbro.config.ts's presets array.`;

/** Picks between {@link unknownCoreShapedKindMessage} and {@link unknownPresetShapedKindMessage} by {@link looksLikePresetShapedKindName} (D73, #196). */
const unknownKindMessage = (kindName: string): string => {
	if (looksLikePresetShapedKindName(kindName)) {
		return unknownPresetShapedKindMessage(kindName);
	}
	return unknownCoreShapedKindMessage(kindName);
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
	registry.register(schemaKind);
	registry.register(enumKind);
	registry.register(tableKind);
	registry.register(functionKind);
	registry.register(triggerKind);
	registry.register(rlsKind);
	registry.register(policyKind);
	registry.register(viewKind);
	registry.register(grantKind);
	return registry;
};

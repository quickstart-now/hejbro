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
			throw hejbroError(
				"unknown-kind",
				`no kind named "${kindName}" is registered. Next: check the spelling, or register the preset that provides it in hejbro.config.ts's presets array.`,
			);
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

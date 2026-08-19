import { hejbroError } from "../error";
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
				`kind "${kind.kind}" is already registered — presets must register kinds under unique, prefixed names.`,
			);
		}
		kinds.set(kind.kind, kind);
	};

	const get = (kindName: string): RegisteredObjectKind => {
		const found = kinds.get(kindName);
		if (found === undefined) {
			throw hejbroError(
				"unknown-kind",
				`no kind named "${kindName}" is registered — check the spelling, or register the preset that provides it.`,
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
 * object kinds. Empty for now — kinds are added as later tasks land
 * (schema/enum in Task 9, table in Tasks 10–11).
 */
export const createDefaultRegistry = (): KindRegistry => createKindRegistry();

import type { HejbroDeclaration, ObjectKind } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
import type { Validator } from "./validate";

/**
 * A provider preset: a named bundle of extension kinds and validators,
 * listed in `hejbro.config.ts`'s `presets: []` (D55). `kinds` carries the
 * erased `ObjectKind<HejbroDeclaration>` form — a preset casts its typed
 * kind once when building this object (sanctioned, like `roleName()`'s
 * `as Role`), since a registry is heterogeneous across kinds.
 */
export type Preset = {
	readonly name: string;
	readonly kinds: ReadonlyArray<ObjectKind<HejbroDeclaration>>;
	readonly validators: ReadonlyArray<Validator>;
};

/**
 * Registers every kind of every preset into `registry`, in preset then
 * kind order. A kind name already registered — by core's built-ins or an
 * earlier preset — surfaces the registry's existing `duplicate-kind`
 * error; presets must register kinds under unique, prefixed names.
 */
export const registerPresets = (
	registry: KindRegistry,
	presets: ReadonlyArray<Preset>,
): void => {
	presets
		.flatMap((preset) => preset.kinds)
		.map((kind) => registry.register(kind));
};

/** Flattens every preset's validators, in preset order. */
export const presetValidators = (
	presets: ReadonlyArray<Preset>,
): ReadonlyArray<Validator> => presets.flatMap((preset) => preset.validators);

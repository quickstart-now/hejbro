import type { KindRegistry, Validator } from "@hejbro/core";
import {
	createDefaultRegistry,
	presetValidators,
	registerPresets,
} from "@hejbro/core";
import type { HejbroConfig } from "./config";

/** Builds a kind registry with every built-in kind plus every kind from `config.presets` (D55). */
export const buildRegistry = (config: HejbroConfig): KindRegistry => {
	const registry = createDefaultRegistry();
	registerPresets(registry, config.presets);
	return registry;
};

/** Flattens every validator from `config.presets`, in preset order (D55). */
export const configValidators = (
	config: HejbroConfig,
): ReadonlyArray<Validator> => presetValidators(config.presets);

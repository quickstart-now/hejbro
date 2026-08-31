import {
	createKindRegistry,
	presetValidators,
	registerPresets,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { nilePreset } from "../src/index";

describe("nilePreset is a registrable bundle from the public entry (task 1.2, #563)", () => {
	it("carries the shape a Preset must -- name, kinds, validators -- both arrays present and empty until group 4 populates them", () => {
		expect(nilePreset.name).toBe("nile");
		expect(nilePreset.kinds).toEqual([]);
		expect(nilePreset.validators).toEqual([]);
	});

	it("registerPresets accepts it against a real registry without throwing -- a usable Preset value, not a placeholder shape", () => {
		const registry = createKindRegistry();
		expect(() => registerPresets(registry, [nilePreset])).not.toThrow();
	});

	it("presetValidators flattens it to zero validators, the honest state before group 4", () => {
		expect(presetValidators([nilePreset])).toEqual([]);
	});
});

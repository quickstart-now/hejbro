import {
	createKindRegistry,
	presetValidators,
	registerPresets,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { nilePreset } from "../src/index";

describe("nilePreset is a registrable bundle from the public entry (task 1.2/4.1-4.4, #563/#566, plus a fifth validator added after G5's live-witness measurement, #567)", () => {
	it("carries the shape a Preset must -- name, kinds (still empty, task 1.2's own scope), validators (populated additively by group 4, again after G5, and a sixth after #573)", () => {
		expect(nilePreset.name).toBe("nile");
		expect(nilePreset.kinds).toEqual([]);
		expect(nilePreset.validators).toHaveLength(6);
	});

	it("registerPresets accepts it against a real registry without throwing -- a usable Preset value, not a placeholder shape", () => {
		const registry = createKindRegistry();
		expect(() => registerPresets(registry, [nilePreset])).not.toThrow();
	});

	it("presetValidators flattens it to the six platform-refusal validators the preset carries", () => {
		expect(presetValidators([nilePreset])).toHaveLength(6);
	});
});

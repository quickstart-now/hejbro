import { describe, expect, it } from "vitest";
import type { Preset } from "../src/engine/preset";
import { presetValidators, registerPresets } from "../src/engine/preset";
import type { Validator } from "../src/engine/validate";
import { diagnostic } from "../src/engine/validate";
import type { HejbroDeclaration, ObjectKind } from "../src/kind/object-kind";
import { createDefaultRegistry } from "../src/kind/registry";

/** A toy declaration mirroring `examples/preset-smoke`'s `smoke-schema-note` shape, kept minimal and inline so core's tests never import from `examples/`. */
type ToyNoteDeclaration = {
	readonly declarationKind: "toy-note";
	readonly schemaName: string;
};

const toyNoteKind: ObjectKind<ToyNoteDeclaration> = {
	kind: "toy-note",
	dependsOn: [],
	owns: (declaration): declaration is ToyNoteDeclaration =>
		declaration.declarationKind === "toy-note",
	serialize: (declaration) => ({ schemaName: declaration.schemaName }),
	identify: (snapshot) =>
		(snapshot as { readonly schemaName: string }).schemaName,
	diff: () => [],
	emit: () => [],
};

const toyValidator: Validator = () => [
	diagnostic("warning", "toy-warning", "a toy warning."),
];

const toyPreset: Preset = {
	name: "toy",
	kinds: [toyNoteKind as ObjectKind<HejbroDeclaration>],
	validators: [toyValidator],
};

describe("registerPresets", () => {
	it("registers every preset's kinds into the registry", () => {
		const registry = createDefaultRegistry();
		registerPresets(registry, [toyPreset]);
		expect(registry.get("toy-note").kind).toBe("toy-note");
	});

	it("throws duplicate-kind when the same preset is registered twice", () => {
		const registry = createDefaultRegistry();
		registerPresets(registry, [toyPreset]);
		expect(() => registerPresets(registry, [toyPreset])).toThrowError(
			expect.objectContaining({ code: "duplicate-kind" }),
		);
	});
});

describe("presetValidators", () => {
	it("flattens every preset's validators in preset order", () => {
		expect(presetValidators([toyPreset])).toEqual([toyValidator]);
	});
});

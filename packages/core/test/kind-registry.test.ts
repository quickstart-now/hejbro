import { describe, expect, it } from "vitest";
import type { HejbroDeclaration, ObjectKind } from "../src/kind/object-kind";
import { createKindRegistry } from "../src/kind/registry";

const toyKind = {
	kind: "toy",
	dependsOn: [],
	owns: (d: { declarationKind: string }): d is { declarationKind: string } =>
		d.declarationKind === "toy",
	serialize: () => ({ name: "toy" }),
	identify: () => "toy",
	diff: () => [],
	emit: () => [],
};

describe("kind registry", () => {
	it("registers and retrieves kinds", () => {
		const registry = createKindRegistry();
		registry.register(toyKind);
		expect(registry.get("toy").kind).toBe("toy");
	});
	it("rejects duplicate kind names", () => {
		const registry = createKindRegistry();
		registry.register(toyKind);
		expect(() => registry.register(toyKind)).toThrowError(
			/already registered/i,
		);
	});
	it("throws an actionable error for unknown kinds", () => {
		expect(() => createKindRegistry().get("nope")).toThrowError(
			/no kind named "nope"/i,
		);
	});
});

type BlockDeclaration = {
	readonly declarationKind: "block";
	readonly blockName: string;
};

const blockKind: ObjectKind<BlockDeclaration> = {
	kind: "block",
	dependsOn: [],
	owns: (d): d is BlockDeclaration => d.declarationKind === "block",
	serialize: (d) => ({ blockName: d.blockName }),
	identify: (snapshot) => (snapshot as { blockName: string }).blockName,
	diff: () => [],
	emit: () => [],
};

describe("ObjectKind type-predicate narrowing", () => {
	it("narrows to the concrete declaration type when a kind is used directly (not erased through the registry)", () => {
		const blockDeclaration: BlockDeclaration = {
			declarationKind: "block",
			blockName: "wood",
		};
		const declaration: HejbroDeclaration = blockDeclaration;
		if (blockKind.owns(declaration)) {
			expect(declaration.blockName).toBe("wood");
			return;
		}
		throw new Error("expected blockKind to own the declaration");
	});
});

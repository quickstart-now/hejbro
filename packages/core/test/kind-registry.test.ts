import { describe, expect, it } from "vitest";
import type { HejbroDeclaration, ObjectKind } from "../src/kind/object-kind";
import {
	CORE_KIND_IDS,
	createDefaultRegistry,
	createKindRegistry,
} from "../src/kind/registry";

const toyKind = {
	kind: "toy-note",
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
		expect(registry.get("toy-note").kind).toBe("toy-note");
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

describe("register(): a preset-channel kind id needs a namespace prefix (#201)", () => {
	it("rejects a non-core kind id with no prefix", () => {
		const unprefixed = { ...toyKind, kind: "note" };
		const message = messageOf(() => createKindRegistry().register(unprefixed));
		expect(message).toMatch(/no namespace prefix/i);
		expect(message).toMatch(/rename it/i);
	});

	it("accepts a properly namespaced kind id", () => {
		expect(() => createKindRegistry().register(toyKind)).not.toThrow(); // "toy-note"
	});

	it("exempts every kind createDefaultRegistry() itself registers, none of which are prefixed", () => {
		expect(() => createDefaultRegistry()).not.toThrow();
	});

	it("passes for @hejbro/supabase's real kind, which is already prefixed", () => {
		const registry = createKindRegistry();
		expect(() =>
			registry.register({ ...toyKind, kind: "supabase-storage-bucket" }),
		).not.toThrow();
	});
});

/** `(fn's thrown error).message`, for asserting on message content without a nested try/catch per test. */
const messageOf = (fn: () => unknown): string => {
	try {
		fn();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("expected fn to throw");
};

describe("unknown-kind: registration gap vs genuinely-unknown name (D73, #196)", () => {
	it("a core kind id this registry never registered says the registry was built incomplete, not 'upgrade' or 'a preset'", () => {
		// "table" is in CORE_KIND_IDS, but this bare createKindRegistry() never
		// registered it -- the one case this build CAN be sure of: it knows
		// the name, so the gap is this registry's own construction, not a
		// version mismatch or a missing preset.
		expect(CORE_KIND_IDS.has("table")).toBe(true);
		const message = messageOf(() => createKindRegistry().get("table"));
		expect(message).toMatch(/built without registering it/i);
		expect(message).not.toMatch(/newer hejbro/i);
		expect(message).not.toMatch(/preset/i);
	});

	it("a name outside CORE_KIND_IDS states both possible causes, never guesses one (a future core kind)", () => {
		expect(CORE_KIND_IDS.has("sequence")).toBe(false);
		const message = messageOf(() => createDefaultRegistry().get("sequence"));
		expect(message).toMatch(/newer hejbro/i);
		expect(message).toMatch(/preset/i);
	});

	it("a name outside CORE_KIND_IDS states both possible causes, never guesses one (a preset kind)", () => {
		expect(CORE_KIND_IDS.has("supabase-storage-bucket")).toBe(false);
		const message = messageOf(() =>
			createDefaultRegistry().get("supabase-storage-bucket"),
		);
		expect(message).toMatch(/newer hejbro/i);
		expect(message).toMatch(/preset/i);
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

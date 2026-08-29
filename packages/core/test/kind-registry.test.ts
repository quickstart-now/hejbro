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
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
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
		// "materialized-view" -- CORE_KIND_IDS's own doc comment uses this as
		// its standing example of a not-yet-added core kind (#23's "sequence"
		// filled that role until it actually landed, in this same PR).
		expect(CORE_KIND_IDS.has("materialized-view")).toBe(false);
		const message = messageOf(() =>
			createDefaultRegistry().get("materialized-view"),
		);
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

/** A kind whose declared objects have no catalog counterpart at all -- mirrors `@hejbro/supabase`'s real storage-bucket kind (#482), a row the Storage API owns rather than this database's own migrations. */
const catalogLessKind: ObjectKind<BlockDeclaration> = {
	...blockKind,
	kind: "catalog-less-block",
	noCatalogObjectReason:
		"a catalog-less-block is a row an external service owns, not this database's own migrations.",
};

describe("ObjectKind.noCatalogObjectReason (#482, task 2.1)", () => {
	it("a kind can declare that no catalog object backs it, with a reason", () => {
		expect(catalogLessKind.noCatalogObjectReason).toBe(
			"a catalog-less-block is a row an external service owns, not this database's own migrations.",
		);
	});

	it("is optional and additive -- a kind that never sets it is unaffected", () => {
		expect(blockKind.noCatalogObjectReason).toBeUndefined();
	});
});

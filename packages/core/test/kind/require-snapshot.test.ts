import { describe, expect, it } from "vitest";
import { HejbroError } from "../../src/error";
import {
	requireBoth,
	requireNext,
	requirePrevious,
} from "../../src/kind/emit-helpers";
import type {
	ChangeOperation,
	HejbroDeclaration,
	KindChange,
	ObjectKind,
} from "../../src/kind/object-kind";
import { enumKind } from "../../src/kinds/enum-kind";
import { functionKind } from "../../src/kinds/function-kind";
import { grantKind } from "../../src/kinds/grant-kind";
import { policyKind } from "../../src/kinds/policy-kind";
import { rlsKind } from "../../src/kinds/rls-kind";
import { schemaKind } from "../../src/kinds/schema-kind";
import { sequenceKind } from "../../src/kinds/sequence-kind";
import { tableKind } from "../../src/kinds/table-kind";
import { triggerKind } from "../../src/kinds/trigger-kind";
import { viewKind } from "../../src/kinds/view-kind";

const change = (overrides: Partial<KindChange> = {}): KindChange => ({
	kind: "function",
	operation: "create",
	identity: "app.f",
	previous: null,
	next: null,
	notes: [],
	...overrides,
});

describe("requireNext/requirePrevious/requireBoth (#472)", () => {
	it("requireNext returns change.next unchanged when present", () => {
		const next = { schema: "app", name: "f" };
		expect(requireNext(change({ next }))).toBe(next);
	});

	it("requireNext throws the pinned message when next is null", () => {
		expect(() =>
			requireNext(change({ kind: "function", operation: "create" })),
		).toThrow("function create change is missing its next snapshot.");
	});

	it("requireNext throws a HejbroError coded invalid-kind-change", () => {
		try {
			requireNext(change({ kind: "view", operation: "alter" }));
			throw new Error("expected requireNext to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("invalid-kind-change");
			expect((error as HejbroError).message).toBe(
				"view alter change is missing its next snapshot.",
			);
		}
	});

	it("requirePrevious returns change.previous unchanged when present", () => {
		const previous = { schema: "app", name: "f" };
		expect(requirePrevious(change({ previous }))).toBe(previous);
	});

	it("requirePrevious throws the pinned message when previous is null", () => {
		expect(() =>
			requirePrevious(change({ kind: "function", operation: "drop" })),
		).toThrow("function drop change is missing its previous snapshot.");
	});

	it("requireBoth returns both snapshots unchanged when present", () => {
		const previous = { v: 1 };
		const next = { v: 2 };
		expect(requireBoth(change({ previous, next }))).toEqual({
			previous,
			next,
		});
	});

	it("requireBoth throws the combined pinned message when next is missing", () => {
		expect(() =>
			requireBoth(
				change({ kind: "enum", operation: "alter", previous: { v: 1 } }),
			),
		).toThrow("enum alter change is missing its previous or next snapshot.");
	});

	it("requireBoth throws the combined pinned message when previous is missing", () => {
		expect(() =>
			requireBoth(
				change({ kind: "table", operation: "alter", next: { v: 1 } }),
			),
		).toThrow("table alter change is missing its previous or next snapshot.");
	});

	it("requireBoth throws the combined pinned message when both are missing", () => {
		expect(() =>
			requireBoth(change({ kind: "enum", operation: "alter" })),
		).toThrow("enum alter change is missing its previous or next snapshot.");
	});
});

/**
 * Permanent ratchet for #472's group-1 output proof (tasks.md): every
 * registered kind × every operation × three nullity shapes, executed
 * through the kind's own public `.emit()` — not the guard's source text,
 * since trap 2 (tasks.md) proved two guards can read byte-identical and
 * still throw a different message depending on check order. Expected
 * values below are string literals captured by running this exact matrix
 * against the pre-refactor code at `e95a268` (measured 2026-08-30, see
 * PR body) — they do not derive from the helpers under test, so a
 * helper that silently changes wording, order, or which snapshot it
 * checks fails this file, not just a hand-picked example.
 */
type Nullity = "both-null" | "previous-only" | "next-only";

const OPERATIONS: ReadonlyArray<ChangeOperation> = ["create", "drop", "alter"];
const NULLITIES: ReadonlyArray<Nullity> = [
	"both-null",
	"previous-only",
	"next-only",
];

const KINDS: ReadonlyArray<{
	readonly name: string;
	readonly kind: ObjectKind<HejbroDeclaration>;
}> = [
	{ name: "enum", kind: enumKind },
	{ name: "function", kind: functionKind },
	{ name: "grant", kind: grantKind },
	{ name: "policy", kind: policyKind },
	{ name: "rls", kind: rlsKind },
	{ name: "schema", kind: schemaKind },
	{ name: "sequence", kind: sequenceKind },
	{ name: "table", kind: tableKind },
	{ name: "trigger", kind: triggerKind },
	{ name: "view", kind: viewKind },
];

// A non-null placeholder carrying no field any kind's emit path actually
// reads — so a cell that does NOT throw `invalid-kind-change` fails at
// this matrix's first real field access, the same way it does in
// production when a snapshot is malformed (#472 trap 2's "not all guards
// are symmetric" finding).
const dummySnapshot = {} as never;

type Expected =
	| {
			readonly type: "hejbro-error";
			readonly code: string;
			readonly message: string;
	  }
	| { readonly type: "type-error"; readonly message: string }
	| { readonly type: "ok" };

// 90 rows: 10 kinds × 3 operations × 3 nullity shapes. Each row's
// `Expected` is the literal, hand-captured outcome of running the matrix
// against `e95a268` — see the doc comment above.
const EXPECTATIONS: ReadonlyArray<
	readonly [string, ChangeOperation, Nullity, Expected]
> = [
	[
		"enum",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "enum create change is missing its next snapshot.",
		},
	],
	[
		"enum",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "enum create change is missing its next snapshot.",
		},
	],
	[
		"enum",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'map')",
		},
	],
	[
		"enum",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "enum drop change is missing its previous snapshot.",
		},
	],
	[
		"enum",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"enum",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "enum drop change is missing its previous snapshot.",
		},
	],
	[
		"enum",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "enum alter change is missing its previous or next snapshot.",
		},
	],
	[
		"enum",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "enum alter change is missing its previous or next snapshot.",
		},
	],
	[
		"enum",
		"alter",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "enum alter change is missing its previous or next snapshot.",
		},
	],
	[
		"function",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "function create change is missing its next snapshot.",
		},
	],
	[
		"function",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "function create change is missing its next snapshot.",
		},
	],
	["function", "create", "next-only", { type: "ok" }],
	[
		"function",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "function drop change is missing its previous snapshot.",
		},
	],
	[
		"function",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"function",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "function drop change is missing its previous snapshot.",
		},
	],
	[
		"function",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "function alter change is missing its next snapshot.",
		},
	],
	[
		"function",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "function alter change is missing its next snapshot.",
		},
	],
	["function", "alter", "next-only", { type: "ok" }],
	[
		"grant",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "grant create change is missing its next snapshot.",
		},
	],
	[
		"grant",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "grant create change is missing its next snapshot.",
		},
	],
	[
		"grant",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"grant",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "grant drop change is missing its previous snapshot.",
		},
	],
	[
		"grant",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"grant",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "grant drop change is missing its previous snapshot.",
		},
	],
	[
		"grant",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "grant alter change is missing its previous snapshot.",
		},
	],
	[
		"grant",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "grant alter change is missing its next snapshot.",
		},
	],
	[
		"grant",
		"alter",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "grant alter change is missing its previous snapshot.",
		},
	],
	[
		"policy",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "policy create change is missing its next snapshot.",
		},
	],
	[
		"policy",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "policy create change is missing its next snapshot.",
		},
	],
	[
		"policy",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"policy",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "policy drop change is missing its previous snapshot.",
		},
	],
	[
		"policy",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"policy",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "policy drop change is missing its previous snapshot.",
		},
	],
	[
		"policy",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "policy alter change is missing its next snapshot.",
		},
	],
	[
		"policy",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "policy alter change is missing its next snapshot.",
		},
	],
	[
		"policy",
		"alter",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"rls",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "rls create change is missing its next snapshot.",
		},
	],
	[
		"rls",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "rls create change is missing its next snapshot.",
		},
	],
	[
		"rls",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"rls",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "rls drop change is missing its previous snapshot.",
		},
	],
	[
		"rls",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"rls",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "rls drop change is missing its previous snapshot.",
		},
	],
	[
		"rls",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "rls alter change is missing its next snapshot.",
		},
	],
	[
		"rls",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "rls alter change is missing its next snapshot.",
		},
	],
	[
		"rls",
		"alter",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"schema",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "schema create change is missing its next snapshot.",
		},
	],
	[
		"schema",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "schema create change is missing its next snapshot.",
		},
	],
	[
		"schema",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"schema",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "schema drop change is missing its previous snapshot.",
		},
	],
	[
		"schema",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"schema",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "schema drop change is missing its previous snapshot.",
		},
	],
	[
		"schema",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "unsupported-operation",
			message:
				"schema kind never alters — this indicates an internal hejbro bug in diff().",
		},
	],
	[
		"schema",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "unsupported-operation",
			message:
				"schema kind never alters — this indicates an internal hejbro bug in diff().",
		},
	],
	[
		"schema",
		"alter",
		"next-only",
		{
			type: "hejbro-error",
			code: "unsupported-operation",
			message:
				"schema kind never alters — this indicates an internal hejbro bug in diff().",
		},
	],
	[
		"sequence",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "sequence create change is missing its next snapshot.",
		},
	],
	[
		"sequence",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "sequence create change is missing its next snapshot.",
		},
	],
	[
		"sequence",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"sequence",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "sequence drop change is missing its previous snapshot.",
		},
	],
	[
		"sequence",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"sequence",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "sequence drop change is missing its previous snapshot.",
		},
	],
	[
		"sequence",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "sequence alter change is missing its next snapshot.",
		},
	],
	[
		"sequence",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "sequence alter change is missing its next snapshot.",
		},
	],
	[
		"sequence",
		"alter",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"table",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "table create change is missing its next snapshot.",
		},
	],
	[
		"table",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "table create change is missing its next snapshot.",
		},
	],
	[
		"table",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'map')",
		},
	],
	[
		"table",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "table drop change is missing its previous snapshot.",
		},
	],
	[
		"table",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"table",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "table drop change is missing its previous snapshot.",
		},
	],
	[
		"table",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "table alter change is missing its previous or next snapshot.",
		},
	],
	[
		"table",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "table alter change is missing its previous or next snapshot.",
		},
	],
	[
		"table",
		"alter",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "table alter change is missing its previous or next snapshot.",
		},
	],
	[
		"trigger",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "trigger create change is missing its next snapshot.",
		},
	],
	[
		"trigger",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "trigger create change is missing its next snapshot.",
		},
	],
	[
		"trigger",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"trigger",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "trigger drop change is missing its previous snapshot.",
		},
	],
	[
		"trigger",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"trigger",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "trigger drop change is missing its previous snapshot.",
		},
	],
	[
		"trigger",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "trigger alter change is missing its next snapshot.",
		},
	],
	[
		"trigger",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "trigger alter change is missing its next snapshot.",
		},
	],
	[
		"trigger",
		"alter",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"view",
		"create",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "view create change is missing its next snapshot.",
		},
	],
	[
		"view",
		"create",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "view create change is missing its next snapshot.",
		},
	],
	[
		"view",
		"create",
		"next-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"view",
		"drop",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "view drop change is missing its previous snapshot.",
		},
	],
	[
		"view",
		"drop",
		"previous-only",
		{
			type: "type-error",
			message: "Cannot read properties of undefined (reading 'length')",
		},
	],
	[
		"view",
		"drop",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "view drop change is missing its previous snapshot.",
		},
	],
	[
		"view",
		"alter",
		"both-null",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "view alter change is missing its next snapshot.",
		},
	],
	[
		"view",
		"alter",
		"previous-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "view alter change is missing its next snapshot.",
		},
	],
	[
		"view",
		"alter",
		"next-only",
		{
			type: "hejbro-error",
			code: "invalid-kind-change",
			message: "view alter change is missing its previous snapshot.",
		},
	],
];

describe("full axis: every kind × every operation × every nullity shape (#472 group-1 baseline)", () => {
	it("has exactly 90 rows — 10 kinds × 3 operations × 3 nullities", () => {
		expect(EXPECTATIONS.length).toBe(90);
		expect(KINDS.length).toBe(10);
		expect(OPERATIONS.length).toBe(3);
		expect(NULLITIES.length).toBe(3);
	});

	it("covers exactly 31 distinct invalid-kind-change messages across 62 rows", () => {
		const invalidKindChangeRows = EXPECTATIONS.filter(
			([, , , expected]) =>
				expected.type === "hejbro-error" &&
				expected.code === "invalid-kind-change",
		);
		expect(invalidKindChangeRows.length).toBe(62);
		const distinctMessages = new Set(
			invalidKindChangeRows.map(([, , , expected]) => {
				if (expected.type !== "hejbro-error") {
					throw new Error("unreachable: filtered to hejbro-error rows above");
				}
				return expected.message;
			}),
		);
		expect(distinctMessages.size).toBe(31);
	});

	const previousFor = (nullity: Nullity): KindChange["previous"] => {
		if (nullity === "previous-only") {
			return dummySnapshot;
		}
		return null;
	};
	const nextFor = (nullity: Nullity): KindChange["next"] => {
		if (nullity === "next-only") {
			return dummySnapshot;
		}
		return null;
	};

	EXPECTATIONS.forEach(([kindName, operation, nullity, expected]) => {
		it(`${kindName} ${operation} ${nullity} → ${expected.type}`, () => {
			const kindEntry = KINDS.find((entry) => entry.name === kindName);
			if (kindEntry === undefined) {
				throw new Error(`no probe registered for kind "${kindName}"`);
			}
			const probeChange = change({
				kind: kindName,
				operation,
				previous: previousFor(nullity),
				next: nextFor(nullity),
			});
			try {
				const result = kindEntry.kind.emit(probeChange, [], undefined);
				if (expected.type !== "ok") {
					throw new Error(
						`expected a throw (${expected.type}) but emit returned ${JSON.stringify(result)}`,
					);
				}
			} catch (error) {
				if (expected.type === "ok") {
					throw error;
				}
				if (expected.type === "hejbro-error") {
					expect(error).toBeInstanceOf(HejbroError);
					expect((error as HejbroError).code).toBe(expected.code);
					expect((error as HejbroError).message).toBe(expected.message);
				} else {
					expect(error).toBeInstanceOf(TypeError);
					expect((error as TypeError).message).toBe(expected.message);
				}
			}
		});
	});
});

/**
 * Trap 2's four load-bearing sites, called out explicitly (not just buried
 * in the 90-row loop above): a both-null input's thrown message differs by
 * site because two guard *styles* coexist (combined vs. sequential) and,
 * among the sequential sites, the check *order* is opposite. Harmonizing
 * either dimension changes one of these four strings.
 */
describe("trap 2: both-null message differs by site (style and order are load-bearing)", () => {
	it("grant alter (sequential, previous-first): both-null throws the previous message", () => {
		expect(() =>
			grantKind.emit(change({ kind: "grant", operation: "alter" })),
		).toThrow("grant alter change is missing its previous snapshot.");
	});

	it("view alter (sequential, next-first): both-null throws the next message", () => {
		expect(() =>
			viewKind.emit(change({ kind: "view", operation: "alter" })),
		).toThrow("view alter change is missing its next snapshot.");
	});

	it("enum alter (combined): both-null throws the combined message", () => {
		expect(() =>
			enumKind.emit(change({ kind: "enum", operation: "alter" })),
		).toThrow("enum alter change is missing its previous or next snapshot.");
	});

	it("table alter (combined): both-null throws the combined message", () => {
		expect(() =>
			tableKind.emit(
				change({ kind: "table", operation: "alter" }),
				[],
				undefined,
			),
		).toThrow("table alter change is missing its previous or next snapshot.");
	});
});

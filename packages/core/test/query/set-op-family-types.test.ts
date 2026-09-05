import { describe, expect, expectTypeOf, it } from "vitest";
import type { SqlTypeFamily } from "../../src/expr/type-family";
import { sqlTypeFamilies } from "../../src/expr/type-family";
import { setOpUnifiableFamilies } from "../../src/query/select";

type ConcreteFamily = Exclude<SqlTypeFamily, "unknown">;

// A family added to sqlTypeFamilies without a row must fail here, in both
// directions: a missing row and a ghost key outside sqlTypeFamilies.
type MissingRow = Exclude<ConcreteFamily, keyof typeof setOpUnifiableFamilies>;
type ExtraRow = Exclude<keyof typeof setOpUnifiableFamilies, ConcreteFamily>;

const concreteFamilies = sqlTypeFamilies.filter(
	(family): family is ConcreteFamily => family !== "unknown",
);

describe("setOpUnifiableFamilies enumerates every concrete family (task 1.1)", () => {
	it("has no concrete family missing a row", () => {
		expectTypeOf<MissingRow>().toBeNever();
	});

	it("has no row for a family outside sqlTypeFamilies", () => {
		expectTypeOf<ExtraRow>().toBeNever();
	});

	it("carries exactly one row per concrete family, no more and no fewer", () => {
		expect(Object.keys(setOpUnifiableFamilies)).toHaveLength(
			concreteFamilies.length,
		);
		expect(new Set(Object.keys(setOpUnifiableFamilies))).toEqual(
			new Set(concreteFamilies),
		);
	});

	it("every family unifies with itself", () => {
		// Each row's tuple keeps its own literal member type (future 1.2
		// folding needs that precision), so a union-keyed lookup here is
		// widened to the shape `satisfies` already proved it has.
		const table: Record<ConcreteFamily, readonly SqlTypeFamily[]> =
			setOpUnifiableFamilies;
		const selfIncluded = concreteFamilies.every((family) =>
			table[family].includes(family),
		);
		expect(selfIncluded).toBe(true);
	});
});

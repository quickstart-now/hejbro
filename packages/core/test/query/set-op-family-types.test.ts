import { describe, expect, expectTypeOf, it } from "vitest";
import type { SqlTypeFamily } from "../../src/expr/type-family";
import { sqlTypeFamilies } from "../../src/expr/type-family";
import type { Expr, SetOpResult } from "../../src/index";
import {
	bigint,
	eq,
	integer,
	isNull,
	schema,
	select,
	sql,
	table,
	text,
	uuid,
	withCte,
} from "../../src/index";
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

// Stated independently of setOpUnifiableFamilies so that mutating that
// table (503/R5's own mutation) reddens this instead of moving in step
// with it: measured in 1.1 -- two different concrete families never
// unify, and "unknown" matches anything on either side.
type ExpectedRefused<
	TLeft extends SqlTypeFamily,
	TRight extends SqlTypeFamily,
> = "unknown" extends TLeft
	? false
	: "unknown" extends TRight
		? false
		: [TLeft] extends [TRight]
			? false
			: true;

type ComputedRefused<
	TLeft extends SqlTypeFamily,
	TRight extends SqlTypeFamily,
> = [
	SetOpResult<{ readonly k: Expr<TLeft> }, { readonly k: Expr<TRight> }>,
] extends [never]
	? true
	: false;

// A homomorphic mapped type indexed by its own key union collects the
// union of its values (D110's own table-not-example shape at the type
// level): every one of the 11x11 ordered pairs is checked, and a
// mismatch surfaces as the offending `[left, right]` pair by name, not
// as a bare boolean.
type MatrixMismatch = {
	[L in SqlTypeFamily]: {
		[R in SqlTypeFamily]: [ComputedRefused<L, R>] extends [
			ExpectedRefused<L, R>,
		]
			? [ExpectedRefused<L, R>] extends [ComputedRefused<L, R>]
				? never
				: [L, R]
			: [L, R];
	}[SqlTypeFamily];
}[SqlTypeFamily];

describe("SetOpResult's family fold matches the 1.1 measurement on every pair (task 1.2a)", () => {
	it("no ordered family pair disagrees with the measured refused/accepted answer", () => {
		expectTypeOf<MatrixMismatch>().toBeNever();
	});
});

describe("a union-typed family and a symbol key are accepted, not refused (R4's falsifying rows)", () => {
	it('a wide union family (not "unknown") against a concrete family is accepted -- the fold must not distribute over the union and refuse it because one member would be', () => {
		type Result = SetOpResult<
			{ readonly v: Expr<"text" | "numeric"> },
			{ readonly v: Expr<"boolean"> }
		>;
		expectTypeOf<Result>().not.toBeNever();
	});

	it("the unconstrained Expr (every concrete family at once) against one concrete family is accepted", () => {
		type Result = SetOpResult<
			{ readonly v: Expr },
			{ readonly v: Expr<"text"> }
		>;
		expectTypeOf<Result>().not.toBeNever();
	});

	it("two whole-table projections (the tableMeta symbol key carries no family) are accepted", () => {
		const app = schema("app");
		const posts = table(app, "posts_no_family_row", {
			id: uuid().primaryKey(),
		});
		type Result = SetOpResult<typeof posts, typeof posts>;
		expectTypeOf<Result>().not.toBeNever();
	});
});

describe("the rule reaches the core combinator's own parameter (task 1.2a, core union)", () => {
	const app = schema("app");
	const textRows = table(app, "text_rows", {
		id: uuid().primaryKey(),
		v: text(),
	});
	const otherTextRows = table(app, "other_text_rows", {
		id: uuid().primaryKey(),
		v: text(),
	});
	const numericRows = table(app, "numeric_rows", {
		id: uuid().primaryKey(),
		v: integer(),
	});

	it("a text branch unioned with a numeric branch under the same key is refused at .union()'s parameter", () => {
		select({ v: textRows.v }, textRows).union(
			// @ts-expect-error text_rows.v (text) and numeric_rows.v (numeric)
			// are different families and 1.1 measured this pair refused
			// (42804/42846) -- SetOpResult resolves to never, poisoning the
			// whole `other` parameter, exactly as a key-set mismatch does.
			// TS reports the error on this nested argument, not on the
			// `.union(` call above it.
			select({ v: numericRows.v }, numericRows),
		);
	});

	it("two same-family branches still type-check and the result keeps the left branch's own type, unchanged", () => {
		const left = select({ v: textRows.v }, textRows);
		const right = select({ v: otherTextRows.v }, otherTextRows);
		const combined = left.union(right);
		expectTypeOf(combined.projectionInput).toEqualTypeOf(left.projectionInput);
	});

	it("a sql fragment matches any family", () => {
		// `sql` resolves to family "unknown" -- Postgres types an untyped
		// side against the other branch at parse time, so this is not a
		// red: no `@ts-expect-error` here, unlike the text/numeric row
		// above.
		select({ v: sql`1` }, numericRows).union(
			select({ v: numericRows.v }, numericRows),
		);
	});
});

describe("the rule reaches the recursive anchor/term pair's own parameter (task 1.2a, #966)", () => {
	const app = schema("app");
	const nodes = table(app, "nodes_family", {
		id: integer().primaryKey(),
		parent: integer(),
		name: text(),
	});

	it("#966: the anchor's text key against the recursive term's numeric key (one shared key) is refused", () => {
		withCte((w) => {
			w.asRecursive(
				"r",
				select({ id: nodes.id, name: nodes.name }, nodes).where(
					isNull(nodes.parent),
				),
				// @ts-expect-error #966 -- the anchor's "name" key is text
				// (nodes.name); the recursive term retypes the same shared
				// key as numeric (nodes.id), a pair 1.1 measured refused.
				// SetOpResult folds the family test per key and poisons the
				// whole callback parameter, exactly as a key-set mismatch
				// does today.
				(self) =>
					select({ id: self.id, name: nodes.id }, self).innerJoin(
						nodes,
						eq(self.id, nodes.parent),
					),
			);
			return select(nodes);
		});
	});

	it("an anchor and recursive term that agree on every key's family still compile, unaffected by this rule", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: nodes.id, name: nodes.name }, nodes).where(
					isNull(nodes.parent),
				),
				(self) =>
					select({ id: self.id, name: nodes.name }, self).innerJoin(
						nodes,
						eq(self.id, nodes.parent),
					),
			);
			return select({ id: r.id, name: r.name }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
	});
});

describe("a within-family divergence stays accepted (#489/#977 -- this rule sees families, not types)", () => {
	it("an integer branch unioned with a bigint branch under the same key still type-checks", () => {
		const app = schema("app");
		const ints = table(app, "ints_family", {
			id: uuid().primaryKey(),
			amount: integer(),
		});
		const bigints = table(app, "bigints_family", {
			id: uuid().primaryKey(),
			amount: bigint(),
		});
		// Not a red: `integer` and `bigint` share the "numeric" family, so
		// this rule -- which sees families, not types -- cannot and does
		// not refuse it (#489/#977, stated as a gap, not closed here).
		select({ amount: ints.amount }, ints).union(
			select({ amount: bigints.amount }, bigints),
		);
	});
});

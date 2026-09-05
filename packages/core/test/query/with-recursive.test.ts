import { describe, expect, expectTypeOf, it } from "vitest";
import type { ColumnRefNode, CteFieldRef, WidenedBy } from "../../src/index";
import {
	bigint,
	count,
	eq,
	integer,
	isNull,
	numeric,
	over,
	renderQuery,
	rowNumber,
	schema,
	select,
	sql,
	table,
	withCte,
} from "../../src/index";

const app = schema("app");
const t = table(app, "t", {
	id: integer().primaryKey(),
	parent: integer(),
	v: numeric({ mode: "number" }),
});

describe("withRecursive (add-ctes task 6.1)", () => {
	it("a recursive CTE anchors and self-references, rendering with recursive … union all", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			return select({ id: r.id, v: r.v }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
		expect(renderQuery(stage.withQuery)).toBe(
			'with recursive "r" as (select "app"."t"."id" as "id", "app"."t"."v" as "v" from "app"."t" where "app"."t"."parent" is null union all select "app"."t"."id" as "id", "app"."t"."v" as "v" from "r" inner join "app"."t" on "r"."id" = "app"."t"."parent") select "r"."id" as "id", "r"."v" as "v" from "r"',
		);
	});
});

describe("the recursive term is typed from the anchor (add-ctes task 6.2)", () => {
	it("the recursive term sees the anchor's columns", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				// `self.id`/`self.v` resolve because they are exactly the
				// anchor's own projected keys -- typed from it, not guessed at.
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			return select({ id: r.id }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
	});

	it("a recursive term missing one of the anchor's keys is refused", () => {
		// `@ts-expect-error` only suppresses the compile error -- the JS
		// still runs, and group 8's runtime guard (assertSameSetOpKeyOrder,
		// wired into buildRecursiveEntryQuery) also refuses a key-set
		// mismatch (group 8.4: the set check runs BEFORE the order check,
		// so a missing key lands on set-op-key-set-mismatch, not
		// set-op-key-order-mismatch -- "reorder" would be no remedy here),
		// so this now throws for real too; wrapped in toThrow() (asserting
		// the specific code, not any exception) so that second,
		// independent refusal doesn't fail the test with an uncaught
		// exception, and doesn't silently pass for a different reason
		// either.
		expect(() =>
			withCte((w) => {
				w.asRecursive(
					"r",
					select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
					// @ts-expect-error the recursive term's own projection ({id}
					// only) is missing the anchor's `v` key -- SetOpResult (task
					// 6.5) resolves key-set mismatches to `never`, poisoning the
					// whole callback parameter, so this fails to compile, not
					// just to run.
					(self) =>
						select({ id: t.id }, self).innerJoin(t, eq(self.id, t.parent)),
				);
				return select(t);
			}),
		).toThrow(expect.objectContaining({ code: "set-op-key-set-mismatch" }));
	});

	it("a recursive term listing the anchor's keys in a different order is refused (#487, second half — group 8)", () => {
		// same key SET ({id, v}) as the anchor, declared in the OPPOSITE
		// order -- CompatibleRecursiveTerm (SameKeys-based, like every
		// other type-level check in this slice) cannot see order, so this
		// type-checks; buildRecursiveEntryQuery's own call to
		// assertSameSetOpKeyOrder is what refuses it, at build time,
		// before the anchor UNION recursive-term ever reaches the server.
		expect(() =>
			withCte((w) => {
				w.asRecursive(
					"r",
					select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
					(self) =>
						select({ v: self.v, id: self.id }, self).innerJoin(
							t,
							eq(self.id, t.parent),
						),
				);
				return select(t);
			}),
		).toThrow(
			expect.objectContaining({
				code: "set-op-key-order-mismatch",
				message: expect.stringContaining("left: (id, v), right: (v, id)"),
			}),
		);
	});

	it("a field computed differently on each side is accepted and reads back as the anchor's type", () => {
		const windowedV = over(rowNumber(), { orderBy: [t.id] });
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				// `v` is a real column on the anchor side and a window
				// function on the recursive side -- same key, different
				// computation, exactly the shape SameKeys (task 6.5) admits
				// and an exact-identity rule (the first draft) refused. Only
				// the COMPATIBILITY check is shared with a plain union --
				// `r.v` below still reads as the anchor's own numeric column
				// type, never a union with the window function's own type
				// (Postgres itself refuses a recursive CTE that widens a
				// column's type across the anchor/recursive-term boundary,
				// `42804` -- a plain union does widen, a recursive CTE does
				// not, so this builder can't type it as a union either).
				(self) =>
					select({ id: t.id, v: windowedV }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			return select({ id: r.id, v: r.v }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
		const sql = renderQuery(stage.withQuery);
		expect(sql).toContain("row_number() over (order by");

		// The type-level proof: a recursive CTE built from this exact
		// anchor exposes the SAME `v` type an ordinary, non-recursive entry
		// built from that anchor ALONE would, intersected with the outward
		// `WidenedBy` carriage (#500/R2) -- never a union with the
		// recursive term's own value type (SetOpResult's own shape,
		// discarded rather than propagated -- see CompatibleRecursiveTerm's
		// docstring).
		const anchorOnly = withCte((w) => {
			const p = w.as(
				"p",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
			);
			return select({ id: p.id, v: p.v }, p);
		});
		expectTypeOf(stage.projectionInput.v).toEqualTypeOf<
			typeof anchorOnly.projectionInput.v & WidenedBy<typeof windowedV>
		>();
	});
});

describe("the recursive branch's combinator surface (add-ctes task 6.3)", () => {
	it("a recursive branch refuses order by, limit and offset -- unrepresentable, not merely rejected", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			// @ts-expect-error asRecursive hands back a plain row environment,
			// never a chainable SetOpStage -- there is nothing here to call
			// .orderBy() on. design.md's measured 0A000 "ORDER BY in a
			// recursive query is not implemented" is closed by construction,
			// not caught at build time.
			const _orderBy = r.orderBy;
			return select({ id: r.id }, r);
		});
		const entry = stage.withQuery.ctes[0];
		expect(entry).toMatchObject({
			query: {
				queryKind: "setOp",
				operator: "union",
				orderBy: [],
				limit: null,
				offset: null,
			},
		});
	});

	it("intersect and except are not offered on a recursive branch", () => {
		withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			// @ts-expect-error same reasoning as orderBy above -- intersect/
			// except are SetOpStage combinators asRecursive never exposes;
			// the entry it builds is hardcoded to operator "union", closing
			// 42P19 "recursive query does not have the form ... UNION [ALL]
			// ..." by construction rather than by a runtime check.
			const _intersect = r.intersect;
			return select({ id: r.id }, r);
		});
	});
});

describe("one recursive keyword covers the whole list (add-ctes task 6.4)", () => {
	it("a list with both a non-recursive and a recursive entry renders one with recursive, covering both", () => {
		const stage = withCte((w) => {
			w.as("helper", select(t));
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			return select({ id: r.id }, r);
		});
		// the flag is the LIST's own, not the recursive entry's alone --
		// "helper" is a plain, non-self-referencing entry, and it is still
		// declared inside the same "with recursive" statement as "r".
		expect(stage.withQuery.recursive).toBe(true);
		const sql = renderQuery(stage.withQuery);
		expect(sql.startsWith("with recursive ")).toBe(true);
		// exactly one "with"/"recursive" pair -- not one per entry.
		expect(sql.match(/with recursive/g)).toHaveLength(1);
		expect(sql).toContain(
			'"helper" as (select "id", "parent", "v" from "app"."t")',
		);
	});

	it("a list with only non-recursive entries stays non-recursive", () => {
		const stage = withCte((w) => {
			const helper = w.as("helper", select(t));
			return select({ id: helper.id }, helper);
		});
		expect(stage.withQuery.recursive).toBe(false);
		expect(renderQuery(stage.withQuery).startsWith("with recursive")).toBe(
			false,
		);
	});
});

describe("the accept list (add-ctes task 6.5)", () => {
	it("a recursive term accepts a window function, distinct, group by and an anchor aggregate", () => {
		// window function -- the case that matters most (6.2's own union pin
		// covers the value assertion; this confirms `asRecursive` itself
		// accepts it, not just the type layer in isolation).
		const windowed = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select(
						{ id: t.id, v: over(rowNumber(), { orderBy: [t.id] }) },
						self,
					).innerJoin(t, eq(self.id, t.parent)),
			);
			return select({ id: r.id }, r);
		});
		expect(windowed.withQuery.recursive).toBe(true);

		// distinct -- SQL puts it between `select` and the projection, so it
		// must be called before `.innerJoin()` (SelectDistinctable's own
		// shape), not after.
		const distinct = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self)
						.distinct()
						.innerJoin(t, eq(self.id, t.parent)),
			);
			return select({ id: r.id }, r);
		});
		expect(distinct.withQuery.recursive).toBe(true);

		// distinct on
		const distinctOn = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self)
						.distinctOn(t.id)
						.innerJoin(t, eq(self.id, t.parent)),
			);
			return select({ id: r.id }, r);
		});
		expect(distinctOn.withQuery.recursive).toBe(true);

		// group by / having on the recursive term
		const grouped = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self)
						.innerJoin(t, eq(self.id, t.parent))
						.groupBy(t.id, t.v)
						.having(eq(t.id, t.id)),
			);
			return select({ id: r.id }, r);
		});
		expect(grouped.withQuery.recursive).toBe(true);

		// an aggregate in the ANCHOR term -- the ban is recursive-term-only.
		const anchorAggregate = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: count() }, t).groupBy(t.id),
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			return select({ id: r.id }, r);
		});
		expect(anchorAggregate.withQuery.recursive).toBe(true);
	});

	it("an aggregate inside a scalar subquery in the recursive term is accepted", () => {
		// The rule is about the term's own select level -- a deep walk would
		// over-reject this, and asRecursive builds no such walk (task 6.3
		// only narrows the combinator surface, it never inspects the
		// projection), so this is unaffected either way. `sql` is the raw
		// escape hatch (no scalar-subquery builder exists on this surface),
		// matching `collectColumnRefs`'s own shallow `exists` boundary.
		//
		// The subquery MUST carry its own `from` (design.md's own accepted
		// form: `(select sum(v) from t t2)`) -- review measured that a
		// FROM-less subquery whose only aggregate argument is an outer
		// reference doesn't read as a scalar subquery to Postgres at all;
		// the aggregate binds to the OUTER level (the recursive term
		// itself), which is exactly the `42803`-shadowed case design.md's
		// third boundary note warns about, not the case this test names.
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select(
						{
							id: t.id,
							v: sql`(select sum(v) from app.t as t2)`,
						},
						self,
					).innerJoin(t, eq(self.id, t.parent)),
			);
			return select({ id: r.id }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
		expect(renderQuery(stage.withQuery)).toContain("(select sum(");
	});

	it("a recursive entry accepts both materialization hints", () => {
		const stage = withCte((w) => {
			const materialized = w.asRecursive(
				"materialized_r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
				{ materialized: true },
			);
			w.asRecursive(
				"not_materialized_r",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: t.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
				{ materialized: false },
			);
			return select({ id: materialized.id }, materialized);
		});
		const rendered = renderQuery(stage.withQuery);
		expect(rendered).toContain('"materialized_r" as materialized (');
		expect(rendered).toContain('"not_materialized_r" as not materialized (');
	});
});

// harden-query-surface group 6.1 (#489): the null fork. SetOpResult is a
// plain mapped type and nullability rides inside the value type, not a
// separate flag -- so a rule tightened to "same type" would count
// `number | null` against `number` and reject programs Postgres accepts.
// The comparison therefore elides null, which opens a gap on the other
// side: anchor `number`, recursive term `number | null` still compiles,
// the CTE's declared row type stays the anchor's (`number`, not
// `number | null`), and the recursive term's null really does reach the
// result rows -- measured, not hypothetical (group 1, M4 addendum:
// `v_is_null = t` on the affected rows). Lead-settled outcome (a): keep
// the anchor's type, state the gap. Residue pinned at #412's sub-issue
// (issue.sh) and in the query-type-inference spec delta.
describe("a recursive term's nullability is not the reason to refuse it (#489, group 6.1)", () => {
	it("a recursive term nullable where the anchor is not still compiles", () => {
		// This is a GUARD, not a red-to-green: it is green today (before
		// 6.2's own type narrowing exists) and must stay green after --
		// 6.2's rule elides null per this task's own decision, so a
		// nullability-only divergence must never become the reason a
		// recursive term is refused.
		//
		// anchor's own "v" key: t.id's value -- non-null (primaryKey).
		// recursive term's own "v" key: t.v's value -- nullable, same
		// family (numeric) as the anchor's, a pure nullability
		// divergence with no underlying type mismatch, matching M4's
		// own measured shape.
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.id }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: self.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			return select({ id: r.id, v: r.v }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
	});
});

// harden-query-surface group 6.2 (#489), outcome 1 -- NO source change.
// The key question (does the rule key on the type PAIR or on the
// ANCHOR?) is already answered by group 1: M3b-i (numeric anchor +
// bigint recursive term) is accepted and resolves to numeric; M3b-ii,
// the identical pair reversed, is refused with 42804. A directional
// rule is therefore correct in principle, but not expressible as a
// build-time TS check without reproducing Postgres's own numeric
// promotion table: this package's SqlTypeFamily collapses every
// integer/real/numeric/serial type into one family, "numeric" -- the
// same family both M3b-i's and M3b-ii's branches share, so nothing at
// the family level (the coarsest information a keyof-based check has)
// can tell the accepted pair from the refused one. Reported here, not
// silently: this outcome closes the key-SET axis (already checked) and
// states the type axis as a residual gap in the query-type-inference
// spec delta, rather than building a narrower rule that would need the
// same promotion table by another name.
describe("a same-family type divergence between anchor and recursive term is not caught (#489, group 6.2 outcome 1)", () => {
	it("a recursive term whose column type differs from the anchor's (same family) still compiles -- the residual gap this outcome documents, not closes", () => {
		// M3b-i's own shape (group 1, measured accepted on postgres:17):
		// numeric anchor + bigint recursive term, same key, same
		// SqlTypeFamily ("numeric"), different declared hejbro type.
		const numBig = table(app, "num_big", {
			id: integer().primaryKey(),
			parent: integer(),
			amount: numeric({ mode: "number" }),
			bigAmount: bigint(),
		});
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: numBig.id, amount: numBig.amount }, numBig).where(
					isNull(numBig.parent),
				),
				(self) =>
					select({ id: self.id, amount: numBig.bigAmount }, self).innerJoin(
						numBig,
						eq(self.id, numBig.parent),
					),
			);
			return select({ id: r.id, amount: r.amount }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
	});
});

// #500/R2: nullability is decided in @hejbro/query's ProjectedColumnResult
// alone -- this file only proves core's own half, the structural carriage.
// A second copy of the null rule here would be a proper subset of
// ProjectedColumnResult's knowledge (it doesn't see left joins), so no
// row-nullability assertion belongs in this file; that table lives in
// @hejbro/query's own type tests (task 1.2).
describe("the outward reference carries the recursive term's projection (#500/R2, task 1.1)", () => {
	it("every outward key carries WidenedBy<the recursive term's own projected value for that key>", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				// anchor: "v" is aliased to t.id (non-null) -- only the
				// recursive term's own value for "v" (t.v) matters for what
				// WidenedBy carries.
				select({ id: t.id, v: t.id }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: self.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			expectTypeOf(r.id).toEqualTypeOf<
				CteFieldRef<typeof t.id> & WidenedBy<CteFieldRef<typeof t.id>>
			>();
			expectTypeOf(r.v).toEqualTypeOf<
				CteFieldRef<typeof t.id> & WidenedBy<typeof t.v>
			>();
			return select({ id: r.id, v: r.v }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
	});

	it("the reference the recursive callback receives carries none", () => {
		withCte((w) => {
			w.asRecursive(
				"r",
				select({ id: t.id, v: t.id }, t).where(isNull(t.parent)),
				(self) => {
					// unchanged from every other test in this file (Q2) -- the
					// plain anchor-typed field, no WidenedBy intersected onto it.
					expectTypeOf(self.v).toEqualTypeOf<CteFieldRef<typeof t.id>>();
					return select({ id: self.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					);
				},
			);
			return select(t);
		});
	});

	it("the outward reference is still assignable to FromSource, and its exprNode stays a ColumnRefNode", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: t.id, v: t.id }, t).where(isNull(t.parent)),
				(self) =>
					select({ id: self.id, v: t.v }, self).innerJoin(
						t,
						eq(self.id, t.parent),
					),
			);
			// `r` still type-checks as a from-source here -- WidenedBy is an
			// optional phantom, never a structural obstacle.
			const body = select({ id: r.id, v: r.v }, r);
			expectTypeOf(r.v.exprNode).toEqualTypeOf<ColumnRefNode>();
			return body;
		});
		expect(stage.withQuery.recursive).toBe(true);
	});
});

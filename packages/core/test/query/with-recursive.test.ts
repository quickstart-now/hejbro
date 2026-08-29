import { describe, expect, expectTypeOf, it } from "vitest";
import {
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
		});
	});

	it("a field computed differently on each side is accepted and reads back as the anchor's type", () => {
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
					select(
						{ id: t.id, v: over(rowNumber(), { orderBy: [t.id] }) },
						self,
					).innerJoin(t, eq(self.id, t.parent)),
			);
			return select({ id: r.id, v: r.v }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
		const sql = renderQuery(stage.withQuery);
		expect(sql).toContain("row_number() over (order by");

		// The type-level proof: a recursive CTE built from this exact
		// anchor exposes the SAME `v` type an ordinary, non-recursive entry
		// built from that anchor ALONE would -- untouched by the recursive
		// term's own type. If `r.v` were instead a union with the recursive
		// term's own type (SetOpResult's own shape, discarded rather than
		// propagated -- see CompatibleRecursiveTerm's docstring), this
		// would not hold.
		const anchorOnly = withCte((w) => {
			const p = w.as(
				"p",
				select({ id: t.id, v: t.v }, t).where(isNull(t.parent)),
			);
			return select({ id: p.id, v: p.v }, p);
		});
		expectTypeOf(stage.projectionInput.v).toEqualTypeOf(
			anchorOnly.projectionInput.v,
		);
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

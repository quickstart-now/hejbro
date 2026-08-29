import { describe, expect, it } from "vitest";
import type { ColumnRef, Expr } from "../../src/index";
import {
	count,
	cumeDist,
	denseRank,
	firstValue,
	lag,
	lastValue,
	lead,
	nthValue,
	ntile,
	over,
	percentRank,
	rank,
	renderSelect,
	rowNumber,
	schema,
	select,
	sum,
	table,
	text,
	timestamptz,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	authorId: uuid().notNull(),
	publishedAt: timestamptz(),
});

describe("window vocabulary (task 2.1)", () => {
	it("a bare rowNumber() is not accepted where an Expr is required", () => {
		// @ts-expect-error rowNumber() has no `exprNode`/`family` until
		// over() wraps it -- Postgres rejects every window-only call
		// without an OVER clause, and the type says the same thing.
		const _atRisk: Expr = rowNumber();
		expect(_atRisk).toBeDefined();
	});

	it("a bare rowNumber() is not accepted as a ColumnRef either", () => {
		// @ts-expect-error same reasoning as above, the ColumnRef-shaped
		// position (index()/foreign key column lists).
		const _atRisk: ColumnRef = rowNumber();
		expect(_atRisk).toBeDefined();
	});

	it("nesting a window-only call inside an aggregate's argument does not compile", () => {
		// @ts-expect-error sum()'s operand must be an Expr; rowNumber() has
		// no exprNode until over() wraps it, so this is unrepresentable
		// rather than merely rejected at runtime (matches Postgres's own
		// prohibition on nesting).
		const _atRisk = sum(rowNumber());
		expect(_atRisk).toBeDefined();
	});

	it("lag, lead and nthValue pass the operand's type through whatever their extra arguments", () => {
		const laggedColumn = lag(posts.publishedAt, 1);
		expect(laggedColumn.family).toBe(posts.publishedAt.family);
		expect(laggedColumn.typeNode).toEqual(posts.publishedAt.typeNode);
		expect("sqlName" in laggedColumn).toBe(false);
		expect("exprNode" in laggedColumn).toBe(false);

		const laggedWithDefault = lag(posts.publishedAt, 1, posts.publishedAt);
		expect(laggedWithDefault.family).toBe(posts.publishedAt.family);

		const led = lead(posts.status);
		expect(led.family).toBe(posts.status.family);

		const nth = nthValue(posts.status, 2);
		expect(nth.family).toBe(posts.status.family);

		const first = firstValue(posts.status);
		expect(first.family).toBe(posts.status.family);

		const last = lastValue(posts.status);
		expect(last.family).toBe(posts.status.family);
	});

	it("the six argument-less constructors carry the numeric family", () => {
		expect(rowNumber().family).toBe("numeric");
		expect(rank().family).toBe("numeric");
		expect(denseRank().family).toBe("numeric");
		expect(percentRank().family).toBe("numeric");
		expect(cumeDist().family).toBe("numeric");
		expect(ntile(4).family).toBe("numeric");
	});
});

describe("over() (task 2.2)", () => {
	it("wraps an aggregate and a window-only call into the same node shape", () => {
		const windowed = over(rank(), { partitionBy: [posts.authorId] });
		const windowedAggregate = over(sum(posts.publishedAt), {
			orderBy: [posts.publishedAt],
		});
		expect(windowed.exprNode.nodeKind).toBe("window");
		expect(windowedAggregate.exprNode.nodeKind).toBe("window");
	});

	it("renders a ranking function partitioned and ordered (query-builder spec: Ranking within a partition)", () => {
		const query = select(
			{
				id: posts.id,
				rnk: over(rank(), {
					partitionBy: [posts.authorId],
					orderBy: [{ by: posts.publishedAt, direction: "desc" }],
				}),
			},
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id" as "id", rank() over (partition by "app"."posts"."author_id" order by "app"."posts"."published_at" desc) as "rnk" from "app"."posts"',
		);
	});

	it("renders a windowed aggregate as a running total, with no group by implied (query-builder spec: An aggregate becomes a running total)", () => {
		const query = select(
			{
				id: posts.id,
				running: over(count(), { orderBy: [posts.publishedAt] }),
			},
			posts,
		);
		expect(renderSelect(query.selectQuery)).not.toContain("group by");
		expect(renderSelect(query.selectQuery)).toContain(
			'count(*) over (order by "app"."posts"."published_at" asc) as "running"',
		);
	});

	it("over refuses a target that is not a function call", () => {
		expect(() => over(posts.status, {})).toThrowError(
			expect.objectContaining({ code: "invalid-over-target" }),
		);
	});

	it("a windowed count() still carries the bigint read-as brand (type level)", () => {
		const windowedCount = over(count(), {});
		// structural proof, not a type-only claim: the runtime shape is a
		// plain Expr<"numeric"> either way (the brand is phantom), but the
		// TS type must still accept this assignment.
		const _typed: Expr<"numeric"> = windowedCount;
		expect(_typed.exprNode.nodeKind).toBe("window");
	});
});

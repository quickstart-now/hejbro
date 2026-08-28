import { describe, expect, it } from "vitest";
import type { ColumnBuilder, SetOpNode } from "../../src/index";
import {
	and,
	bigint,
	bytea,
	date,
	eq,
	exists,
	interval,
	isNotNull,
	jsonArrayFrom,
	jsonObjectFrom,
	numeric,
	renderExpr,
	renderSelect,
	renderSetOp,
	schema,
	select,
	sql,
	table,
	text,
	timestamptz,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

describe("select builder", () => {
	it("renders a whole-table select with explicit columns", () => {
		expect(renderSelect(select(posts).selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts"',
		);
	});
	it("renders offset after limit", () => {
		const query = select(posts)
			.orderBy({ by: posts.publishedAt, direction: "desc" })
			.limit(10)
			.offset(20);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" order by "app"."posts"."published_at" desc limit 10 offset 20',
		);
	});
	it("renders offset without a limit", () => {
		const query = select(posts).offset(5);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" offset 5',
		);
	});
	it("rejects a negative or fractional offset", () => {
		expect(() => select(posts).offset(-1)).toThrow(/non-negative integer/);
		expect(() => select(posts).offset(1.5)).toThrow(/non-negative integer/);
	});
	it("renders distinct and distinct on", () => {
		expect(renderSelect(select(posts).distinct().selectQuery)).toBe(
			'select distinct "id", "status", "published_at" from "app"."posts"',
		);
		const perStatus = select(posts)
			.distinctOn(posts.status)
			.orderBy(posts.status, { by: posts.publishedAt, direction: "desc" });
		expect(renderSelect(perStatus.selectQuery)).toBe(
			'select distinct on ("app"."posts"."status") "id", "status", "published_at" from "app"."posts" order by "app"."posts"."status" asc, "app"."posts"."published_at" desc',
		);
	});
	it("rejects distinct on with no columns", () => {
		expect(() => select(posts).distinctOn()).toThrow(/at least one column/);
	});
	it("accepts a sql fragment as a where condition", () => {
		// #386: the declaration medium's condition positions (check(), a
		// partial index, an RLS policy) already take Expr<"unknown">; a
		// query's condition positions take the same union, so a predicate
		// the typed operators cannot build needs no cast.
		const query = select(posts).where(
			sql`lower(${posts.status}) = ${"published"}`,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where lower("app"."posts"."status") = \'published\'',
		);
	});
	it("accepts a sql fragment as a join condition", () => {
		const query = select(posts).innerJoin(
			comments,
			sql`${comments.postId} = ${posts.id}`,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" inner join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
	});
	it("composes a sql fragment with an operator-built condition", () => {
		const query = select(posts).where(
			and(
				eq(posts.status, "published"),
				sql`char_length(${posts.status}) > ${3}`,
			),
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where ("app"."posts"."status" = \'published\') and char_length("app"."posts"."status") > 3',
		);
	});
	it("renders where / order by / limit in type-state order", () => {
		const query = select(posts)
			.where(eq(posts.status, "published"))
			.orderBy({ by: posts.publishedAt, direction: "desc" })
			.limit(10);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'published\' order by "app"."posts"."published_at" desc limit 10',
		);
	});
	it("renders the app schema's rls shape: exists + inner join", () => {
		const guard = exists(
			select(comments)
				.innerJoin(posts, eq(comments.postId, posts.id))
				.where(isNotNull(posts.publishedAt)),
		);
		expect(renderSelect(select(comments).where(guard).selectQuery)).toContain(
			'exists (select 1 from "app"."comments" inner join "app"."posts" on',
		);
	});
	it("records and renders a left join", () => {
		const query = select(posts).leftJoin(
			comments,
			eq(comments.postId, posts.id),
		);
		expect(query.selectQuery.joins).toEqual([
			expect.objectContaining({ joinKind: "left" }),
		]);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" left join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
	});
	it("renders a correlated subquery referencing the outer table", () => {
		// the canonical rls form: comment is visible iff its post is published
		const guard = exists(
			select(posts).where(
				and(eq(posts.id, comments.postId), isNotNull(posts.publishedAt)),
			),
		);
		expect(renderSelect(select(comments).where(guard).selectQuery)).toBe(
			'select "id", "post_id" from "app"."comments" where exists (select 1 from "app"."posts" where ("app"."posts"."id" = "app"."comments"."post_id") and ("app"."posts"."published_at" is not null))',
		);
	});
	it("renders a standalone correlated expression given an outer scope", () => {
		// how phase 4 renders an rls using-expression for a policy on comments
		const guard = exists(select(posts).where(eq(posts.id, comments.postId)));
		expect(
			renderExpr(guard.exprNode, [
				{ schemaName: "app", tableName: "comments" },
			]),
		).toContain('= "app"."comments"."post_id"');
	});
	it("rejects column refs from tables in no enclosing scope", () => {
		const query = select(posts).where(isNotNull(comments.postId));
		expect(() => renderSelect(query.selectQuery)).toThrowError(
			/foreign-column-ref|join that table/,
		);
	});
});

describe("jsonArrayFrom/jsonObjectFrom wrap a subselect into an expression (add-relational-reads task 2.1)", () => {
	it("wraps the subselect as a select-as-expression node, projection intact", () => {
		const sub = select(
			{ id: comments.id, postId: comments.postId },
			comments,
		).where(eq(comments.postId, posts.id));

		const collection = jsonArrayFrom(sub);
		expect(collection.family).toBe("json");
		expect(collection.exprNode.nodeKind).toBe("selectExpr");
		const collectionNode = collection.exprNode as {
			mode: string;
			query: { projection: { projectionKind: string } };
		};
		expect(collectionNode.mode).toBe("jsonArray");
		// unlike exists(), the projection is the point -- it must survive
		// exactly as built, never rewritten to constantOne.
		expect(collectionNode.query).toBe(sub.selectQuery);
		expect(collectionNode.query.projection.projectionKind).not.toBe(
			"constantOne",
		);

		const single = jsonObjectFrom(sub);
		expect((single.exprNode as { mode: string }).mode).toBe("jsonObject");
	});
});

describe("select-as-expression rendering (add-relational-reads task 2.2)", () => {
	const metrics = table(app, "metrics", {
		id: uuid().primaryKey(),
		postId: uuid().notNull(),
		viewCount: bigint().notNull(),
		recordedAt: timestamptz().notNull(),
	});

	it("renders a collection as a correlated aggregate over a derived table", () => {
		const query = select(
			{
				id: posts.id,
				comments: jsonArrayFrom(
					select({ id: comments.id, postId: comments.postId }, comments)
						.where(eq(comments.postId, posts.id))
						.orderBy(comments.id),
				),
			},
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id" as "id", (select coalesce(json_agg("agg"), \'[]\'::json) from (select "app"."comments"."id" as "id", "app"."comments"."post_id" as "post_id" from "app"."comments" where "app"."comments"."post_id" = "app"."posts"."id" order by "app"."comments"."id" asc) as "agg") as "comments" from "app"."posts"',
		);
	});

	it("renders a single row via row_to_json, casting only the json-number-precision types (F1)", () => {
		const query = select(
			{
				id: posts.id,
				latest: jsonObjectFrom(
					select(
						{ viewCount: metrics.viewCount, recordedAt: metrics.recordedAt },
						metrics,
					)
						.where(eq(metrics.postId, posts.id))
						.orderBy({ by: metrics.recordedAt, direction: "desc" })
						.limit(1),
				),
			},
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id" as "id", (select row_to_json("agg") from (select "app"."metrics"."view_count"::text as "view_count", "app"."metrics"."recorded_at" as "recorded_at" from "app"."metrics" where "app"."metrics"."post_id" = "app"."posts"."id" order by "app"."metrics"."recorded_at" desc limit 1) as "agg") as "latest" from "app"."posts"',
		);
	});

	it("keeps the foreign-column diagnostic for a ref outside every scope (task 2.4)", () => {
		const others = table(app, "others", { id: uuid().primaryKey() });
		const query = select(
			{
				id: posts.id,
				bad: jsonArrayFrom(
					select({ id: comments.id }, comments).where(
						eq(comments.postId, others.id),
					),
				),
			},
			posts,
		);
		expect(() => renderSelect(query.selectQuery)).toThrowError(
			/foreign-column-ref|enclosing query/,
		);
	});
});

describe("group 2 review rulings (F1/F2) and the at-risk table", () => {
	it("expands a whole-table subselect with casts applied (F2)", () => {
		const ledger = table(app, "ledger", {
			id: uuid().primaryKey(),
			amount: bigint().notNull(),
			postedAt: timestamptz().notNull(),
		});
		const query = select(
			{ id: posts.id, entries: jsonArrayFrom(select(ledger)) },
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id" as "id", (select coalesce(json_agg("agg"), \'[]\'::json) from (select "app"."ledger"."id" as "id", "app"."ledger"."amount"::text as "amount", "app"."ledger"."posted_at" as "posted_at" from "app"."ledger") as "agg") as "entries" from "app"."posts"',
		);
	});

	it("casts exactly the json-number-precision types, arrays included (F1/F6)", () => {
		const cases: ReadonlyArray<readonly [string, ColumnBuilder, boolean]> = [
			["bigint", bigint(), true],
			["numeric", numeric(), true],
			["bigint array", bigint().array(), true],
			["timestamptz", timestamptz(), false],
			["date", date(), false],
			["interval", interval(), false],
			["bytea", bytea(), false],
			["text", text(), false],
		];
		for (const [label, builder, expectCast] of cases) {
			const probe = table(app, `probe_${label.replaceAll(" ", "_")}`, {
				id: uuid().primaryKey(),
				value: builder as never,
			});
			const rendered = renderSelect(
				select({ id: posts.id, nested: jsonObjectFrom(select(probe)) }, posts)
					.selectQuery,
			);
			expect(rendered.includes("::text"), label).toBe(expectCast);
			if (label === "bigint array") {
				expect(rendered).toContain("::text[]");
			}
		}
	});
});

describe("set operations (add-set-operations tasks 1.1-1.2)", () => {
	const activeQuery = select(posts).where(eq(posts.status, "active"));
	const archivedQuery = select(posts).where(eq(posts.status, "archived"));

	it("a set-op node renders the two branches joined by the operator", () => {
		const combined: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: activeQuery.selectQuery,
			right: archivedQuery.selectQuery,
			orderBy: [],
			limit: null,
			offset: null,
		};
		expect(renderSetOp(combined)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'active\' union select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'archived\'',
		);
	});

	it("nesting parenthesizes and whole-set order/limit trail the set", () => {
		const inner: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: true,
			left: activeQuery.selectQuery,
			right: archivedQuery.selectQuery,
			orderBy: [],
			limit: null,
			offset: null,
		};
		const outer: SetOpNode = {
			queryKind: "setOp",
			operator: "except",
			all: false,
			left: inner,
			right: select(posts).selectQuery,
			orderBy: [{ expr: posts.id.exprNode, direction: "asc" }],
			limit: 3,
			offset: null,
		};
		expect(renderSetOp(outer)).toBe(
			'(select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'active\' union all select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'archived\') except select "id", "status", "published_at" from "app"."posts" order by "id" asc limit 3',
		);
	});

	it("a whole-set orderBy outside the output columns is rejected by name", () => {
		// output-name semantics (the group-4 real-server correction): the
		// guard is MEMBERSHIP IN THE LEFT BRANCH'S OUTPUT LIST -- a ref
		// whose name is not an output column is rejected whatever table it
		// came from ("post_id" is not among posts' outputs).
		const combined: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: activeQuery.selectQuery,
			right: archivedQuery.selectQuery,
			orderBy: [{ expr: comments.postId.exprNode, direction: "asc" }],
			limit: null,
			offset: null,
		};
		expect(() => renderSetOp(combined)).toThrowError(/output/);
	});
});

describe("set-op combinators (add-set-operations task 2.1)", () => {
	it("union/unionAll/intersect/except combinators build the recursive node", () => {
		const active = select(posts).where(eq(posts.status, "active"));
		const archived = select(posts).where(eq(posts.status, "archived"));
		const drafts = select(posts).where(eq(posts.status, "draft"));

		const combined = active.union(archived).exceptAll(drafts);
		expect(combined.setOpQuery.operator).toBe("except");
		expect(combined.setOpQuery.all).toBe(true);
		const inner = combined.setOpQuery.left;
		expect(inner.queryKind).toBe("setOp");
		expect((inner as SetOpNode).operator).toBe("union");
		expect((inner as SetOpNode).all).toBe(false);

		const ordered = combined
			.orderBy({ by: posts.id, direction: "desc" })
			.limit(2);
		expect(ordered.setOpQuery.limit).toBe(2);
		expect(renderSetOp(ordered.setOpQuery)).toContain(
			'order by "id" desc limit 2',
		);

		// all six exist
		expect(typeof active.unionAll).toBe("function");
		expect(typeof active.intersect).toBe("function");
		expect(typeof active.intersectAll).toBe("function");
		expect(typeof active.except).toBe("function");
	});
});

describe("set-op order-by output-column guard (review F1)", () => {
	const active = select(posts).where(eq(posts.status, "active"));
	const archived = select(posts).where(eq(posts.status, "archived"));

	it("rejects a non-projected column and an alias-hidden source ref", () => {
		const narrowLeft = select({ id: posts.id }, posts);
		const narrowRight = select({ id: comments.id }, comments);
		const nonProjected: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: narrowLeft.selectQuery,
			right: narrowRight.selectQuery,
			orderBy: [{ expr: posts.status.exprNode, direction: "asc" }],
			limit: null,
			offset: null,
		};
		expect(() => renderSetOp(nonProjected)).toThrowError(/output/);

		const aliased = select({ headline: posts.status }, posts)
			.union(select({ headline: comments.id }, comments))
			// the SOURCE ref renders "status", but the output column is
			// "headline" -- Postgres rejects it, so we do first.
			.orderBy(posts.status);
		expect(() => renderSetOp(aliased.setOpQuery)).toThrowError(/output/);
		// ordering by a projected whole-table column stays legal
		const legal = active.union(archived).orderBy(posts.status);
		expect(renderSetOp(legal.setOpQuery)).toContain('order by "status" asc');
	});
});

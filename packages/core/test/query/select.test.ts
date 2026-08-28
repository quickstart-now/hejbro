import { describe, expect, it } from "vitest";
import {
	and,
	bigint,
	eq,
	exists,
	isNotNull,
	jsonArrayFrom,
	jsonObjectFrom,
	renderExpr,
	renderSelect,
	schema,
	select,
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

	it("renders a single row via row_to_json and casts at-risk columns to text", () => {
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
			'select "app"."posts"."id" as "id", (select row_to_json("agg") from (select "app"."metrics"."view_count"::text as "view_count", "app"."metrics"."recorded_at"::text as "recorded_at" from "app"."metrics" where "app"."metrics"."post_id" = "app"."posts"."id" order by "app"."metrics"."recorded_at" desc limit 1) as "agg") as "latest" from "app"."posts"',
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

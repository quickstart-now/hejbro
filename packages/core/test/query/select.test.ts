import { describe, expect, it } from "vitest";
import {
	and,
	eq,
	exists,
	isNotNull,
	renderExpr,
	renderSelect,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "../../src/index";

const ddland = schema("ddland");
const posts = table(ddland, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});
const comments = table(ddland, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

describe("select builder", () => {
	it("renders a whole-table select with explicit columns", () => {
		expect(renderSelect(select(posts).selectQuery)).toBe(
			'select "id", "status", "published_at" from "ddland"."posts"',
		);
	});
	it("renders where / order by / limit in type-state order", () => {
		const query = select(posts)
			.where(eq(posts.status, "published"))
			.orderBy({ by: posts.publishedAt, direction: "desc" })
			.limit(10);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "ddland"."posts" where "ddland"."posts"."status" = \'published\' order by "ddland"."posts"."published_at" desc limit 10',
		);
	});
	it("renders the dd.land rls shape: exists + inner join", () => {
		const guard = exists(
			select(comments)
				.innerJoin(posts, eq(comments.postId, posts.id))
				.where(isNotNull(posts.publishedAt)),
		);
		expect(renderSelect(select(comments).where(guard).selectQuery)).toContain(
			'exists (select 1 from "ddland"."comments" inner join "ddland"."posts" on',
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
			'select "id", "post_id" from "ddland"."comments" where exists (select 1 from "ddland"."posts" where ("ddland"."posts"."id" = "ddland"."comments"."post_id") and ("ddland"."posts"."published_at" is not null))',
		);
	});
	it("renders a standalone correlated expression given an outer scope", () => {
		// how phase 4 renders an rls using-expression for a policy on comments
		const guard = exists(select(posts).where(eq(posts.id, comments.postId)));
		expect(
			renderExpr(guard.exprNode, [
				{ schemaName: "ddland", tableName: "comments" },
			]),
		).toContain('= "ddland"."comments"."post_id"');
	});
	it("rejects column refs from tables in no enclosing scope", () => {
		const query = select(posts).where(isNotNull(comments.postId));
		expect(() => renderSelect(query.selectQuery)).toThrowError(
			/foreign-column-ref|join that table/,
		);
	});
});

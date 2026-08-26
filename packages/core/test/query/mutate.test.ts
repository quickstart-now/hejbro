import { describe, expect, it } from "vitest";
import {
	deleteFrom,
	eq,
	insert,
	isNotNull,
	now,
	renderQuery,
	schema,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	slug: text().notNull(),
	publishedAt: timestamptz(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

describe("mutation builders", () => {
	it("renders the spec §5.2 update shape", () => {
		const query = update(posts)
			.set({ publishedAt: now() })
			.where(eq(posts.slug, "hello"))
			.returning();
		expect(renderQuery(query.updateQuery)).toBe(
			'update "app"."posts" set "published_at" = now() where "app"."posts"."slug" = \'hello\' returning "id", "slug", "published_at"',
		);
	});
	it("renders insert with on conflict do nothing", () => {
		const query = insert(posts)
			.values({ slug: "hello" })
			.onConflictDoNothing(posts.slug);
		expect(renderQuery(query.insertQuery)).toBe(
			'insert into "app"."posts" ("slug") values (\'hello\') on conflict ("slug") do nothing',
		);
	});
	it("fills missing multi-row keys with sql default", () => {
		const query = insert(posts).values([
			{ slug: "a", publishedAt: now() },
			{ slug: "b" },
		]);
		expect(renderQuery(query.insertQuery)).toBe(
			'insert into "app"."posts" ("slug", "published_at") values (\'a\', now()), (\'b\', default)',
		);
	});
	it("returning with an object projection lists exactly those columns", () => {
		const query = insert(posts)
			.values({ slug: "hello" })
			.returning({ id: posts.id });
		expect(query.insertQuery.returning).toEqual({
			returningKind: "columns",
			columns: [
				{
					alias: "id",
					expr: expect.objectContaining({
						nodeKind: "columnRef",
						columnName: "id",
					}),
				},
			],
		});
		expect(renderQuery(query.insertQuery)).toContain(
			'returning "app"."posts"."id" as "id"',
		);
	});
	it("snake_cases returning projection aliases on update", () => {
		const query = update(posts)
			.set({ slug: "x" })
			.where(eq(posts.slug, "hello"))
			.returning({ publishedAt: posts.publishedAt });
		expect(renderQuery(query.updateQuery)).toContain(
			'returning "app"."posts"."published_at" as "published_at"',
		);
	});
	it("rejects an empty returning projection", () => {
		expect(() =>
			deleteFrom(posts).where(eq(posts.slug, "old")).returning({}),
		).toThrowError(expect.objectContaining({ code: "empty-returning" }));
	});
	it("renders delete with where and returning", () => {
		const query = deleteFrom(posts).where(eq(posts.slug, "old")).returning();
		expect(renderQuery(query.deleteQuery)).toBe(
			'delete from "app"."posts" where "app"."posts"."slug" = \'old\' returning "id", "slug", "published_at"',
		);
	});
	it("rejects unknown column keys with an actionable error", () => {
		expect(() => insert(posts).values({ nope: "x" } as never)).toThrowError(
			/unknown-column|unknown column key/,
		);
	});
	it("rejects column refs from tables outside the mutation's scope", () => {
		const query = update(posts)
			.set({ slug: "hello" })
			.where(isNotNull(comments.postId));
		expect(() => renderQuery(query.updateQuery)).toThrowError(
			/foreign-column-ref|join that table/,
		);
	});
});

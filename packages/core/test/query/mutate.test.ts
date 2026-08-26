import { describe, expect, expectTypeOf, it } from "vitest";
import type { InsertFinal } from "../../src/index";
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

describe("InsertFinal/UpdateFinal/DeleteFinal<TTable, TReturning> generics (task 4.11-mutation)", () => {
	// deliberately disjoint from posts's own columns (id/slug/publishedAt)
	// in both directions -- neither table's column set is a superset of the
	// other's, so plain structural width-subtyping can't sneak either
	// direction through (a strict-subset fixture would let the wider table
	// satisfy the narrower one via excess properties, which is exactly the
	// asymmetric false-pass this test caught on the first attempt).
	const otherTable = table(app, "other", {
		name: text().notNull(),
	});

	type ExtractInsertTable<T> =
		T extends InsertFinal<infer TExtracted, infer _R> ? TExtracted : never;
	type ExtractInsertReturning<T> =
		T extends InsertFinal<infer _T, infer TExtracted> ? TExtracted : never;

	it("InsertFinal<A> and InsertFinal<B> are not mutually assignable -- the phantom anchor actually narrows, not a false pass", () => {
		type InsertPosts = InsertFinal<typeof posts>;
		type InsertOther = InsertFinal<typeof otherTable>;

		// @ts-expect-error InsertOther's table (otherTable) can't stand in for InsertPosts's (posts).
		const _otherAsPosts: InsertPosts = {} as InsertOther;
		// @ts-expect-error InsertPosts's table (posts) can't stand in for InsertOther's (otherTable).
		const _postsAsOther: InsertOther = {} as InsertPosts;
	});

	it("returning() (no projection) and returning({...}) (object projection) resolve to two different TReturning instantiations, not the same erased shape either way", () => {
		const wholeRow = insert(posts).values({ slug: "x" }).returning();
		const projected = insert(posts)
			.values({ slug: "x" })
			.returning({ id: posts.id });

		type WholeReturning = ExtractInsertReturning<typeof wholeRow>;
		type ProjectedReturning = ExtractInsertReturning<typeof projected>;

		expectTypeOf<WholeReturning>().toEqualTypeOf<undefined>();
		expectTypeOf<keyof ProjectedReturning>().toEqualTypeOf<"id">();
		expectTypeOf<ProjectedReturning["id"]>().toEqualTypeOf<typeof posts.id>();
		// @ts-expect-error "id" was the only key projected -- "slug" wasn't.
		type _NotProjected = ProjectedReturning["slug"];
	});

	it("the declared table is preserved through the whole chain (values -> returning), not widened to a bare Table", () => {
		const chain = insert(posts).values({ slug: "x" }).returning();
		expectTypeOf<ExtractInsertTable<typeof chain>>().toEqualTypeOf<
			typeof posts
		>();
	});

	it("runtime carries no trace of the generic -- InsertFinal/UpdateFinal/DeleteFinal keep compiling as the bare, non-generic names existing consumers use", () => {
		const insertStage: InsertFinal = insert(posts)
			.values({ slug: "x" })
			.returning();
		expect(Object.getOwnPropertySymbols(insertStage)).toHaveLength(0);
		expect(insertStage.insertQuery.queryKind).toBe("insert");
	});
});

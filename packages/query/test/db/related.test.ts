import {
	eq,
	jsonArrayFrom,
	jsonObjectFrom,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");
const users = table(app, "users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
});
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
	authorId: uuid()
		.notNull()
		.references(() => users.id),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid()
		.notNull()
		.references(() => posts.id),
	body: text().notNull(),
});

describe("related() chain method (add-relational-reads task 3.3)", () => {
	it("compiles to exactly the explicit jsonArrayFrom/jsonObjectFrom formulation", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, users, posts, comments }, driver);

		const sugared = handle
			.select(posts)
			.related({ comments: true, author: true })
			.compile();

		const explicit = compile(
			select(
				{
					id: posts.id,
					title: posts.title,
					authorId: posts.authorId,
					comments: jsonArrayFrom(
						select(comments).where(eq(comments.postId, posts.id)),
					),
					author: jsonObjectFrom(
						select(users).where(eq(users.id, posts.authorId)),
					),
				},
				posts,
			),
		);
		expect(sugared.sql).toBe(explicit.sql);
		expect(sugared.params).toEqual(explicit.params);
	});

	it("keeps the chain: where/limit after related() still compile through core", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, users, posts, comments }, driver);
		const compiled = handle
			.select(posts)
			.related({ comments: true })
			.where(eq(posts.title, "hello"))
			.limit(3)
			.compile();
		expect(compiled.sql).toContain('where "app"."posts"."title" = $1');
		expect(compiled.sql).toContain("limit 3");
	});

	it("types the merged row and rejects an unknown key", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, users, posts, comments }, driver);
		const chain = handle.select(posts).related({ comments: true });
		type Row = Awaited<typeof chain>[number];
		expectTypeOf<Row["title"]>().toEqualTypeOf<string>();
		expectTypeOf<Row["comments"]>().toEqualTypeOf<
			ReadonlyArray<{
				readonly id: string;
				readonly postId: string;
				readonly body: string;
			}>
		>();

		// The misspelled key is rejected on BOTH axes: the directive pins the
		// type-level rejection, and the runtime guard (the structural
		// false-positive backstop) throws unknown-relation eagerly.
		const misspell = () =>
			// @ts-expect-error a misspelled relation key is rejected at the type level
			handle.select(posts).related({ commets: true });
		expect(misspell).toThrowError();
		try {
			misspell();
			expect.unreachable("misspell() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("unknown-relation");
		}
	});
});

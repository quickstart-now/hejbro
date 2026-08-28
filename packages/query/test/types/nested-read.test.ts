import {
	bigint,
	eq,
	jsonArrayFrom,
	jsonObjectFrom,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { SelectResult } from "../../src/types/select-result";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	viewCount: bigint().notNull(),
	createdAt: timestamptz().notNull(),
});

describe("nested read result types (add-relational-reads task 3.1)", () => {
	it("a whole-table collection types as a rich row array; a single read as Row | null", () => {
		const projection = {
			id: posts.id,
			comments: jsonArrayFrom(
				select(comments).where(eq(comments.postId, posts.id)),
			),
			latest: jsonObjectFrom(
				select(comments).where(eq(comments.postId, posts.id)).limit(1),
			),
		};
		type Row = SelectResult<typeof projection>;

		// nested columns carry EXACTLY the declared read types -- bigint is
		// bigint and timestamptz is Date, nested or not (D102 cast+revive).
		expectTypeOf<Row["comments"]>().toEqualTypeOf<
			ReadonlyArray<{
				readonly id: string;
				readonly postId: string;
				readonly viewCount: bigint;
				readonly createdAt: Date;
			}>
		>();
		expectTypeOf<Row["latest"]>().toEqualTypeOf<{
			readonly id: string;
			readonly postId: string;
			readonly viewCount: bigint;
			readonly createdAt: Date;
		} | null>();
	});

	it("nesting recurses: a grandchild read keeps its shape", () => {
		const projection = {
			id: posts.id,
			comments: jsonArrayFrom(
				select(
					{
						id: comments.id,
						author: jsonObjectFrom(
							select(posts).where(eq(posts.id, comments.postId)),
						),
					},
					comments,
				).where(eq(comments.postId, posts.id)),
			),
		};
		type Row = SelectResult<typeof projection>;
		type Comment = Row["comments"][number];
		expectTypeOf<Comment["author"]>().toEqualTypeOf<{
			readonly id: string;
			readonly title: string;
		} | null>();
	});
});

import { schema, table, text, uuid } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { RelatedResult, RelationKeysOf } from "../../src/types/relations";

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
	editorId: uuid()
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
const declarations = { app, users, posts, comments };

describe("relation key derivation (add-relational-reads task 3.2)", () => {
	it("derives forward keys by the trailing-Id strip and reverse keys from the schema map", () => {
		// posts: forward author/editor (multi-FK to one table resolves
		// naturally), reverse comments (the referencing table's map key).
		expectTypeOf<
			RelationKeysOf<typeof declarations, typeof posts>
		>().toEqualTypeOf<"author" | "editor" | "comments">();
		// users: reverse only -- posts references it (twice, one key).
		expectTypeOf<
			RelationKeysOf<typeof declarations, typeof users>
		>().toEqualTypeOf<"posts">();
		// comments: forward post only; nothing references comments.
		expectTypeOf<
			RelationKeysOf<typeof declarations, typeof comments>
		>().toEqualTypeOf<"post">();
	});

	it("types a forward key as Row | null and a reverse key as a rich row array", () => {
		type PostRels = RelatedResult<
			typeof declarations,
			typeof posts,
			{ author: true; comments: true }
		>;
		expectTypeOf<PostRels["author"]>().toEqualTypeOf<{
			readonly id: string;
			readonly name: string;
		} | null>();
		expectTypeOf<PostRels["comments"]>().toEqualTypeOf<
			ReadonlyArray<{
				readonly id: string;
				readonly postId: string;
				readonly body: string;
			}>
		>();
	});
});

import { schema, table, uuid } from "hejbro";
import { comments } from "./b_blog.schema";

export const app = schema("app");

export const authors = table(app, "authors", {
	id: uuid().primaryKey().defaultRandom(),
	latestCommentId: uuid().references(() => comments.id),
});

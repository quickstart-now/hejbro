import { schema, table, uuid } from "hejbro";
import { authors } from "./a_app.schema";

export const blog = schema("blog");

export const comments = table(blog, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	authorId: uuid().references(() => authors.id),
});

import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

// A non-declaration export — loadDeclarations must ignore this, not throw.
export const helperConstant = 42;

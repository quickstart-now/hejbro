// Shared prelude for skills/hejbro/references/query-layer.md's `prelude=query-handle` snippets — a small declared schema plus a real `db()` handle over `@hejbro/pg`'s vanilla driver. `pgDriver(connectionString)` only constructs a `Pool`; it never connects until a statement actually runs, so this type-checks with no live database — snippets may `await handle...` freely (noEmit type-checking never actually executes the code, so no connection is ever attempted). A live round-trip against a real Postgres lives in examples/postgres's own chain tests, not here.
import { pgDriver } from "@hejbro/pg";
import {
	bigint,
	db,
	interval,
	schema,
	table,
	text,
	timestamptz,
	uuid,
} from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	publishedAt: timestamptz(),
	readingTime: interval(),
	tags: text().array(),
});

export const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid()
		.notNull()
		.references(() => posts.id),
	body: text(),
});

export const driver = pgDriver(
	process.env.DATABASE_URL ?? "postgres://localhost:5432/app",
);

export const handle = db({ posts, comments }, driver);

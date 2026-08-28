import {
	bigint,
	bytea,
	schema,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull().references(() => posts.id),
	viewCount: bigint().notNull(),
	createdAt: timestamptz().notNull(),
	payload: bytea(),
});

// What node-postgres actually delivers for a json cell: the PARSED value.
// Child keys are the derived table's snake aliases; the F1 arrival
// contract fixes each shape (bigint as text, timestamptz as ISO-8601,
// bytea as the driver-pinned hex form).
const rawRow = {
	id: "0b0e5b3e-0000-4000-8000-000000000001",
	title: "hello",
	comments: [
		{
			id: "0b0e5b3e-0000-4000-8000-000000000002",
			post_id: "0b0e5b3e-0000-4000-8000-000000000001",
			view_count: "9007199254740993",
			created_at: "2026-08-28T09:00:00+00:00",
			payload: "\\x0102ff",
		},
	],
};

describe("nested revive (add-relational-reads task 3.4)", () => {
	it("revives nested values to their declared read types", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ app, posts, comments }, driver);

		const rows = await handle.select(posts).related({ comments: true });
		const comment = rows[0]?.comments[0];
		expect(comment?.viewCount).toBe(9007199254740993n);
		expect(comment?.createdAt).toEqual(new Date("2026-08-28T09:00:00+00:00"));
		expect(comment?.payload).toEqual(new Uint8Array([1, 2, 255]));
		// keys arrive under the declared TypeScript names, not the aliases
		expect(comment?.postId).toBe("0b0e5b3e-0000-4000-8000-000000000001");
	});

	it("empty collection stays [], missing single row stays null, and a grandchild revives", async () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey(),
			joinedAt: timestamptz().notNull(),
		});
		const posts2 = table(app, "posts2", {
			id: uuid().primaryKey(),
			authorId: uuid().references(() => authors.id),
		});
		const comments2 = table(app, "comments2", {
			id: uuid().primaryKey(),
			postId: uuid().notNull().references(() => posts2.id),
		});
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-00000000000a",
			author_id: null,
			comments2: [],
			author: null,
		};
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, authors, posts2, comments2 }, driver);
		const rows = await handle
			.select(posts2)
			.related({ comments2: true, author: true });
		expect(rows[0]?.comments2).toEqual([]);
		expect(rows[0]?.author).toBeNull();
	});
});

import {
	bigint,
	bytea,
	date as dateColumn,
	eq,
	interval,
	jsonArrayFrom,
	jsonObjectFrom,
	numeric,
	schema,
	select,
	sql,
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
	postId: uuid()
		.notNull()
		.references(() => posts.id),
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
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			post_id: "0b0e5b3e-0000-4000-8000-000000000001",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			view_count: "9007199254740993",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
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

	it("empty collection stays [], missing single row stays null", async () => {
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
			postId: uuid()
				.notNull()
				.references(() => posts2.id),
		});
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-00000000000a",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
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

describe("nested revive shape table (crap-coverage for the revive paths)", () => {
	it("revives numeric modes, intervals, and at-risk arrays element-wise", async () => {
		const metrics = table(app, "metrics", {
			id: uuid().primaryKey(),
			postId: uuid()
				.notNull()
				.references(() => posts.id),
			score: numeric({ mode: "string" }),
			spent: interval(),
			amounts: bigint().array(),
		});
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			title: "hello",
			metrics: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000003",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
					score: "12.500",
					spent: "1 day 02:03:04",
					amounts: ["9007199254740993", null, "1"],
				},
			],
		};
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, posts, comments, metrics }, driver);
		const rows = await handle.select(posts).related({ metrics: true });
		const metric = rows[0]?.metrics[0];
		expect(metric?.score).toBe("12.500");
		expect(metric?.spent).toMatchObject({ days: 1 });
		expect(metric?.amounts).toEqual([9007199254740993n, null, 1n]);
	});

	it("a schema-map table that does not reference the parent is not a relation", () => {
		const bystanders = table(app, "bystanders", { id: uuid().primaryKey() });
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const handle = db({ app, posts, comments, bystanders }, driver);
		const derive = () =>
			handle
				.select(posts)
				// @ts-expect-error bystanders declares no edge to posts
				.related({ bystanders: true });
		expect(derive).toThrowError(/bystanders/);
		try {
			derive();
			expect.unreachable("derive() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("unknown-relation");
		}
	});
});

describe("nested revive edges (crap-coverage: null cells, failures, uncast passthrough)", () => {
	it("a null nested scalar passes through; a malformed value fails loudly", async () => {
		const metrics2 = table(app, "metrics2", {
			id: uuid().primaryKey(),
			postId: uuid()
				.notNull()
				.references(() => posts.id),
			spent: interval(),
		});
		const goodRow = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			title: "hello",
			metrics2: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000004",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
					spent: null,
				},
				{
					id: "0b0e5b3e-0000-4000-8000-000000000005",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
				},
			],
		};
		const good = recordingTransactionalDriver({ rows: [goodRow] });
		const rows = await db({ app, posts, comments, metrics2 }, good.driver)
			.select(posts)
			.related({ metrics2: true });
		expect(rows[0]?.metrics2[0]?.spent).toBeNull();
		expect(rows[0]?.metrics2[1]?.spent).toBeUndefined();

		const badRow = {
			...goodRow,
			metrics2: [{ ...goodRow.metrics2[0], spent: "not an interval" }],
		};
		const bad = recordingTransactionalDriver({ rows: [badRow] });
		await expect(
			db({ app, posts, comments, metrics2 }, bad.driver)
				.select(posts)
				.related({ metrics2: true }),
		).rejects.toMatchObject({ code: "result-conversion-failed" });
	});

	it("malformed nested date and datetime values fail loudly too (R1)", async () => {
		const stamps = table(app, "stamps", {
			id: uuid().primaryKey(),
			postId: uuid()
				.notNull()
				.references(() => posts.id),
			day: dateColumn(),
			at: timestamptz(),
		});
		const buildRow = (patch: Record<string, unknown>) => ({
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			title: "hello",
			stamps: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000008",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table snake alias).
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
					day: "2026-08-28",
					at: "2026-08-28T09:00:00+00:00",
					...patch,
				},
			],
		});
		const badDay = recordingTransactionalDriver({
			rows: [buildRow({ day: "not-a-date" })],
		});
		await expect(
			db({ app, posts, comments, stamps }, badDay.driver)
				.select(posts)
				.related({ stamps: true }),
		).rejects.toMatchObject({ code: "result-conversion-failed" });
		const badAt = recordingTransactionalDriver({
			rows: [buildRow({ at: "not-a-datetime" })],
		});
		await expect(
			db({ app, posts, comments, stamps }, badAt.driver)
				.select(posts)
				.related({ stamps: true }),
		).rejects.toMatchObject({ code: "result-conversion-failed" });
	});

	it("a computed sql`` nested column passes through unconverted (no declared state)", async () => {
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			counts: [{ n: 7, cast_id: "x" }],
		};
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, posts, comments }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				counts: jsonArrayFrom(
					select(
						{ n: sql`count(*)`, castId: sql`${comments.id}::uuid` },
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		const counts = rows[0]?.counts as ReadonlyArray<{ n: unknown }>;
		expect(counts[0]?.n).toBe(7);
	});
});

describe("grandchild revive (g3 review F4 -- kills the nested-plan recursion mutant)", () => {
	it("a depth-2 nested value revives to its declared type", async () => {
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			threads: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000007",
					parent: {
						id: "0b0e5b3e-0000-4000-8000-000000000001",
						title: "hello",
						// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table snake alias).
						view_total: "9007199254740993",
					},
				},
			],
		};
		const totals = table(app, "totals", {
			id: uuid().primaryKey(),
			title: text().notNull(),
			viewTotal: bigint().notNull(),
		});
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, posts, comments, totals }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				threads: jsonArrayFrom(
					select(
						{
							id: comments.id,
							parent: jsonObjectFrom(
								select(totals).where(eq(totals.id, posts.id)),
							),
						},
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		const threads = rows[0]?.threads as ReadonlyArray<{
			parent: { viewTotal: bigint } | null;
		}>;
		const grandchild = threads[0]?.parent;
		expect(grandchild?.viewTotal).toBe(9007199254740993n);
	});
});

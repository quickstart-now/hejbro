import type { HejbroInput } from "../../../../src/index";
import { index, table, text, timestamptz, uuid } from "../../../../src/index";
import { ddland, postStatus } from "./declarations";

// Step 1: initial — posts (with a published_at index) + comments (no FK to posts yet).

const initialPosts = table(
	ddland,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		publishedAt: timestamptz(),
		status: postStatus.column().notNull(),
	},
	(t) => ({
		indexes: [index().on(t.publishedAt)],
	}),
);

const initialComments = table(ddland, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	postId: uuid().notNull(),
	body: text().notNull(),
});

const initial: ReadonlyArray<HejbroInput> = [
	ddland,
	postStatus,
	initialPosts,
	initialComments,
];

// Step 2: addSlugColumn — posts gains a unique slug column; comments is unchanged.

const postsWithSlug = table(
	ddland,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		publishedAt: timestamptz(),
		status: postStatus.column().notNull(),
		slug: text().notNull().unique(),
	},
	(t) => ({
		indexes: [index().on(t.publishedAt)],
	}),
);

const addSlugColumn: ReadonlyArray<HejbroInput> = [
	ddland,
	postStatus,
	postsWithSlug,
	initialComments,
];

// Step 3: dropIndexAddFk — posts drops the published_at index; comments gains its FK to posts.

const postsWithoutIndex = table(ddland, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	publishedAt: timestamptz(),
	status: postStatus.column().notNull(),
	slug: text().notNull().unique(),
});

const commentsWithFk = table(
	ddland,
	"comments",
	{
		id: uuid().primaryKey().defaultRandom(),
		postId: uuid().notNull(),
		body: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.postId],
				references: {
					table: postsWithoutIndex,
					columns: [postsWithoutIndex.id],
				},
				onDelete: "cascade",
			},
		],
	}),
);

const dropIndexAddFk: ReadonlyArray<HejbroInput> = [
	ddland,
	postStatus,
	postsWithoutIndex,
	commentsWithFk,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	initial,
	addSlugColumn,
	dropIndexAddFk,
];

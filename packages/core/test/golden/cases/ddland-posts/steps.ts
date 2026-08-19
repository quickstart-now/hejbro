import type { HejbroDeclaration } from "../../../../src/index";
import { table, text, timestamptz, uuid } from "../../../../src/index";
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
	(helpers) => ({
		indexes: [
			{
				columns: [helpers.column("publishedAt")],
				unique: false,
				indexName: null,
			},
		],
	}),
);

const initialComments = table(ddland, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	postId: uuid().notNull(),
	body: text().notNull(),
});

const initial: ReadonlyArray<HejbroDeclaration> = [
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
	(helpers) => ({
		indexes: [
			{
				columns: [helpers.column("publishedAt")],
				unique: false,
				indexName: null,
			},
		],
	}),
);

const addSlugColumn: ReadonlyArray<HejbroDeclaration> = [
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
	(helpers) => ({
		foreignKeys: [
			{
				columns: [helpers.column("postId")],
				references: { table: postsWithoutIndex, columns: ["id"] },
				onDelete: "cascade",
			},
		],
	}),
);

const dropIndexAddFk: ReadonlyArray<HejbroDeclaration> = [
	ddland,
	postStatus,
	postsWithoutIndex,
	commentsWithFk,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroDeclaration>> = [
	initial,
	addSlugColumn,
	dropIndexAddFk,
];

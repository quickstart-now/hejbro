import type { HejbroInput } from "../../../../src/index";
import { check, inArray, sql, table, text, uuid } from "../../../../src/index";
import { app, comments, posts } from "./declarations";

// Step 0: from empty — posts (two checks) and comments (self-FK + FK to
// posts with on delete set null / on update cascade + a body-length check).

const fromEmpty: ReadonlyArray<HejbroInput> = [app, posts, comments];

// Step 1: the status CHECK list gains "archived", and the posts foreign key
// swaps its actions (on delete set null / on update cascade →
// on delete cascade / on update restrict). The self-FK and both other
// checks stay identical, so the diff isolates one check change and one
// foreign key change.

const postsStatusExpanded = table(
	app,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		status: text().notNull(),
		slug: text().notNull(),
	},
	(t) => ({
		checks: [
			check(
				"posts_status_check",
				inArray(t.status, ["draft", "published", "archived"]),
			),
			check("posts_slug_format_check", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
		],
	}),
);

const commentsActionsChanged = table(
	app,
	"comments",
	{
		id: uuid().primaryKey().defaultRandom(),
		postId: uuid().notNull(),
		parentId: uuid(),
		body: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.parentId],
				references: { columns: [t.id] },
				onDelete: "cascade",
			},
			{
				columns: [t.postId],
				references: {
					table: postsStatusExpanded,
					columns: [postsStatusExpanded.id],
				},
				onDelete: "cascade",
				onUpdate: "restrict",
			},
		],
		checks: [check("comments_body_length_check", sql`length(${t.body}) > 0`)],
	}),
);

const statusAndActionsChanged: ReadonlyArray<HejbroInput> = [
	app,
	postsStatusExpanded,
	commentsActionsChanged,
];

// Step 2: the comments body-length CHECK is dropped. Everything else stays
// identical to step 1 (same posts table, same FK actions, same self-FK).

const commentsBodyCheckDropped = table(
	app,
	"comments",
	{
		id: uuid().primaryKey().defaultRandom(),
		postId: uuid().notNull(),
		parentId: uuid(),
		body: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.parentId],
				references: { columns: [t.id] },
				onDelete: "cascade",
			},
			{
				columns: [t.postId],
				references: {
					table: postsStatusExpanded,
					columns: [postsStatusExpanded.id],
				},
				onDelete: "cascade",
				onUpdate: "restrict",
			},
		],
	}),
);

const bodyCheckDropped: ReadonlyArray<HejbroInput> = [
	app,
	postsStatusExpanded,
	commentsBodyCheckDropped,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	statusAndActionsChanged,
	bodyCheckDropped,
];

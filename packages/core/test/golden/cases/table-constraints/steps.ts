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

// Steps 3-5 (#24): a fresh join table (post_tags), never touched by any
// other table's foreign key, carries the primary key constraint through
// its own full lifecycle -- created single-column, expanded to composite,
// then partially dropped (#137's own hazard: a composite PK's *partial*
// drop, one member column physically removed while the other survives).
// A fresh table (not posts/comments) is deliberate: posts.id and
// comments.id are both FK *targets* elsewhere in this same case, and
// widening either into a composite PK would make it no longer uniquely
// constrained on its own -- invalid against a real Postgres. post_tags
// has no such entanglement, so its PK's own shape is free to move.

// Step 3: post_tags is created with a single-column primary key (postId)
// and a foreign key to posts.id -- ordinary create, no ALTER involved yet.
const postTagsSingleColumnPk = table(
	app,
	"post_tags",
	{
		postId: uuid().notNull().primaryKey(),
		tagSlug: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.postId],
				references: {
					table: postsStatusExpanded,
					columns: [postsStatusExpanded.id],
				},
			},
		],
	}),
);

const postTagsCreated: ReadonlyArray<HejbroInput> = [
	app,
	postsStatusExpanded,
	commentsBodyCheckDropped,
	postTagsSingleColumnPk,
];

// Step 4: tagSlug also becomes a primary-key column -- postId alone can no
// longer name the constraint (composite (postId, tagSlug) now models "each
// post has each tag at most once"). Exercises planPrimaryKeyChange's
// single-to-composite expansion: the old single-column "post_tags_pkey" is
// explicitly dropped and a new composite one, same name, added -- a
// constraint's column list can't be ALTERed in place on a real Postgres,
// only replaced.
const postTagsCompositePk = table(
	app,
	"post_tags",
	{
		postId: uuid().notNull().primaryKey(),
		tagSlug: text().notNull().primaryKey(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.postId],
				references: {
					table: postsStatusExpanded,
					columns: [postsStatusExpanded.id],
				},
			},
		],
	}),
);

const postTagsExpandedToComposite: ReadonlyArray<HejbroInput> = [
	app,
	postsStatusExpanded,
	commentsBodyCheckDropped,
	postTagsCompositePk,
];

// Step 5: tagSlug is dropped as a column entirely -- #137's own hazard,
// now fixed (#24): postId survives as the sole primary-key column, and
// hejbro must not rely on Postgres's cascade (which *would* silently drop
// the whole constraint, then never re-add it for the survivor) -- an
// explicit drop constraint (ahead of the drop column) and a fresh add
// constraint naming just postId, same "post_tags_pkey" name throughout.
const postTagsTagSlugDropped = table(
	app,
	"post_tags",
	{
		postId: uuid().notNull().primaryKey(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.postId],
				references: {
					table: postsStatusExpanded,
					columns: [postsStatusExpanded.id],
				},
			},
		],
	}),
);

const postTagsBackToSingleColumnPk: ReadonlyArray<HejbroInput> = [
	app,
	postsStatusExpanded,
	commentsBodyCheckDropped,
	postTagsTagSlugDropped,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	statusAndActionsChanged,
	bodyCheckDropped,
	postTagsCreated,
	postTagsExpandedToComposite,
	postTagsBackToSingleColumnPk,
];

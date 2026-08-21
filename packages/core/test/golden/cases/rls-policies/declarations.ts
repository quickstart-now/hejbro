import {
	and,
	eq,
	exists,
	isNotNull,
	isNull,
	rls,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";

/**
 * The original production schema (spec §5.1), extended with row-level security
 * (Phase 4 acceptance case): `posts` is readable when published; `comments`
 * is readable when not soft-deleted and its post is published — a
 * correlated `exists()` reaching from `comments` back to `posts` (D26).
 */
export const app = schema("app");

export const posts = table(
	app,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		status: text().notNull(),
		publishedAt: timestamptz(),
	},
	(t) => ({
		rls: rls.enabled({
			readPublished: rls
				.policy("posts_read_published")
				.for("select")
				.to("anon")
				.using(and(eq(t.status, "published"), isNotNull(t.publishedAt))),
		}),
	}),
);

export const comments = table(
	app,
	"comments",
	{
		id: uuid().primaryKey().defaultRandom(),
		postId: uuid().notNull(),
		deletedAt: timestamptz(),
	},
	(t) => ({
		rls: rls.enabled({
			readVisible: rls
				.policy("comments_read_visible")
				.for("select")
				.to("anon")
				.using(
					and(
						isNull(t.deletedAt),
						exists(
							select(posts).where(
								and(eq(posts.id, t.postId), eq(posts.status, "published")),
							),
						),
					),
				),
		}),
	}),
);

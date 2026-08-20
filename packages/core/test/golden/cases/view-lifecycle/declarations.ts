import {
	defineView,
	isNotNull,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";

/** The original production schema (spec §5.1), extended with a published-posts view (Phase 4 acceptance case, D27). */
export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

export const publishedPosts = defineView(
	app,
	"published_posts",
	select(posts).where(isNotNull(posts.publishedAt)),
);

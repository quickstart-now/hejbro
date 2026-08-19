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

/** The dd.land example schema (spec §5.1), extended with a published-posts view (Phase 4 acceptance case, D27). */
export const ddland = schema("ddland");

export const posts = table(ddland, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

export const publishedPosts = defineView(
	ddland,
	"published_posts",
	select(posts).where(isNotNull(posts.publishedAt)),
);

import {
	desc,
	index,
	isNotNull,
	schema,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";

/** The table-indexes acceptance case (Phase 7 / D51): ordered index columns (`asc`/`desc`, `nulls`), a partial unique index's `where`, and a derived (unnamed) index name — pins the v3 snapshot shape and Task 12's changed-index recreate path. */
export const app = schema("app");

export const posts = table(
	app,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		slug: text().notNull(),
		status: text().notNull(),
		createdAt: timestamptz(),
		publishedAt: timestamptz(),
	},
	(t) => ({
		indexes: [
			index("posts_recent_idx").on(
				t.createdAt,
				desc(t.publishedAt, { nulls: "first" }),
			),
			index("posts_slug_published_uidx")
				.unique()
				.on(t.slug)
				.where(isNotNull(t.publishedAt)),
			index().on(t.status),
		],
	}),
);

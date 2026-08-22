import {
	check,
	inArray,
	schema,
	sql,
	table,
	text,
	uuid,
} from "../../../../src/index";

/** The table-constraints acceptance case (Phase 7 / D50–D52): CHECK constraints (a typed helper and a `sql` template), a self-referencing foreign key, and foreign key `on delete`/`on update` actions on one non-self table. */
export const app = schema("app");

export const posts = table(
	app,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		status: text().notNull(),
		slug: text().notNull(),
	},
	(t) => ({
		checks: [
			check("posts_status_check", inArray(t.status, ["draft", "published"])),
			check("posts_slug_format_check", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
		],
	}),
);

export const comments = table(
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
				references: { table: posts, columns: [posts.id] },
				onDelete: "set null",
				onUpdate: "cascade",
			},
		],
		checks: [check("comments_body_length_check", sql`length(${t.body}) > 0`)],
	}),
);

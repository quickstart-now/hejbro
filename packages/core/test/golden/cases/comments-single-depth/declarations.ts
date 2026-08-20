import {
	defineTrigger,
	eq,
	isNotNull,
	isNull,
	ne,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";

/** The original production schema (spec §5.1), extended with the comments-single-depth trigger for the Phase 3 acceptance case. */
export const app = schema("app");
export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull().unique(),
	publishedAt: timestamptz(),
});
export const comments = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	postId: uuid().notNull(),
	parentId: uuid(),
	body: text().notNull(),
});

/**
 * A 1:1 port of the original hand-written `comments_single_depth` trigger
 * (the original project's migrations, `20260815110756_smiling_whizzer.sql`
 * lines 203–241) — the phase 3 acceptance artifact. The FK from
 * `comments.postId`/`parentId` is omitted here to keep the case focused;
 * the raise messages stay Korean byte-for-byte — they are user data, not
 * GitHub-facing text.
 */
export const commentsSingleDepth = defineTrigger(
	comments,
	{
		name: "comments_single_depth",
		timing: "before",
		events: ["insert", { update: ["parentId", "postId"] }],
		forEach: "row",
		functionName: "comments_enforce_single_depth",
	},
	(ctx, { new: row }) => {
		ctx.if(isNull(row.parentId), () => {
			ctx.return(row);
		});
		const parent = ctx.rowOrNull(
			select(
				{ postId: comments.postId, parentId: comments.parentId },
				comments,
			).where(eq(comments.id, row.parentId)),
			"parent",
		);
		ctx.if(isNull(parent.postId), () => {
			ctx.raise("부모 댓글을 찾을 수 없다 (parent_id=%)", row.parentId);
		});
		ctx.if(isNotNull(parent.parentId), () => {
			ctx.raise("답글은 한 단계까지만 달 수 있다 (parent_id=%)", row.parentId);
		});
		ctx.if(ne(parent.postId, row.postId), () => {
			ctx.raise(
				"답글은 부모와 같은 글에 달아야 한다 (post_id=%, 부모의 post_id=%)",
				row.postId,
				parent.postId,
			);
		});
		ctx.return(row);
	},
);

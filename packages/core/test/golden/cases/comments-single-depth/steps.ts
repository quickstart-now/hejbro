import type { HejbroInput } from "../../../../src/index";
import {
	defineTrigger,
	eq,
	isNotNull,
	isNull,
	ne,
	select,
} from "../../../../src/index";
import { comments, commentsSingleDepth, ddland, posts } from "./declarations";

// Step 0: from empty — posts, comments, and the comments-single-depth trigger.

const fromEmpty: ReadonlyArray<HejbroInput> = [
	ddland,
	posts,
	comments,
	commentsSingleDepth,
];

// Step 1: bodyOnlyChange — the trigger body's first raise message changes;
// everything else (timing/events/forEach/functionName) stays identical.
// Proves a body-only change emits `create or replace function` without
// touching the trigger.

const commentsSingleDepthBodyChanged = defineTrigger(
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
			ctx.raise("부모 댓글을 찾을 수 없습니다 (parent_id=%)", row.parentId);
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

const bodyOnlyChange: ReadonlyArray<HejbroInput> = [
	ddland,
	posts,
	comments,
	commentsSingleDepthBodyChanged,
];

// Step 2: triggerDefChange — same (already-changed) body as step 1, but
// `events` drops the `update of` clause down to `insert` only. Proves a
// trigger-definition change emits drop+create of the trigger only (the
// function's body/signature are unchanged, so no function change).

const commentsSingleDepthEventsChanged = defineTrigger(
	comments,
	{
		name: "comments_single_depth",
		timing: "before",
		events: ["insert"],
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
			ctx.raise("부모 댓글을 찾을 수 없습니다 (parent_id=%)", row.parentId);
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

const triggerDefChange: ReadonlyArray<HejbroInput> = [
	ddland,
	posts,
	comments,
	commentsSingleDepthEventsChanged,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	bodyOnlyChange,
	triggerDefChange,
];

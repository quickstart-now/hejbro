import type { HejbroInput } from "../../../../src/index";
import {
	defineTrigger,
	eq,
	isNotNull,
	isNull,
	ne,
	select,
} from "../../../../src/index";
import { app, comments, commentsSingleDepth, posts } from "./declarations";

// Step 0: from empty — posts, comments, and the comments-single-depth trigger.

const fromEmpty: ReadonlyArray<HejbroInput> = [
	app,
	posts,
	comments,
	commentsSingleDepth,
];

// Step 1: bodyOnlyChange — the trigger body's first raise message changes;
// everything else (timing/events/forEach/functionName) stays identical.
// Proves a body-only change emits `create or replace function` without
// touching the trigger.
//
// The "parent not found" message below is deliberately reworded from the
// one in declarations.ts (not just re-punctuated) — a body-only-change
// step is only a real test if the trigger body's plpgsql source, and thus
// its `bodyHash`, actually differs from the previous step. If a future
// edit makes the two messages read the same, this step silently stops
// testing anything: `expected/step-1.sql` would lose its
// `[body changed]` banner and `bodyHash` would stop moving between step 0
// and step 1, while the test itself stays green.

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
			ctx.raise(
				"Could not find the parent comment (parent_id=%)",
				row.parentId,
			);
		});
		ctx.if(isNotNull(parent.parentId), () => {
			ctx.raise(
				"Replies can only be nested one level deep (parent_id=%)",
				row.parentId,
			);
		});
		ctx.if(ne(parent.postId, row.postId), () => {
			ctx.raise(
				"A reply must belong to the same post as its parent (post_id=%, parent's post_id=%)",
				row.postId,
				parent.postId,
			);
		});
		ctx.return(row);
	},
);

const bodyOnlyChange: ReadonlyArray<HejbroInput> = [
	app,
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
			ctx.raise(
				"Could not find the parent comment (parent_id=%)",
				row.parentId,
			);
		});
		ctx.if(isNotNull(parent.parentId), () => {
			ctx.raise(
				"Replies can only be nested one level deep (parent_id=%)",
				row.parentId,
			);
		});
		ctx.if(ne(parent.postId, row.postId), () => {
			ctx.raise(
				"A reply must belong to the same post as its parent (post_id=%, parent's post_id=%)",
				row.postId,
				parent.postId,
			);
		});
		ctx.return(row);
	},
);

const triggerDefChange: ReadonlyArray<HejbroInput> = [
	app,
	posts,
	comments,
	commentsSingleDepthEventsChanged,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	bodyOnlyChange,
	triggerDefChange,
];

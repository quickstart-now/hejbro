import type { HejbroInput } from "../../../../src/index";
import {
	isNotNull,
	rls,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";
import { app, comments, posts } from "./declarations";

// Step 0: from empty — posts and comments, each with their own rls policy.

const fromEmpty: ReadonlyArray<HejbroInput> = [app, posts, comments];

// Step 1: posts' policy expression drops the `status` conjunct (down to
// just `isNotNull(publishedAt)`), and posts' rls gains `{ force: true }`.
// comments is unchanged — proves a policy body change and an rls force
// flip land as one recreate pair and one force statement, without
// touching comments' unrelated policy.

const postsForceChanged = table(
	app,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		status: text().notNull(),
		publishedAt: timestamptz(),
	},
	(t) => ({
		rls: rls.enabled(
			{
				readPublished: rls
					.policy("posts_read_published")
					.for("select")
					.to("anon")
					.using(isNotNull(t.publishedAt)),
			},
			{ force: true },
		),
	}),
);

const policyAndForceChange: ReadonlyArray<HejbroInput> = [
	app,
	postsForceChanged,
	comments,
];

// Step 2: comments loses its rls extras entirely — expect a policy drop
// followed by an rls disable statement (policy depends on rls and table,
// so its drop is ordered first).

const commentsRlsRemoved = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	postId: uuid().notNull(),
	deletedAt: timestamptz(),
});

const commentsRlsDropped: ReadonlyArray<HejbroInput> = [
	app,
	postsForceChanged,
	commentsRlsRemoved,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	policyAndForceChange,
	commentsRlsDropped,
];

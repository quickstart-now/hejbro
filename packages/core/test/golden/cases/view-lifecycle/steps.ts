import type { HejbroInput } from "../../../../src/index";
import { and, defineView, eq, isNotNull, select } from "../../../../src/index";
import { app, posts, publishedPosts } from "./declarations";

// Step 0: from empty — posts and its published_posts view.

const fromEmpty: ReadonlyArray<HejbroInput> = [app, posts, publishedPosts];

// Step 1: tightened where clause, same (allColumns) column list — proves a
// body-only change stays a single `create or replace view`, no drop.

const tightenedWhere = defineView(
	app,
	"published_posts",
	select(posts).where(
		and(isNotNull(posts.publishedAt), eq(posts.status, "published")),
	),
);

const bodyOnlyChange: ReadonlyArray<HejbroInput> = [app, posts, tightenedWhere];

// Step 2: switches to an object projection that drops the `publishedAt`
// column — not a prefix of the previous (allColumns) list, so it recreates:
// `drop view if exists` then `create or replace view`.

const droppedColumn = defineView(
	app,
	"published_posts",
	select({ id: posts.id, status: posts.status }, posts),
);

const columnDropRecreate: ReadonlyArray<HejbroInput> = [
	app,
	posts,
	droppedColumn,
];

// Step 3: the view declaration is removed entirely — expect `drop view if
// exists` alone.

const viewRemoved: ReadonlyArray<HejbroInput> = [app, posts];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	bodyOnlyChange,
	columnDropRecreate,
	viewRemoved,
];

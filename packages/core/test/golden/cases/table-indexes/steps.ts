import type { HejbroInput } from "../../../../src/index";
import {
	desc,
	eq,
	index,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";
import { app, posts } from "./declarations";

// Step 0: from empty — posts with an ordered index, a partial unique index,
// and a derived (unnamed) index name.

const fromEmpty: ReadonlyArray<HejbroInput> = [app, posts];

// Step 1: posts_recent_idx is redefined under the same name — column order
// swaps and the sort/nulls direction flips (desc/first → desc/last on the
// other column) — exercising Task 12's drop+create path for a
// same-name index whose definition changed. The partial unique index's
// `where` also changes (isNotNull → an equality predicate). The derived
// index on `status` is unchanged.

const postsIndexesRedefined = table(
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
				desc(t.publishedAt, { nulls: "last" }),
				t.createdAt,
			),
			index("posts_slug_published_uidx")
				.unique()
				.on(t.slug)
				.where(eq(t.status, "published")),
			index().on(t.status),
		],
	}),
);

const indexesRedefined: ReadonlyArray<HejbroInput> = [
	app,
	postsIndexesRedefined,
];

// Step 2: the derived-name index on `status` is dropped. The two named
// indexes stay exactly as step 1 left them.

const postsDerivedIndexDropped = table(
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
				desc(t.publishedAt, { nulls: "last" }),
				t.createdAt,
			),
			index("posts_slug_published_uidx")
				.unique()
				.on(t.slug)
				.where(eq(t.status, "published")),
		],
	}),
);

const derivedIndexDropped: ReadonlyArray<HejbroInput> = [
	app,
	postsDerivedIndexDropped,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	indexesRedefined,
	derivedIndexDropped,
];

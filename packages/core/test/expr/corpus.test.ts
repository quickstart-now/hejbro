import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	and,
	between,
	coalesce,
	deleteFrom,
	eq,
	exists,
	genRandomUuid,
	gt,
	gte,
	ilike,
	inArray,
	insert,
	integer,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
	notBetween,
	notExists,
	notIlike,
	notInArray,
	notLike,
	now,
	or,
	renderExpr,
	renderQuery,
	schema,
	select,
	sql,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	slug: text().notNull(),
	views: integer().notNull(),
	publishedAt: timestamptz(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	body: text().notNull(),
});
const reactions = table(app, "reactions", {
	id: uuid().primaryKey(),
	commentId: uuid().notNull(),
});

const commentsTableRef = { schemaName: "app", tableName: "comments" };
const reactionsTableRef = { schemaName: "app", tableName: "reactions" };

// The correlated "comment's post is published" guard — the canonical rls
// form used both to filter reads (using) and to constrain writes (with
// check). Same AST, exercised standalone with an inherited outer scope
// exactly how Phase 4 will render a policy on `comments` (Task 8 scope
// rule): renderExpr(node, [commentsTableRef]).
const correlatedPostPublishedGuard = exists(
	select(posts).where(
		and(eq(posts.id, comments.postId), isNotNull(posts.publishedAt)),
	),
).exprNode;

// The `reactions` policy shape: a reaction is visible iff its comment's
// post is published — exists + inner join, correlated against the outer
// `reactions` row (spec §5.1's reaction/comment/post chain).
const reactionCommentPostPublishedGuard = exists(
	select(comments)
		.innerJoin(posts, eq(comments.postId, posts.id))
		.where(
			and(eq(comments.id, reactions.commentId), eq(posts.status, "published")),
		),
).exprNode;

// Same correlated guard, negated (`notExists`) — exercises the "not
// exists (…)" rendering branch, which no other corpus entry reaches.
const correlatedPostNotPublishedGuard = notExists(
	select(posts).where(
		and(eq(posts.id, comments.postId), isNotNull(posts.publishedAt)),
	),
).exprNode;

type CorpusEntry = { readonly label: string; readonly sql: string };

const corpus: ReadonlyArray<CorpusEntry> = [
	// --- Task 4 operators, every one at least once ---
	{ label: "eq", sql: renderExpr(eq(posts.status, "published").exprNode) },
	{ label: "ne", sql: renderExpr(ne(posts.status, "draft").exprNode) },
	{ label: "gt", sql: renderExpr(gt(posts.views, 10).exprNode) },
	{ label: "gte", sql: renderExpr(gte(posts.views, 10).exprNode) },
	{ label: "lt", sql: renderExpr(lt(posts.views, 10).exprNode) },
	{ label: "lte", sql: renderExpr(lte(posts.views, 10).exprNode) },
	{ label: "like", sql: renderExpr(like(posts.slug, "post-%").exprNode) },
	{ label: "ilike", sql: renderExpr(ilike(posts.slug, "POST-%").exprNode) },
	{
		label: "notLike",
		sql: renderExpr(notLike(posts.slug, "draft-%").exprNode),
	},
	{
		label: "notIlike",
		sql: renderExpr(notIlike(posts.slug, "DRAFT-%").exprNode),
	},
	{ label: "isNull", sql: renderExpr(isNull(posts.publishedAt).exprNode) },
	{
		label: "isNotNull",
		sql: renderExpr(isNotNull(posts.publishedAt).exprNode),
	},
	{
		label: "and",
		sql: renderExpr(
			and(eq(posts.status, "published"), isNotNull(posts.publishedAt)).exprNode,
		),
	},
	{
		label: "or",
		sql: renderExpr(
			or(eq(posts.status, "published"), eq(posts.status, "draft")).exprNode,
		),
	},
	{
		label: "not",
		sql: renderExpr(not(eq(posts.status, "draft")).exprNode),
	},
	{
		label: "inArray",
		sql: renderExpr(inArray(posts.status, ["draft", "published"]).exprNode),
	},
	{
		label: "notInArray",
		sql: renderExpr(notInArray(posts.status, ["archived", "deleted"]).exprNode),
	},
	{
		label: "between",
		sql: renderExpr(between(posts.views, 10, 100).exprNode),
	},
	{
		label: "notBetween",
		sql: renderExpr(notBetween(posts.views, 10, 100).exprNode),
	},
	{ label: "now", sql: renderExpr(now().exprNode) },
	{ label: "genRandomUuid", sql: renderExpr(genRandomUuid().exprNode) },
	{
		label: "coalesce",
		sql: renderExpr(coalesce(posts.status, "unknown").exprNode),
	},

	// --- literal edge cases ---
	{
		label: "literal embedded quote",
		sql: renderExpr(eq(posts.slug, "it's").exprNode),
	},
	{
		label: "literal injection string (comparison)",
		sql: renderExpr(eq(posts.slug, "'; drop table users; --").exprNode),
	},
	{
		label: "literal injection string (sql template)",
		sql: renderExpr(sql`name = ${"x'; drop table posts; --"}`.exprNode),
	},
	{
		label: "literal negative number",
		sql: renderExpr(gt(posts.views, -5).exprNode),
	},
	{
		label: "literal fractional number",
		sql: renderExpr(gte(posts.views, 3.14).exprNode),
	},
	{
		label: "literal Date",
		sql: renderExpr(
			eq(posts.publishedAt, new Date("2026-08-19T00:00:00.000Z")).exprNode,
		),
	},

	// --- sql template + sql.raw ---
	{
		label: "sql template splices expr and literal",
		sql: renderExpr(sql`char_length(${posts.slug}) > ${3}`.exprNode),
	},
	{ label: "sql.raw verbatim", sql: renderExpr(sql.raw("1 = 1").exprNode) },

	// --- app schema RLS shapes (D19) ---
	{
		label: "using: and/or grouping",
		sql: renderExpr(
			or(
				and(eq(posts.status, "published"), isNotNull(posts.publishedAt)),
				eq(posts.status, "draft"),
			).exprNode,
		),
	},
	{
		label: "using: exists + inner join (reaction's comment's post published)",
		sql: renderExpr(reactionCommentPostPublishedGuard, [reactionsTableRef]),
	},
	{
		label: "using: correlated exists with outer scope (comments policy)",
		sql: renderExpr(correlatedPostPublishedGuard, [commentsTableRef]),
	},
	{
		label:
			"with check: insert comment only if its post is published (same guard, write position)",
		sql: renderExpr(correlatedPostPublishedGuard, [commentsTableRef]),
	},
	{
		label:
			"using: correlated notExists with outer scope (comments policy, negated)",
		sql: renderExpr(correlatedPostNotPublishedGuard, [commentsTableRef]),
	},

	// --- spec §5.2 function-body queries ---
	{
		label: "function body: select where",
		sql: renderQuery(select(posts).where(eq(posts.slug, "hello")).selectQuery),
	},
	{
		label: "function body: update set/where/returning",
		sql: renderQuery(
			update(posts)
				.set({ publishedAt: now() })
				.where(eq(posts.slug, "hello"))
				.returning().updateQuery,
		),
	},

	// --- insert: multi-row + on conflict (both variants) ---
	{
		label: "insert multi-row with default fill",
		sql: renderQuery(
			insert(posts).values([
				{ slug: "a", status: "draft", views: 0 },
				{ slug: "b", status: "draft", views: 0, publishedAt: now() },
			]).insertQuery,
		),
	},
	{
		label: "insert on conflict do nothing",
		sql: renderQuery(
			insert(posts)
				.values({ slug: "hello", status: "draft", views: 0 })
				.onConflictDoNothing(posts.slug).insertQuery,
		),
	},
	{
		label: "insert on conflict do update",
		sql: renderQuery(
			insert(posts)
				.values({ slug: "hello", status: "draft", views: 0 })
				.onConflictDoUpdate({
					target: [posts.slug],
					set: { views: 0, status: "draft" },
				}).insertQuery,
		),
	},

	// --- deleteFrom with returning ---
	{
		label: "deleteFrom with returning",
		sql: renderQuery(
			deleteFrom(posts).where(eq(posts.slug, "old")).returning().deleteQuery,
		),
	},

	// --- orderBy + limit ---
	{
		label: "select orderBy + limit",
		sql: renderQuery(
			select(posts)
				.orderBy({ by: posts.publishedAt, direction: "desc" })
				.limit(10).selectQuery,
		),
	},
];

const expectedPath = join(import.meta.dirname, "corpus.expected.txt");
const actual = corpus
	.map((entry) => `${entry.label} => ${entry.sql}`)
	.join("\n");

describe("expression corpus golden", () => {
	it("matches the committed corpus", () => {
		if (process.env.UPDATE_GOLDEN === "1") {
			writeFileSync(expectedPath, `${actual}\n`);
		}
		expect(existsSync(expectedPath)).toBe(true);
		expect(`${actual}\n`).toBe(readFileSync(expectedPath, "utf8"));
	});
	it("is deterministic across two renders", () => {
		const second = corpus
			.map((entry) => `${entry.label} => ${entry.sql}`)
			.join("\n");
		expect(second).toBe(actual);
	});
});

import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	ColumnBuilder,
	ColumnRef,
	Expr,
	SelectNode,
	SetOpNode,
	Table,
} from "../../src/index";
import {
	and,
	asc,
	avg,
	bigint,
	bytea,
	count,
	cumeDist,
	date,
	denseRank,
	desc,
	eq,
	exists,
	firstValue,
	gt,
	interval,
	isNotNull,
	jsonArrayFrom,
	jsonObjectFrom,
	lag,
	lastValue,
	lead,
	max,
	min,
	nthValue,
	ntile,
	numeric,
	over,
	percentRank,
	rank,
	renderExpr,
	renderSelect,
	renderSetOp,
	rowNumber,
	schema,
	select,
	sql,
	sum,
	table,
	text,
	timestamptz,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

describe("select builder", () => {
	it("renders a whole-table select with explicit columns", () => {
		expect(renderSelect(select(posts).selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts"',
		);
	});
	it("renders offset after limit", () => {
		const query = select(posts)
			.orderBy({ by: posts.publishedAt, direction: "desc" })
			.limit(10)
			.offset(20);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" order by "app"."posts"."published_at" desc limit 10 offset 20',
		);
	});
	it("renders offset without a limit", () => {
		const query = select(posts).offset(5);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" offset 5',
		);
	});
	it("rejects a negative or fractional offset", () => {
		expect(() => select(posts).offset(-1)).toThrow(/non-negative integer/);
		expect(() => select(posts).offset(1.5)).toThrow(/non-negative integer/);
	});
	it("renders distinct and distinct on", () => {
		expect(renderSelect(select(posts).distinct().selectQuery)).toBe(
			'select distinct "id", "status", "published_at" from "app"."posts"',
		);
		const perStatus = select(posts)
			.distinctOn(posts.status)
			.orderBy(posts.status, { by: posts.publishedAt, direction: "desc" });
		expect(renderSelect(perStatus.selectQuery)).toBe(
			'select distinct on ("app"."posts"."status") "id", "status", "published_at" from "app"."posts" order by "app"."posts"."status" asc, "app"."posts"."published_at" desc',
		);
	});
	it("rejects distinct on with no columns", () => {
		expect(() => select(posts).distinctOn()).toThrow(/at least one column/);
	});
	it("accepts a sql fragment as a where condition", () => {
		// #386: the declaration medium's condition positions (check(), a
		// partial index, an RLS policy) already take Expr<"unknown">; a
		// query's condition positions take the same union, so a predicate
		// the typed operators cannot build needs no cast.
		const query = select(posts).where(
			sql`lower(${posts.status}) = ${"published"}`,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where lower("app"."posts"."status") = \'published\'',
		);
	});
	it("accepts a sql fragment as a join condition", () => {
		const query = select(posts).innerJoin(
			comments,
			sql`${comments.postId} = ${posts.id}`,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id", "app"."posts"."status", "app"."posts"."published_at" from "app"."posts" inner join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
	});
	it("composes a sql fragment with an operator-built condition", () => {
		const query = select(posts).where(
			and(
				eq(posts.status, "published"),
				sql`char_length(${posts.status}) > ${3}`,
			),
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where ("app"."posts"."status" = \'published\') and char_length("app"."posts"."status") > 3',
		);
	});
	it("renders where / order by / limit in type-state order", () => {
		const query = select(posts)
			.where(eq(posts.status, "published"))
			.orderBy({ by: posts.publishedAt, direction: "desc" })
			.limit(10);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'published\' order by "app"."posts"."published_at" desc limit 10',
		);
	});
	it("renders the app schema's rls shape: exists + inner join", () => {
		const guard = exists(
			select(comments)
				.innerJoin(posts, eq(comments.postId, posts.id))
				.where(isNotNull(posts.publishedAt)),
		);
		expect(renderSelect(select(comments).where(guard).selectQuery)).toContain(
			'exists (select 1 from "app"."comments" inner join "app"."posts" on',
		);
	});
	it("records and renders a left join", () => {
		const query = select(posts).leftJoin(
			comments,
			eq(comments.postId, posts.id),
		);
		expect(query.selectQuery.joins).toEqual([
			expect.objectContaining({ joinKind: "left" }),
		]);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id", "app"."posts"."status", "app"."posts"."published_at" from "app"."posts" left join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
	});
	it("renders a correlated subquery referencing the outer table", () => {
		// the canonical rls form: comment is visible iff its post is published
		const guard = exists(
			select(posts).where(
				and(eq(posts.id, comments.postId), isNotNull(posts.publishedAt)),
			),
		);
		expect(renderSelect(select(comments).where(guard).selectQuery)).toBe(
			'select "id", "post_id" from "app"."comments" where exists (select 1 from "app"."posts" where ("app"."posts"."id" = "app"."comments"."post_id") and ("app"."posts"."published_at" is not null))',
		);
	});
	it("renders a standalone correlated expression given an outer scope", () => {
		// how phase 4 renders an rls using-expression for a policy on comments
		const guard = exists(select(posts).where(eq(posts.id, comments.postId)));
		expect(
			renderExpr(guard.exprNode, [
				{ schemaName: "app", tableName: "comments" },
			]),
		).toContain('= "app"."comments"."post_id"');
	});
	it("rejects column refs from tables in no enclosing scope", () => {
		const query = select(posts).where(isNotNull(comments.postId));
		expect(() => renderSelect(query.selectQuery)).toThrowError(
			/foreign-column-ref|join that table/,
		);
	});
});

describe("a whole-table projection is qualified once a join is in scope (#552)", () => {
	it("no join -- bytes unchanged, the pin", () => {
		expect(renderSelect(select(posts).selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts"',
		);
	});

	it('one inner join qualifies every projected column, the same form an object projection\'s own column reference already renders -- posts and comments both declare "id", the exact shape #552 was filed over: unqualified, this is SQL a server refuses as ambiguous (42702)', () => {
		const query = select(posts).innerJoin(
			comments,
			eq(comments.postId, posts.id),
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id", "app"."posts"."status", "app"."posts"."published_at" from "app"."posts" inner join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
	});

	it("one left join qualifies the same way", () => {
		const query = select(posts).leftJoin(
			comments,
			eq(comments.postId, posts.id),
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id", "app"."posts"."status", "app"."posts"."published_at" from "app"."posts" left join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
	});

	it("two joins still qualify against the select's own from-source, not either joined table", () => {
		const authors = table(app, "authors", { id: uuid().primaryKey() });
		const query = select(posts)
			.innerJoin(comments, eq(comments.postId, posts.id))
			.innerJoin(authors, sql`true`);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id", "app"."posts"."status", "app"."posts"."published_at" from "app"."posts" inner join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id" inner join "app"."authors" on true',
		);
	});

	it("a CTE from-source qualifies bare, the same way the from clause itself renders a CTE reference", () => {
		// Hand-built at the AST level, mirroring this file's own SetOpNode
		// literal below (the "rejects a non-projected column" test) --
		// select() only accepts an allColumns projection straight off a
		// declared Table (resolveProjection's own isTable() check), never
		// off a CTE reference, so a whole-table projection from a CTE has
		// no builder path and is constructed directly to exercise the
		// renderer's own behavior against driver-contract's promise that a
		// CTE qualifier renders bare.
		const query: SelectNode = {
			queryKind: "select",
			projection: {
				projectionKind: "allColumns",
				columnNames: ["id", "status", "published_at"],
			},
			from: { cteName: "ranked" },
			joins: [
				{
					joinKind: "inner",
					table: { schemaName: "app", tableName: "comments" },
					on: {
						nodeKind: "comparison",
						operator: "=",
						left: {
							nodeKind: "columnRef",
							schemaName: null,
							tableName: "ranked",
							columnName: "id",
						},
						right: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "comments",
							columnName: "post_id",
						},
					},
				},
			],
			where: null,
			groupBy: [],
			having: null,
			orderBy: [],
			limit: null,
			offset: null,
			distinct: null,
		};
		expect(renderSelect(query, [{ declaredCte: "ranked" }])).toBe(
			'select "ranked"."id", "ranked"."status", "ranked"."published_at" from "ranked" inner join "app"."comments" on "ranked"."id" = "app"."comments"."post_id"',
		);
	});
});

describe("one ordering vocabulary (#470)", () => {
	it("orderBy accepts desc(column) -- the declaration medium's own asc()/desc()", () => {
		// Before group 5, OrderTermInput was Expr | { by, direction } only --
		// desc(posts.id) (dsl/index-builder.ts's IndexColumn) satisfied
		// neither, a compile error. Widening OrderTermInput to include
		// OrderedTerm (expr/ast.ts) is what makes this compile now; the
		// rendered SQL is identical to the equivalent { by, direction } form
		// (a select's own orderBy renders a table-qualified reference,
		// same as every other bare-Expr orderBy term in this file).
		const query = select(posts).orderBy(desc(posts.id));
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" order by "app"."posts"."id" desc',
		);
	});

	it("orderBy accepts asc(column, { nulls }) too, and the placement reaches the rendered SQL (group 5.2)", () => {
		// The dedicated red for the renderer half (OrderByTerm.nulls and
		// both renderers, across all three positions) lives in
		// expr/render-sql.test.ts; this pins the same property end to end
		// through the query builder's own orderBy().
		const query = select(posts).orderBy(
			asc(posts.publishedAt, { nulls: "last" }),
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" order by "app"."posts"."published_at" asc nulls last',
		);
	});
});

describe("jsonArrayFrom/jsonObjectFrom wrap a subselect into an expression (add-relational-reads task 2.1)", () => {
	it("wraps the subselect as a select-as-expression node, projection intact", () => {
		const sub = select(
			{ id: comments.id, postId: comments.postId },
			comments,
		).where(eq(comments.postId, posts.id));

		const collection = jsonArrayFrom(sub);
		expect(collection.family).toBe("json");
		expect(collection.exprNode.nodeKind).toBe("selectExpr");
		const collectionNode = collection.exprNode as {
			mode: string;
			query: { projection: { projectionKind: string } };
		};
		expect(collectionNode.mode).toBe("jsonArray");
		// unlike exists(), the projection is the point -- it must survive
		// exactly as built, never rewritten to constantOne.
		expect(collectionNode.query).toBe(sub.selectQuery);
		expect(collectionNode.query.projection.projectionKind).not.toBe(
			"constantOne",
		);

		const single = jsonObjectFrom(sub);
		expect((single.exprNode as { mode: string }).mode).toBe("jsonObject");
	});
});

describe("select-as-expression rendering (add-relational-reads task 2.2)", () => {
	const metrics = table(app, "metrics", {
		id: uuid().primaryKey(),
		postId: uuid().notNull(),
		viewCount: bigint().notNull(),
		recordedAt: timestamptz().notNull(),
	});

	it("renders a collection as a correlated aggregate over a derived table", () => {
		const query = select(
			{
				id: posts.id,
				comments: jsonArrayFrom(
					select({ id: comments.id, postId: comments.postId }, comments)
						.where(eq(comments.postId, posts.id))
						.orderBy(comments.id),
				),
			},
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id" as "id", (select coalesce(json_agg("agg"), \'[]\'::json) from (select "app"."comments"."id" as "id", "app"."comments"."post_id" as "post_id" from "app"."comments" where "app"."comments"."post_id" = "app"."posts"."id" order by "app"."comments"."id" asc) as "agg") as "comments" from "app"."posts"',
		);
	});

	it("renders a single row via row_to_json, casting only the json-number-precision types (F1)", () => {
		const query = select(
			{
				id: posts.id,
				latest: jsonObjectFrom(
					select(
						{ viewCount: metrics.viewCount, recordedAt: metrics.recordedAt },
						metrics,
					)
						.where(eq(metrics.postId, posts.id))
						.orderBy({ by: metrics.recordedAt, direction: "desc" })
						.limit(1),
				),
			},
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id" as "id", (select row_to_json("agg") from (select "app"."metrics"."view_count"::text as "view_count", "app"."metrics"."recorded_at" as "recorded_at" from "app"."metrics" where "app"."metrics"."post_id" = "app"."posts"."id" order by "app"."metrics"."recorded_at" desc limit 1) as "agg") as "latest" from "app"."posts"',
		);
	});

	it("keeps the foreign-column diagnostic for a ref outside every scope (task 2.4)", () => {
		const others = table(app, "others", { id: uuid().primaryKey() });
		const query = select(
			{
				id: posts.id,
				bad: jsonArrayFrom(
					select({ id: comments.id }, comments).where(
						eq(comments.postId, others.id),
					),
				),
			},
			posts,
		);
		expect(() => renderSelect(query.selectQuery)).toThrowError(
			/foreign-column-ref|enclosing query/,
		);
	});
});

describe("group 2 review rulings (F1/F2) and the at-risk table", () => {
	it("expands a whole-table subselect with casts applied (F2)", () => {
		const ledger = table(app, "ledger", {
			id: uuid().primaryKey(),
			amount: bigint().notNull(),
			postedAt: timestamptz().notNull(),
		});
		const query = select(
			{ id: posts.id, entries: jsonArrayFrom(select(ledger)) },
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."id" as "id", (select coalesce(json_agg("agg"), \'[]\'::json) from (select "app"."ledger"."id" as "id", "app"."ledger"."amount"::text as "amount", "app"."ledger"."posted_at" as "posted_at" from "app"."ledger") as "agg") as "entries" from "app"."posts"',
		);
	});

	it("casts exactly the json-number-precision types, arrays included (F1/F6)", () => {
		const cases: ReadonlyArray<readonly [string, ColumnBuilder, boolean]> = [
			["bigint", bigint(), true],
			["numeric", numeric(), true],
			["bigint array", bigint().array(), true],
			["timestamptz", timestamptz(), false],
			["date", date(), false],
			["interval", interval(), false],
			["bytea", bytea(), false],
			["text", text(), false],
		];
		for (const [label, builder, expectCast] of cases) {
			const probe = table(app, `probe_${label.replaceAll(" ", "_")}`, {
				id: uuid().primaryKey(),
				value: builder as never,
			});
			const rendered = renderSelect(
				select({ id: posts.id, nested: jsonObjectFrom(select(probe)) }, posts)
					.selectQuery,
			);
			expect(rendered.includes("::text"), label).toBe(expectCast);
			if (label === "bigint array") {
				expect(rendered).toContain("::text[]");
			}
		}
	});

	// #452 task 1.2: BUILDER_READ_SHAPES-driven cast agreement -- one row
	// per builder function (windowed and unwindowed where the function
	// allows it): `int8` rows cast unconditionally, `argument` rows cast
	// exactly as their own argument's declared type would (bigint casts,
	// text doesn't), `own` rows never cast. `over(count(), …)` casting is
	// the red that motivates the change: the cast side used to neither
	// unwrap a window node nor name any window function at all.
	const ledgerBigint = table(app, "read_shape_bigint", {
		id: uuid().primaryKey(),
		value: bigint().notNull(),
	});
	const ledgerText = table(app, "read_shape_text", {
		id: uuid().primaryKey(),
		value: text().notNull(),
	});

	const rendersCastFor = (projected: Expr, from: Table): boolean =>
		renderSelect(
			select(
				{
					id: posts.id,
					nested: jsonArrayFrom(select({ cell: projected }, from)),
				},
				posts,
			).selectQuery,
		).includes("::text");

	it.each([
		["count", () => count()],
		["count (windowed)", () => over(count(), {})],
		["row_number (windowed)", () => over(rowNumber(), {})],
		["rank (windowed)", () => over(rank(), {})],
		["dense_rank (windowed)", () => over(denseRank(), {})],
	])("%s casts unconditionally (int8 shape)", (_label, build) => {
		expect(rendersCastFor(build(), ledgerBigint)).toBe(true);
	});

	it.each([
		["min", () => min(ledgerBigint.value)],
		["min (windowed)", () => over(min(ledgerBigint.value), {})],
		["max", () => max(ledgerBigint.value)],
		["max (windowed)", () => over(max(ledgerBigint.value), {})],
		["lag (windowed)", () => over(lag(ledgerBigint.value), {})],
		["lead (windowed)", () => over(lead(ledgerBigint.value), {})],
		["first_value (windowed)", () => over(firstValue(ledgerBigint.value), {})],
		["last_value (windowed)", () => over(lastValue(ledgerBigint.value), {})],
		["nth_value (windowed)", () => over(nthValue(ledgerBigint.value, 1), {})],
	])("%s casts over a bigint argument (argument shape)", (_label, build) => {
		expect(rendersCastFor(build(), ledgerBigint)).toBe(true);
	});

	it.each([
		["min", () => min(ledgerText.value)],
		["min (windowed)", () => over(min(ledgerText.value), {})],
		["max", () => max(ledgerText.value)],
		["max (windowed)", () => over(max(ledgerText.value), {})],
		["lag (windowed)", () => over(lag(ledgerText.value), {})],
		["lead (windowed)", () => over(lead(ledgerText.value), {})],
		["first_value (windowed)", () => over(firstValue(ledgerText.value), {})],
		["last_value (windowed)", () => over(lastValue(ledgerText.value), {})],
		["nth_value (windowed)", () => over(nthValue(ledgerText.value, 1), {})],
	])(
		"%s casts nothing over a text argument (argument shape)",
		(_label, build) => {
			expect(rendersCastFor(build(), ledgerText)).toBe(false);
		},
	);

	it.each([
		["sum", () => sum(ledgerBigint.value)],
		["sum (windowed)", () => over(sum(ledgerBigint.value), {})],
		["avg", () => avg(ledgerBigint.value)],
		["avg (windowed)", () => over(avg(ledgerBigint.value), {})],
		["percent_rank (windowed)", () => over(percentRank(), {})],
		["cume_dist (windowed)", () => over(cumeDist(), {})],
		["ntile (windowed)", () => over(ntile(4), {})],
	])("%s casts nothing (own shape)", (_label, build) => {
		expect(rendersCastFor(build(), ledgerBigint)).toBe(false);
	});

	// An "argument" row's cast still needs its own argument's typeNode
	// (atRiskCastSuffix reads it off the chain's projectionInput, exactly
	// as a bare columnRef would) -- an argument with no typeNode at all
	// (a raw sql`` fragment, which carries no fixed type) has nothing to
	// check against, so it is never cast, whatever its shape says.
	it("an argument-shape aggregate over an operand with no typeNode casts nothing (no typeNode to check)", () => {
		expect(rendersCastFor(min(sql`1`), ledgerBigint)).toBe(false);
	});
});

describe("set operations (add-set-operations tasks 1.1-1.2)", () => {
	const activeQuery = select(posts).where(eq(posts.status, "active"));
	const archivedQuery = select(posts).where(eq(posts.status, "archived"));

	it("a set-op node renders the two branches joined by the operator", () => {
		const combined: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: activeQuery.selectQuery,
			right: archivedQuery.selectQuery,
			orderBy: [],
			limit: null,
			offset: null,
		};
		expect(renderSetOp(combined)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'active\' union select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'archived\'',
		);
	});

	it("nesting parenthesizes and whole-set order/limit trail the set", () => {
		const inner: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: true,
			left: activeQuery.selectQuery,
			right: archivedQuery.selectQuery,
			orderBy: [],
			limit: null,
			offset: null,
		};
		const outer: SetOpNode = {
			queryKind: "setOp",
			operator: "except",
			all: false,
			left: inner,
			right: select(posts).selectQuery,
			orderBy: [{ expr: posts.id.exprNode, direction: "asc" }],
			limit: 3,
			offset: null,
		};
		expect(renderSetOp(outer)).toBe(
			'(select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'active\' union all select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'archived\') except select "id", "status", "published_at" from "app"."posts" order by "id" asc limit 3',
		);
	});

	it("a whole-set orderBy outside the output columns is rejected by name", () => {
		// output-name semantics (the group-4 real-server correction): the
		// guard is MEMBERSHIP IN THE LEFT BRANCH'S OUTPUT LIST -- a ref
		// whose name is not an output column is rejected whatever table it
		// came from ("post_id" is not among posts' outputs).
		const combined: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: activeQuery.selectQuery,
			right: archivedQuery.selectQuery,
			orderBy: [{ expr: comments.postId.exprNode, direction: "asc" }],
			limit: null,
			offset: null,
		};
		expect(() => renderSetOp(combined)).toThrowError(/output/);
	});
});

describe("set-op combinators (add-set-operations task 2.1)", () => {
	it("union/unionAll/intersect/except combinators build the recursive node", () => {
		const active = select(posts).where(eq(posts.status, "active"));
		const archived = select(posts).where(eq(posts.status, "archived"));
		const drafts = select(posts).where(eq(posts.status, "draft"));

		const combined = active.union(archived).exceptAll(drafts);
		expect(combined.setOpQuery.operator).toBe("except");
		expect(combined.setOpQuery.all).toBe(true);
		const inner = combined.setOpQuery.left;
		expect(inner.queryKind).toBe("setOp");
		expect((inner as SetOpNode).operator).toBe("union");
		expect((inner as SetOpNode).all).toBe(false);

		const ordered = combined
			.orderBy({ by: posts.id, direction: "desc" })
			.limit(2);
		expect(ordered.setOpQuery.limit).toBe(2);
		expect(renderSetOp(ordered.setOpQuery)).toContain(
			'order by "id" desc limit 2',
		);

		// all six exist
		expect(typeof active.unionAll).toBe("function");
		expect(typeof active.intersect).toBe("function");
		expect(typeof active.intersectAll).toBe("function");
		expect(typeof active.except).toBe("function");
	});
});

describe("union() enforces row compatibility (#487)", () => {
	it("a union of two selects with different key sets does not type-check", () => {
		// posts {id, status, publishedAt} vs comments {id, postId} -- a
		// mismatched key set resolves SetOpResult to `never`, poisoning
		// the `other` parameter (the same mechanism with.ts's
		// CompatibleRecursiveTerm and @hejbro/query's CompatibleBranch
		// already use). With the directive removed, the actual error is
		// TS2345: "Argument of type 'SelectDistinctable<Table<{ id:
		// ColumnBuilder<"uuid", ...>; postId: ColumnBuilder<"uuid",
		// ...>; }>>' is not assignable to parameter of type 'never'."
		// `@ts-expect-error` only suppresses the compile error -- the JS
		// still runs, and group 8's runtime guard (assertSameSetOpKeyOrder)
		// also refuses a key-set mismatch (group 8.4: the set check runs
		// BEFORE the order check, so a genuinely different key set lands
		// on set-op-key-set-mismatch, not set-op-key-order-mismatch --
		// "reorder" would be no remedy at all here, nothing shares a key
		// set to reorder), so this now throws for real too; wrapped in
		// toThrow() (asserting the specific code, not any exception) so
		// that second, independent refusal doesn't fail the test with an
		// uncaught exception, and doesn't silently pass for a different
		// reason either.
		expect(() =>
			select(posts).union(
				// @ts-expect-error comments' key set does not match posts' --
				// see the TS2345 text above.
				select(comments),
			),
		).toThrow(expect.objectContaining({ code: "set-op-key-set-mismatch" }));
	});

	it("a union of two selects with the same key set still type-checks, and its result row keeps the left branch's keys", () => {
		const active = select(posts).where(eq(posts.status, "active"));
		const archived = select(posts).where(eq(posts.status, "archived"));
		const combined = active.union(archived);
		// positive control: the compatibility gate does not poison the
		// matching case, and the result stage's own projection is still
		// exactly the LEFT branch's (SetOpResult's computed shape is
		// discarded, never propagated into the return type -- #487).
		expectTypeOf(combined.projectionInput).toEqualTypeOf(
			active.projectionInput,
		);
	});

	it("a matching union compiles to the same SQL it did before", () => {
		const active = select(posts).where(eq(posts.status, "active"));
		const archived = select(posts).where(eq(posts.status, "archived"));
		expect(renderSetOp(active.union(archived).setOpQuery)).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'active\' union select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = \'archived\'',
		);
	});
});

describe("union() checks branch key ORDER, not just the key set (#487, second half — group 8)", () => {
	// same key SET ({email, city}) on both tables, declared in a
	// different order -- SameKeys/SetOpResult (group 3) only sees the
	// set, so this pair type-checks; Postgres itself matches
	// set-operation branches by POSITION, so this is exactly the shape
	// that used to compile and silently swap each row's email/city
	// (measured on postgres:17, group 8's own red).
	const usersByEmail = table(app, "users_by_email", {
		email: text().notNull(),
		city: text().notNull(),
	});
	const usersByCity = table(app, "users_by_city", {
		city: text().notNull(),
		email: text().notNull(),
	});

	it("a union whose branches list the same keys in a different order is refused, and the message shows both orders", () => {
		expect(() => select(usersByEmail).union(select(usersByCity))).toThrow(
			expect.objectContaining({
				code: "set-op-key-order-mismatch",
				message: expect.stringContaining(
					"left: (email, city), right: (city, email)",
				),
			}),
		);
	});

	it("a union whose branches list the same keys in the SAME order still compiles and works (positive control)", () => {
		const usersByEmailToo = table(app, "users_by_email_too", {
			email: text().notNull(),
			city: text().notNull(),
		});
		expect(() =>
			select(usersByEmail).union(select(usersByEmailToo)),
		).not.toThrow();
	});
});

describe("branch key SET mismatches are their own code, not folded into ORDER (group 8.4)", () => {
	// #464/#469/#487/#489's own recurring failure mode, repeated once more
	// in the guard this very slice added: findKeyOrderMismatch's original
	// scan was a pure positional walk with no set comparison, so a
	// genuinely different key set (or a missing key) also fell through
	// to "different order" -- a real diagnostic code, but a "reorder"
	// remedy that cannot be followed when there is nothing correctly-
	// keyed to reorder. The set check now runs FIRST.
	const usersIdEmail = table(app, "users_id_email_84", {
		id: uuid().primaryKey(),
		email: text().notNull(),
	});
	const usersIdTown = table(app, "users_id_town_84", {
		id: uuid().primaryKey(),
		town: text().notNull(),
	});
	const usersIdOnly = table(app, "users_id_only_84", {
		id: uuid().primaryKey(),
	});
	const usersTownId = table(app, "users_town_id_84", {
		town: text().notNull(),
		id: uuid().primaryKey(),
	});

	it("genuinely different keys (same size) are a key-SET mismatch, not order", () => {
		expect(() =>
			select(usersIdEmail).union(
				// @ts-expect-error usersIdTown's key set differs from
				// usersIdEmail's (email vs town) -- a genuine set mismatch,
				// not a reordering of the same keys.
				select(usersIdTown),
			),
		).toThrow(
			expect.objectContaining({
				code: "set-op-key-set-mismatch",
				message: expect.stringContaining(
					'only in left: "email", only in right: "town"',
				),
			}),
		);
	});

	it("a branch missing a key is a key-SET mismatch, not order -- nothing to reorder", () => {
		expect(() =>
			select(usersIdEmail).union(
				// @ts-expect-error usersIdOnly is missing usersIdEmail's
				// `email` key entirely.
				select(usersIdOnly),
			),
		).toThrow(
			expect.objectContaining({
				code: "set-op-key-set-mismatch",
				message: expect.stringContaining(
					'only in left: "email", only in right: (none)',
				),
			}),
		);
	});

	it("both a set difference AND a positional difference at once still resolves to the key-SET code (discrimination order)", () => {
		// {id, email} vs {town, id}: shares "id", but "email"/"town" are
		// genuinely different keys -- a pure positional scan would also
		// see position 0 disagree ("id" vs "town") and could mis-report
		// this as an order problem. Set-first sends it to the set code,
		// whose remedy ("project the same keys") is the one that is
		// actually true here.
		expect(() =>
			select(usersIdEmail).union(
				// @ts-expect-error usersTownId's key set differs from
				// usersIdEmail's -- see the comment above.
				select(usersTownId),
			),
		).toThrow(
			expect.objectContaining({
				code: "set-op-key-set-mismatch",
				message: expect.stringContaining(
					'only in left: "email", only in right: "town"',
				),
			}),
		);
	});
});

describe("set-op order-by output-column guard (review F1)", () => {
	const active = select(posts).where(eq(posts.status, "active"));
	const archived = select(posts).where(eq(posts.status, "archived"));

	it("rejects a non-projected column and an alias-hidden source ref", () => {
		const narrowLeft = select({ id: posts.id }, posts);
		const narrowRight = select({ id: comments.id }, comments);
		const nonProjected: SetOpNode = {
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: narrowLeft.selectQuery,
			right: narrowRight.selectQuery,
			orderBy: [{ expr: posts.status.exprNode, direction: "asc" }],
			limit: null,
			offset: null,
		};
		expect(() => renderSetOp(nonProjected)).toThrowError(/output/);

		const aliased = select({ headline: posts.status }, posts)
			.union(select({ headline: comments.id }, comments))
			// the SOURCE ref renders "status", but the output column is
			// "headline" -- Postgres rejects it, so we do first.
			.orderBy(posts.status);
		expect(() => renderSetOp(aliased.setOpQuery)).toThrowError(/output/);
		// ordering by a projected whole-table column stays legal
		const legal = active.union(archived).orderBy(posts.status);
		expect(renderSetOp(legal.setOpQuery)).toContain('order by "status" asc');
	});
});

describe("aggregates and grouping (#416)", () => {
	it("renders count, count(expr), min/max, sum and avg", () => {
		const query = select(
			{
				status: posts.status,
				total: count(),
				published: count(posts.publishedAt),
				earliest: min(posts.publishedAt),
				latest: max(posts.publishedAt),
			},
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."status" as "status", count(*) as "total", count("app"."posts"."published_at") as "published", min("app"."posts"."published_at") as "earliest", max("app"."posts"."published_at") as "latest" from "app"."posts"',
		);
	});

	it("renders group by and having in SQL's own order", () => {
		const query = select({ status: posts.status, total: count() }, posts)
			.where(isNotNull(posts.publishedAt))
			.groupBy(posts.status)
			.having(gt(count(), 1))
			.orderBy(posts.status)
			.limit(5);
		expect(renderSelect(query.selectQuery)).toBe(
			'select "app"."posts"."status" as "status", count(*) as "total" from "app"."posts" where "app"."posts"."published_at" is not null group by "app"."posts"."status" having count(*) > 1 order by "app"."posts"."status" asc limit 5',
		);
	});

	it("sum and avg render, and stay at the numeric family's widest honest type", () => {
		const query = select(
			{ total: sum(posts.publishedAt), mean: avg(posts.publishedAt) },
			posts,
		);
		expect(renderSelect(query.selectQuery)).toBe(
			'select sum("app"."posts"."published_at") as "total", avg("app"."posts"."published_at") as "mean" from "app"."posts"',
		);
	});

	it("rejects an empty group by", () => {
		expect(() => select(posts).groupBy()).toThrow(/at least one expression/);
	});

	// #444 F9: min/max used to spread the argument's whole shape, including
	// sqlName/exprNode: ColumnRefNode -- an aggregate reported itself as a
	// real column reference to any code checking "sqlName" in x.
	it("max() keeps the argument's read type", () => {
		const result = max(posts.publishedAt);
		expect(result.family).toBe(posts.publishedAt.family);
		expect(result.typeNode).toEqual(posts.publishedAt.typeNode);
		expect("sqlName" in result).toBe(false);
	});

	it("max() is not accepted where a ColumnRef is required (a type-level red)", () => {
		// @ts-expect-error max() no longer carries ColumnRef-ness (F9) --
		// its exprNode is a functionCall, not a real column reference, so
		// index()/a foreign-key column list must stop accepting it.
		const _atRisk: ColumnRef = max(posts.publishedAt);
	});
});

describe("countWhere is removed (#469)", () => {
	it("count(expr) renders count(<expr>)", () => {
		const query = select({ published: count(posts.publishedAt) }, posts);
		expect(renderSelect(query.selectQuery)).toBe(
			'select count("app"."posts"."published_at") as "published" from "app"."posts"',
		);
	});

	it("countWhere is not exported (a type-level red)", () => {
		// @ts-expect-error countWhere was removed, not renamed -- the
		// surviving spelling is the argumented count(operand)
		// (aggregate.ts's own rule: all five aggregate names carry
		// Postgres's own names verbatim, no invented ones). Actual error
		// with the directive removed: TS2694 "Namespace '\"…/src/index\"'
		// has no exported member 'countWhere'."
		type _Removed = typeof import("../../src/index").countWhere;
		// Positive control, deliberately undirected: `@ts-expect-error`
		// swallows TS2307 ("Cannot find module") too, so a rotted import
		// path (the file moved or was renamed) would make the red above
		// pass for the wrong reason -- silently, since nothing else in
		// this file exercises that path. This line has no directive: if
		// the path dies, this is what makes the suite fail loudly instead.
		type _PathControl = typeof import("../../src/index").count;
	});
});

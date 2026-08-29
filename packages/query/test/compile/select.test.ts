import {
	and,
	coalesce,
	count,
	eq,
	gt,
	schema,
	select,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";
import { sql } from "../../src/sql";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

describe("compile: select with where", () => {
	it("select with where compiles to parameterized SQL, no star", () => {
		const statement = select(posts).where(eq(posts.status, "published"));
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1',
		);
		expect(result.sql).not.toContain("*");
		// "published" itself legitimately appears in the "published_at"
		// column name — the value must never appear quoted as a literal.
		expect(result.sql).not.toContain("'published'");
		expect(result.params).toEqual(["published"]);
		expect(result.kind).toBe("select");
	});

	it("an adversarial where value never appears in the SQL text, only in params", () => {
		const payload = "'; drop table users; --";
		const statement = select(posts).where(eq(posts.status, payload));
		const result = compile(statement);

		expect(result.sql).not.toContain(payload);
		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1',
		);
		expect(result.params).toEqual([payload]);
	});

	it("a value that looks like a placeholder stays a value, not a parameter number", () => {
		const statement = select(posts).where(eq(posts.status, "$1"));
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1',
		);
		expect(result.params).toEqual(["$1"]);
	});

	it("order and limit render after where", () => {
		const statement = select(posts)
			.where(eq(posts.status, "published"))
			.orderBy({ by: posts.publishedAt, direction: "desc" })
			.limit(10);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1 order by "app"."posts"."published_at" desc limit 10',
		);
		// limit is D3①'s explicit inline exception — it never becomes a
		// bind parameter, so only where's one value is in params.
		expect(result.params).toEqual(["published"]);
	});

	it("an orderBy literal receives the next parameter after where's", () => {
		const statement = select(posts)
			.where(eq(posts.status, "published"))
			.orderBy({
				by: coalesce(posts.publishedAt, new Date("2020-01-01T00:00:00.000Z")),
				direction: "desc",
			});
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1 order by coalesce("app"."posts"."published_at", $2::timestamptz) desc',
		);
		expect(result.params).toEqual(["published", "2020-01-01T00:00:00.000Z"]);
	});
});

describe("compile: a sql fragment as a condition (#386)", () => {
	it("parameterizes a fragment condition's interpolations", () => {
		const statement = select(posts).where(
			sql`lower(${posts.status}) = ${"published"}`,
		);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where lower("app"."posts"."status") = $1',
		);
		expect(result.sql).not.toContain("'published'");
		expect(result.params).toEqual(["published"]);
	});

	it("composes a fragment with an operator-built condition in written order", () => {
		const statement = select(posts).where(
			and(
				eq(posts.status, "published"),
				sql`char_length(${posts.status}) > ${3}`,
			),
		);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where ("app"."posts"."status" = $1) and char_length("app"."posts"."status") > $2',
		);
		expect(result.params).toEqual(["published", 3]);
	});

	it("filters an update through a fragment condition", () => {
		const statement = update(posts)
			.set({ status: "archived" })
			.where(sql`lower(${posts.status}) = ${"published"}`)
			.returning({ id: posts.id });
		const result = compile(statement);

		expect(result.sql).toContain('where lower("app"."posts"."status") = $2');
		expect(result.params).toEqual(["archived", "published"]);
	});
});

describe("compile: offset and distinct (#437)", () => {
	it("paginates with limit and offset, both rendered inline", () => {
		const statement = select(posts).limit(10).offset(20);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" limit 10 offset 20',
		);
		// a row count is not a value: it renders inline so the statement text
		// stays reviewable, exactly as `limit` already did.
		expect(result.params).toEqual([]);
	});

	it("compiles distinct and distinct on", () => {
		expect(compile(select(posts).distinct()).sql).toBe(
			'select distinct "id", "status", "published_at" from "app"."posts"',
		);
		expect(compile(select(posts).distinctOn(posts.status)).sql).toBe(
			'select distinct on ("app"."posts"."status") "id", "status", "published_at" from "app"."posts"',
		);
	});
});

// #444 F1 (spec violation): liftSelectNode used to hand-list
// projection/joins/where/orderBy only, so a literal inside
// having/groupBy/distinctOn was spliced into the SQL text instead of
// becoming a bind parameter.
describe("compile: parameters in having, groupBy and distinctOn (#444 F1)", () => {
	it("lifts literals in having, groupBy and distinctOn to bind parameters", () => {
		const statement = select({ status: posts.status, total: count() }, posts)
			.distinctOn(coalesce(posts.status, "fallback-distinct"))
			.groupBy(coalesce(posts.status, "fallback-group"))
			.having(gt(coalesce(posts.status, "fallback-having"), "target"));
		const result = compile(statement);

		expect(result.sql).not.toContain("fallback-distinct");
		expect(result.sql).not.toContain("fallback-group");
		expect(result.sql).not.toContain("fallback-having");
		expect(result.sql).not.toContain("'target'");
		expect(result.params).toEqual([
			"fallback-distinct",
			"fallback-group",
			"fallback-having",
			"target",
		]);
	});

	it("numbers parameters in rendered order across all clauses", () => {
		// one literal in every clause at once (adversarial values, distinct
		// per clause so a misordering shows up as a mismatched param, not a
		// coincidentally-right one) -- distinct on sorts before the
		// projection, matching renderSelectClauses.
		const statement = select(
			{ status: coalesce(posts.status, "p"), total: count() },
			posts,
		)
			.distinctOn(coalesce(posts.status, "d"))
			.where(eq(coalesce(posts.status, "w"), "w-target"))
			.groupBy(coalesce(posts.status, "g"))
			.having(gt(coalesce(posts.status, "h"), "h-target"))
			.orderBy(coalesce(posts.status, "o"));
		const result = compile(statement);

		expect(result.sql).toBe(
			'select distinct on (coalesce("app"."posts"."status", $1)) coalesce("app"."posts"."status", $2) as "status", count(*) as "total" from "app"."posts" where coalesce("app"."posts"."status", $3) = $4 group by coalesce("app"."posts"."status", $5) having coalesce("app"."posts"."status", $6) > $7 order by coalesce("app"."posts"."status", $8) asc',
		);
		expect(result.params).toEqual([
			"d",
			"p",
			"w",
			"w-target",
			"g",
			"h",
			"h-target",
			"o",
		]);
	});
});

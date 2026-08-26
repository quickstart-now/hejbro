import {
	deleteFrom,
	eq,
	insert,
	schema,
	sql,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

describe("compile: mutations", () => {
	it("insert renders parameterized values and explicit returning", () => {
		const statement = insert(posts)
			.values({ status: "draft" })
			.returning({ id: posts.id, status: posts.status });
		const result = compile(statement);

		expect(result.sql).toBe(
			'insert into "app"."posts" ("status") values ($1) returning "app"."posts"."id" as "id", "app"."posts"."status" as "status"',
		);
		expect(result.sql).not.toContain("*");
		expect(result.params).toEqual(["draft"]);
		expect(result.kind).toBe("insert");
	});

	it("a multi-row insert's missing key stays the default marker, not a parameter", () => {
		const statement = insert(posts).values([
			{ status: "draft" },
			{
				status: "published",
				publishedAt: new Date("2020-01-01T00:00:00.000Z"),
			},
		]);
		const result = compile(statement);

		expect(result.sql).toBe(
			'insert into "app"."posts" ("status", "published_at") values ($1, default), ($2, $3::timestamptz)',
		);
		expect(result.params).toEqual([
			"draft",
			"published",
			"2020-01-01T00:00:00.000Z",
		]);
	});

	it("sql.raw() stays verbatim where a value would be parameterized", () => {
		const statement = insert(posts).values({ status: sql.raw("'unsafe'") });
		const result = compile(statement);

		expect(result.sql).toBe(
			'insert into "app"."posts" ("status") values (\'unsafe\')',
		);
		expect(result.params).toEqual([]);
	});

	it("onConflict do update lifts its own set values after the insert row", () => {
		const statement = insert(posts)
			.values({ status: "draft" })
			.onConflictDoUpdate({ target: [posts.id], set: { status: "conflict" } })
			.returning({ id: posts.id });
		const result = compile(statement);

		expect(result.sql).toBe(
			'insert into "app"."posts" ("status") values ($1) on conflict ("id") do update set "status" = $2 returning "app"."posts"."id" as "id"',
		);
		expect(result.params).toEqual(["draft", "conflict"]);
	});

	it("an adversarial insert value never appears in the SQL text, only in params", () => {
		const payload = "'; drop table users; --";
		const statement = insert(posts).values({ status: payload });
		const result = compile(statement);

		expect(result.sql).not.toContain(payload);
		expect(result.params).toEqual([payload]);
	});

	it("update's set literal is numbered before where's, returning stays explicit", () => {
		const statement = update(posts)
			.set({ status: "published" })
			.where(eq(posts.status, "draft"))
			.returning({ id: posts.id });
		const result = compile(statement);

		expect(result.sql).toBe(
			'update "app"."posts" set "status" = $1 where "app"."posts"."status" = $2 returning "app"."posts"."id" as "id"',
		);
		expect(result.sql).not.toContain("*");
		expect(result.params).toEqual(["published", "draft"]);
		expect(result.kind).toBe("update");
	});

	it("two set literals are each numbered before where's, in order", () => {
		// A single-literal set/where pair can't tell "off-by-one" apart from
		// "each clause restarts numbering at 1" — they'd both render $1/$2.
		// Two set literals force the cumulative startIndex arithmetic in
		// `compileUpdate` to actually be observed.
		const statement = update(posts)
			.set({
				status: "published",
				publishedAt: new Date("2020-01-01T00:00:00.000Z"),
			})
			.where(eq(posts.status, "draft"));
		const result = compile(statement);

		expect(result.sql).toBe(
			'update "app"."posts" set "status" = $1, "published_at" = $2::timestamptz where "app"."posts"."status" = $3',
		);
		expect(result.params).toEqual([
			"published",
			"2020-01-01T00:00:00.000Z",
			"draft",
		]);
	});

	it("an adversarial update set/where value never appears in the SQL text", () => {
		const payload = "'; drop table users; --";
		const statement = update(posts)
			.set({ status: payload })
			.where(eq(posts.status, payload));
		const result = compile(statement);

		expect(result.sql).not.toContain(payload);
		expect(result.params).toEqual([payload, payload]);
	});

	it("delete renders parameterized where and explicit returning", () => {
		const statement = deleteFrom(posts)
			.where(eq(posts.status, "draft"))
			.returning({ id: posts.id });
		const result = compile(statement);

		expect(result.sql).toBe(
			'delete from "app"."posts" where "app"."posts"."status" = $1 returning "app"."posts"."id" as "id"',
		);
		expect(result.sql).not.toContain("*");
		expect(result.params).toEqual(["draft"]);
		expect(result.kind).toBe("delete");
	});

	it("an adversarial value in a returning projection never appears in the SQL text", () => {
		const payload = "'; drop table users; --";
		const statement = insert(posts)
			.values({ status: "draft" })
			.returning({ id: posts.id, note: sql`${payload}` });
		const result = compile(statement);

		expect(result.sql).not.toContain(payload);
		expect(result.params).toEqual(["draft", payload]);
	});
});

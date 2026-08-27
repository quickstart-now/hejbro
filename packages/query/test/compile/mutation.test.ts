import {
	bigint,
	deleteFrom,
	eq,
	insert,
	interval,
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
const metrics = table(app, "metrics", {
	id: uuid().primaryKey(),
	amount: bigint().notNull(),
	duration: interval(),
	tags: text().array(),
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

describe("compile: mutations -- bigint/interval/array write values (task 2.3, #322)", () => {
	it("lifts a bigint write value to a bare placeholder, decimal text bind parameter, losslessly past Number.MAX_SAFE_INTEGER (no cast, unlike interval)", () => {
		// 9007199254740993n is picked deliberately: one past
		// Number.MAX_SAFE_INTEGER, so a `number`-based lift would have
		// silently rounded it -- the exact same value the READ side already
		// pins against a real server (`packages/pg/test/integration.test.ts`:
		// `expect(row.amount).toBe(9007199254740993n)`), so read and write
		// losslessness are visibly the same value, one anchored on a real
		// server, the other a compile-level unit (write has no real-server
		// half of its own -- the server never round-trips a *parameter*
		// back to us to inspect, only the row it stores, which is the read
		// side's own proof).
		const statement = insert(metrics).values({ amount: 9007199254740993n });
		const result = compile(statement);

		expect(result.sql).toBe(
			'insert into "app"."metrics" ("amount") values ($1)',
		);
		expect(result.params).toEqual(["9007199254740993"]);
	});

	it("lifts a structured interval write value to a $n::interval placeholder, canonical always-full text bind parameter", () => {
		const statement = insert(metrics).values({
			amount: 1n,
			duration: {
				years: 1,
				months: 2,
				days: 3,
				hours: 4,
				minutes: 5,
				seconds: 6,
				microseconds: 7,
			},
		});
		const result = compile(statement);

		expect(result.sql).toBe(
			'insert into "app"."metrics" ("amount", "duration") values ($1, $2::interval)',
		);
		expect(result.params).toEqual([
			"1",
			"1 years 2 mons 3 days 04:05:06.000007",
		]);
	});

	it("lifts a JS array write value to a bare placeholder, canonical Postgres array literal text bind parameter", () => {
		const statement = insert(metrics).values({
			amount: 1n,
			tags: ["a", "b,c"],
		});
		const result = compile(statement);

		expect(result.sql).toBe(
			'insert into "app"."metrics" ("amount", "tags") values ($1, $2)',
		);
		expect(result.params).toEqual(["1", '{a,"b,c"}']);
	});

	it("numbers a bigint/interval/array mix left to right, across an update's set clause too", () => {
		const statement = update(metrics)
			.set({
				amount: 42n,
				duration: {
					years: 0,
					months: 0,
					days: 0,
					hours: 0,
					minutes: 0,
					seconds: 0,
					microseconds: 0,
				},
				tags: ["x"],
			})
			.where(eq(metrics.id, "11111111-1111-1111-1111-111111111111"));
		const result = compile(statement);

		expect(result.sql).toBe(
			'update "app"."metrics" set "amount" = $1, "duration" = $2::interval, "tags" = $3 where "app"."metrics"."id" = $4',
		);
		expect(result.params).toEqual([
			"42",
			"0 years 0 mons 0 days 00:00:00.000000",
			"{x}",
			"11111111-1111-1111-1111-111111111111",
		]);
	});
});

import {
	bigint,
	eq,
	insert,
	interval,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import {
	columnPlanForResult,
	convertRow,
	resolveColumnState,
} from "../../src/db/convert";
import { sql } from "../../src/sql";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	duration: interval(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	postedAt: timestamptz().notNull(),
});

const tables = { posts, comments };

describe("resolveColumnState (owner review judgment 4 -- the single resolver)", () => {
	it("resolves a declared column by SQL identity", () => {
		const state = resolveColumnState(tables, "app", "posts", "amount");
		expect(state?.mode).toBe("bigint");
	});

	it("returns undefined for a table/column that isn't declared at all", () => {
		expect(resolveColumnState(tables, "app", "nope", "id")).toBeUndefined();
		expect(resolveColumnState(tables, "app", "posts", "nope")).toBeUndefined();
	});
});

describe("columnPlanForResult + convertRow (task 4.4)", () => {
	it("bigint text arrives as the declared mode's type (whole-table select)", () => {
		const node = select(posts).selectQuery;
		const plan = columnPlanForResult(node, tables);

		const converted = convertRow(
			{
				id: "11111111-1111-1111-1111-111111111111",
				status: "draft",
				amount: "123",
				duration: "1 day",
			},
			plan,
		);

		expect(converted.amount).toBe(123n);
		expect(typeof converted.amount).toBe("bigint");
	});

	it("interval text arrives as a structured IntervalValue", () => {
		const node = select(posts).selectQuery;
		const plan = columnPlanForResult(node, tables);

		const converted = convertRow(
			{
				id: "x",
				status: "draft",
				amount: "0",
				duration: "1 year 2 mons 3 days 04:05:06.789123",
			},
			plan,
		);

		expect(converted.duration).toEqual({
			years: 1,
			months: 2,
			days: 3,
			hours: 4,
			minutes: 5,
			seconds: 6,
			microseconds: 789123,
		});
	});

	it("a poisoned cell names its column -- result-conversion-failed, {column}, cause", () => {
		const node = select(posts).selectQuery;
		const plan = columnPlanForResult(node, tables);

		try {
			convertRow(
				{ id: "x", status: "draft", amount: "not-a-number", duration: "1 day" },
				plan,
			);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "amount");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			expect(cause).toHaveProperty("code", "unparsable-numeric-text");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});

	it("null passes through unconverted, even for a numeric-mode column", () => {
		const node = select(posts).selectQuery;
		const plan = columnPlanForResult(node, tables);

		const converted = convertRow(
			{ id: "x", status: "draft", amount: null, duration: null },
			plan,
		);

		expect(converted.amount).toBeNull();
		expect(converted.duration).toBeNull();
	});

	it("a joined table's column resolves through the declarations record, not just the FROM table (path (c))", () => {
		const node = select(
			{ amount: posts.amount, postedAt: comments.postedAt },
			posts,
		).innerJoin(comments, eq(posts.id, comments.postId)).selectQuery;
		const plan = columnPlanForResult(node, tables);

		// object-projection aliases are snake_cased (select.ts's own
		// toSnakeCase), same as the driver would actually return them.
		const converted = convertRow(
			{
				amount: "7",
				// biome-ignore lint/style/useNamingConvention: posted_at models the real driver row key toSnakeCase(alias) produces -- the test's whole point is that alias.
				posted_at: "2026-01-01T00:00:00Z",
			},
			plan,
		);

		expect(converted.amount).toBe(7n);
		// timestamptz has no columnState-driven conversion at this contract
		// level (owner decision only names numeric mode + IntervalValue) --
		// it passes through whatever the driver already handed back.
		expect(converted.posted_at).toBe("2026-01-01T00:00:00Z");
	});

	it("a computed projection expression has no source column -- passes through raw (intentional limitation, #311)", () => {
		// sql`` is a fragment Expr, not a ColumnRef -- exactly the "no
		// declared column behind this value" case #311 documents.
		const node = select({ total: sql`${posts.amount} + 1` }, posts).selectQuery;
		const plan = columnPlanForResult(node, tables);

		// the driver would already have evaluated this expression server-side
		// and handed back whatever text/value type it renders as -- nothing
		// here has a declared column to convert against, so it passes
		// through completely unchanged, including a plain (non-bigint) number.
		const converted = convertRow({ total: 124 }, plan);
		expect(converted.total).toBe(124);
	});

	it("mutation returning() resolves via InsertNode.table -- the same resolver as select, no shortcut path", () => {
		const node = insert(posts)
			.values({ status: "draft" })
			.returning().insertQuery;
		const plan = columnPlanForResult(node, tables);

		const converted = convertRow(
			{ id: "x", status: "draft", amount: "42", duration: "1 day" },
			plan,
		);

		expect(converted.amount).toBe(42n);
	});
});

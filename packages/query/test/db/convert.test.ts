import {
	bigint,
	eq,
	insert,
	interval,
	numeric,
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
	columnPlanForStatement,
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
const events = table(app, "events", {
	id: uuid().primaryKey(),
	amounts: bigint({ mode: "bigint" }).array(),
	durations: interval().array(),
	tags: text().array(),
	precisions: numeric({ mode: "string" }).array(),
});
const flags = table(app, "flags", {
	id: uuid().primaryKey(),
	labels: text().array().notNullElements(),
	tags: text().array(),
});

const tables = { posts, comments, events, flags };

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

	it("an empty plan passes the row through completely unchanged (task 4.4-wiring: the sql escape hatch's own case)", () => {
		const row = { one: 1, two: "text", three: null };

		const converted = convertRow(row, []);

		expect(converted).toBe(row);
		expect(converted).toEqual({ one: 1, two: "text", three: null });
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
		// it passes through whatever the driver already handed back, keyed
		// by the caller's verbatim projection key (#339).
		expect(converted.postedAt).toBe("2026-01-01T00:00:00Z");
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

	it("mutation returning({...}) (explicit object projection) also converts -- not just the allColumns branch (batch B PASS follow-up 1)", () => {
		const node = insert(posts)
			.values({ status: "draft" })
			.returning({ total: posts.amount }).insertQuery;
		const plan = columnPlanForResult(node, tables);

		const converted = convertRow({ total: "42" }, plan);

		expect(converted.total).toBe(42n);
	});

	it("a declared column entirely missing from the driver row fails fast -- result-conversion-failed, not a silent undefined (batch B PASS follow-up 2)", () => {
		const node = select(posts).selectQuery;
		const plan = columnPlanForResult(node, tables);

		// "status" is declared (text, notNull) but has *no* mode/interval
		// conversion of its own -- without the fail-fast guard, convertCell's
		// fallback branch would happily return `undefined` for a missing key
		// with no error at all (a numeric/interval column would coincidentally
		// still throw, from convertNumericText/parseInterval choking on
		// `String(undefined)` -- that's a different failure and would mask
		// this guard being absent, so this test deliberately avoids it).
		try {
			convertRow({ id: "x", amount: "1", duration: "1 day" }, plan);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "status");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(/Next:/);
		}
	});

	it("a raw row key with no matching plan entry is silently dropped -- the opposite direction is fine (documented, not an error)", () => {
		const node = select(posts).selectQuery;
		const plan = columnPlanForResult(node, tables);

		const converted = convertRow(
			{
				id: "x",
				status: "draft",
				amount: "1",
				duration: "1 day",
				unexpectedExtraColumn: "should be dropped",
			},
			plan,
		);

		expect(converted).not.toHaveProperty("unexpectedExtraColumn");
	});
});

describe("columnPlanForResult + convertRow (task 1.2 -- array element-wise conversion)", () => {
	it("moded and interval array cells convert element-wise; a poisoned element names its column", () => {
		const node = select(events).selectQuery;
		const plan = columnPlanForResult(node, tables);

		// moded (bigint) array: the driver hands back a JS array of decimal-text elements.
		const bigintArray = convertRow(
			{
				id: "x",
				amounts: ["1", "2", "3"],
				durations: null,
				tags: null,
				precisions: null,
			},
			plan,
		);
		expect(bigintArray.amounts).toEqual([1n, 2n, 3n]);

		// interval[]: the driver hands back raw Postgres array-literal text.
		const intervalArray = convertRow(
			{
				id: "x",
				amounts: null,
				durations: '{"1 day","2 days 03:00:00"}',
				tags: null,
				precisions: null,
			},
			plan,
		);
		expect(intervalArray.durations).toEqual([
			{
				years: 0,
				months: 0,
				days: 1,
				hours: 0,
				minutes: 0,
				seconds: 0,
				microseconds: 0,
			},
			{
				years: 0,
				months: 0,
				days: 2,
				hours: 3,
				minutes: 0,
				seconds: 0,
				microseconds: 0,
			},
		]);

		// NULL elements pass through as null in both moded and interval arrays.
		const withNulls = convertRow(
			{
				id: "x",
				amounts: ["1", null, "3"],
				durations: '{"1 day",NULL}',
				tags: null,
				precisions: null,
			},
			plan,
		);
		expect(withNulls.amounts).toEqual([1n, null, 3n]);
		expect((withNulls.durations as ReadonlyArray<unknown>)[1]).toBeNull();

		// an array column with no element-level conversion (text[]) passes
		// its elements through raw, unchanged.
		const textArray = convertRow(
			{
				id: "x",
				amounts: null,
				durations: null,
				tags: ["a", "b"],
				precisions: null,
			},
			plan,
		);
		expect(textArray.tags).toEqual(["a", "b"]);

		// a poisoned element fails the whole cell, naming the column -- never
		// a partial array.
		try {
			convertRow(
				{
					id: "x",
					amounts: ["1", "not-a-number"],
					durations: null,
					tags: null,
				},
				plan,
			);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "amounts");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			expect(cause).toHaveProperty("code", "unparsable-numeric-text");
			expect((error as Error).message).toMatch(/Next:/);
		}

		// unparsable array-literal text fails the whole cell, never a partial
		// array -- 1.1's own contract carried through 1.2's wiring.
		try {
			convertRow(
				{
					id: "x",
					amounts: null,
					durations: "not-array-text",
					tags: null,
					precisions: null,
				},
				plan,
			);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "durations");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			expect(cause).toHaveProperty("code", "unparsable-array-text");
		}

		// arrival shape is decided by the declared element type, never by
		// sniffing raw's own runtime type: an interval[] cell that arrives as
		// an already-parsed JS array (the shape only a non-interval element
		// is contracted to) fails fast naming the column, rather than being
		// silently accepted.
		try {
			convertRow(
				{
					id: "x",
					amounts: null,
					durations: ["1 day"],
					tags: null,
					precisions: null,
				},
				plan,
			);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "durations");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			// the declared-element-type guard fired -- not an incidental
			// TypeError a missing guard would let through unnoticed.
			expect(cause).toHaveProperty("code", "unexpected-array-arrival-shape");
		}

		// the reverse mismatch: a moded array cell that arrives as raw text
		// (the shape only interval[] is contracted to) also fails fast,
		// naming the column, rather than being guessed at.
		try {
			convertRow(
				{
					id: "x",
					amounts: "{1,2,3}",
					durations: null,
					tags: null,
					precisions: null,
				},
				plan,
			);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "amounts");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			expect(cause).toHaveProperty("code", "unexpected-array-arrival-shape");
		}
	});

	it("numeric array cells convert from raw array text, exact decimal preserved (B2.2, #320)", () => {
		const node = select(events).selectQuery;
		const plan = columnPlanForResult(node, tables);

		// numeric[] (like interval[], task B2.1's driver override, oid 1231):
		// the driver hands back raw Postgres array-literal text, never pg's
		// own default array parser -- which would have already
		// `parseFloat`'d each element, destroying the exact decimal text a
		// 'string'-mode numeric[] column needs (found via the postgres:17
		// integration proof, task 1.5).
		const numericArray = convertRow(
			{
				id: "x",
				amounts: null,
				durations: null,
				tags: null,
				precisions: "{123.450000,0.100000}",
			},
			plan,
		);
		expect(numericArray.precisions).toEqual(["123.450000", "0.100000"]);

		// negative elements round-trip too (planner review, B2 follow-up ②)
		// -- the array-text parser's unquoted-element token and
		// convertNumericText's own decimal pattern both already allow a
		// leading "-"; this pins that neither breaks now that numeric[]
		// reaches them as raw array text.
		const negativeArray = convertRow(
			{
				id: "x",
				amounts: null,
				durations: null,
				tags: null,
				precisions: "{-1.5,-0.100000}",
			},
			plan,
		);
		expect(negativeArray.precisions).toEqual(["-1.5", "-0.100000"]);

		// NULL elements pass through as null here too.
		const withNull = convertRow(
			{
				id: "x",
				amounts: null,
				durations: null,
				tags: null,
				precisions: "{123.450000,NULL}",
			},
			plan,
		);
		expect(withNull.precisions).toEqual(["123.450000", null]);

		// arrival-shape mismatch fails fast here too, naming the column --
		// a numeric[] cell that arrives as an already-parsed JS array (the
		// shape only a non-interval/non-numeric element is contracted to).
		try {
			convertRow(
				{
					id: "x",
					amounts: null,
					durations: null,
					tags: null,
					precisions: [123.45, 0.1],
				},
				plan,
			);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "precisions");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			expect(cause).toHaveProperty("code", "unexpected-array-arrival-shape");
		}

		// NaN parity (planner review, B2 follow-up ①): `NaN` is a legal
		// Postgres `numeric` value, rendered unquoted as `NaN` by
		// `array_out` -- the same token an unquoted `NULL` element sits
		// right next to in `array-text.ts`'s own grammar. This pins two
		// things at once: `NaN` is never misread as the SQL null (`null`
		// would mean {@link array-text.ts}'s own `NULL`-token guard
		// mis-fired), and it still fails the same way scalar `numeric`
		// already does -- `convertNumericText`'s shared
		// `NUMERIC_TEXT_PATTERN` (numeric-mode.ts, untouched here) never
		// accepted `"NaN"` even before numeric[] arrived as raw array
		// text, so this is a parity assertion, not a behavior change.
		try {
			convertRow(
				{
					id: "x",
					amounts: null,
					durations: null,
					tags: null,
					precisions: "{NaN}",
				},
				plan,
			);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "precisions");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			expect(cause).toHaveProperty("code", "unparsable-numeric-text");
		}
	});
});

describe("columnPlanForResult + convertRow (task 3.1 -- .notNullElements() conversion guard)", () => {
	it("a NULL element under notNullElements rejects naming the column; a plain array column still passes it through as null", () => {
		const node = select(flags).selectQuery;
		const plan = columnPlanForResult(node, tables);

		// a plain array column (no notNullElements) keeps passing a NULL
		// element through as null, unchanged from the pre-3.1 behavior.
		const passthrough = convertRow(
			{ id: "x", labels: ["a", "b"], tags: [null, "b"] },
			plan,
		);
		expect(passthrough.tags).toEqual([null, "b"]);

		// a NULL element under notNullElements fails fast, naming the
		// column -- the backing CHECK should have rejected this at write
		// time, so its arrival here means the constraint was dropped or
		// bypassed out-of-band (design decision 4).
		try {
			convertRow({ id: "x", labels: ["a", null, "c"], tags: null }, plan);
			expect.unreachable("convertRow should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "result-conversion-failed");
			expect(error).toHaveProperty("column", "labels");
			const cause = (error as Error & { cause?: unknown }).cause;
			expect(cause).toBeInstanceOf(Error);
			// design decision 4: no new error code -- the existing
			// result-conversion-failed family (asserted above) is the whole
			// contract, so the cause carries no code of its own.
			expect((cause as Error & { code?: unknown }).code).toBeUndefined();
			expect((cause as Error).message).toMatch(/Next:/);
		}

		// a clean labels array (no null elements) still converts normally --
		// text has no declared element conversion, so it passes through.
		const clean = convertRow({ id: "x", labels: ["a", "b"], tags: null }, plan);
		expect(clean.labels).toEqual(["a", "b"]);
	});

	it("a whole-column SQL NULL still passes through for a notNullElements column; only a NULL element is rejected", () => {
		// .notNullElements() declares "no NULL element inside the array",
		// never .notNull() ("this column itself can't be NULL") -- those are
		// different axes. convertCell's own raw === null branch already
		// passes a NULL column value through before convertDeclaredValue (and
		// therefore convertArrayElement) ever runs, so this pins that the
		// element-level guard never reaches up to reject the column-level
		// NULL too.
		const node = select(flags).selectQuery;
		const plan = columnPlanForResult(node, tables);

		const converted = convertRow({ id: "x", labels: null, tags: null }, plan);

		expect(converted.labels).toBeNull();
	});
});

describe("columnPlanForStatement (task 4.4-wiring: the same resolver, from the CompileInput execute() actually receives)", () => {
	it("resolves a select builder-stage statement exactly like columnPlanForResult would from its unwrapped node", () => {
		const statement = select(posts);

		expect(columnPlanForStatement(statement, tables)).toEqual(
			columnPlanForResult(statement.selectQuery, tables),
		);
	});

	it("resolves a bare (already-unwrapped) QueryNode the same way", () => {
		const bareNode = select(posts).selectQuery;

		expect(columnPlanForStatement(bareNode, tables)).toEqual(
			columnPlanForResult(bareNode, tables),
		);
	});

	it("the sql escape hatch resolves to an empty plan -- no declared column to resolve against at all", () => {
		expect(columnPlanForStatement(sql`select 1`, tables)).toEqual([]);
	});

	it("a returning-less mutation resolves to an empty plan (InsertNode.returning === null)", () => {
		const statement = insert(posts).values({ status: "draft" });

		expect(columnPlanForStatement(statement, tables)).toEqual([]);
	});
});

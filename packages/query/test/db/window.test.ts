import {
	bigint,
	boolean,
	count,
	cumeDist,
	firstValue,
	lag,
	lastValue,
	lead,
	nthValue,
	ntile,
	over,
	percentRank,
	rank,
	rowNumber,
	schema,
	select,
	sum,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";
import { columnPlanForResult, convertRow } from "../../src/db/convert";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	active: boolean().notNull(),
});

const tables = { posts };

describe("window function conversion (task 4.2)", () => {
	it("a projected rowNumber arrives as a bigint, not a string", () => {
		const node = select(
			{ rnk: over(rowNumber(), { partitionBy: [posts.status] }) },
			posts,
		).selectQuery;
		const converted = convertRow(
			{ rnk: "3" },
			columnPlanForResult(node, tables),
		);
		expect(converted.rnk).toBe(3n);
		expect(typeof converted.rnk).toBe("bigint");
	});

	it("rank and denseRank convert to bigint too, the same as row_number", () => {
		const node = select(
			{ rnk: over(rank(), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		const converted = convertRow(
			{ rnk: "7" },
			columnPlanForResult(node, tables),
		);
		expect(converted.rnk).toBe(7n);
		expect(typeof converted.rnk).toBe("bigint");
	});

	it("count() over (…) still converts like count()", () => {
		const node = select(
			{ running: over(count(), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		const converted = convertRow(
			{ running: "7" },
			columnPlanForResult(node, tables),
		);
		expect(converted.running).toBe(7n);
		expect(typeof converted.running).toBe("bigint");
	});

	it("lag converts as its operand's own declared column does", () => {
		const node = select(
			{ prev: over(lag(posts.amount), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		const converted = convertRow(
			{ prev: "500" },
			columnPlanForResult(node, tables),
		);
		expect(converted.prev).toBe(500n);
		expect(typeof converted.prev).toBe("bigint");
	});

	// Each of the remaining four passthrough value functions (plus lag's
	// own multi-argument form) gets its own assertion: PASSTHROUGH_AGGREGATES
	// is a plain string list, so a missing or misspelled name compiles fine
	// and produces no other symptom than silent non-conversion -- deleting
	// any one of these four names from that list must turn this test red.
	it("lead, firstValue, lastValue and nthValue each convert as their own operand's declared column does, and lag's multi-argument form still does too", () => {
		const leadNode = select(
			{ next: over(lead(posts.amount), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		expect(
			convertRow({ next: "600" }, columnPlanForResult(leadNode, tables)).next,
		).toBe(600n);
		expect(
			typeof convertRow({ next: "600" }, columnPlanForResult(leadNode, tables))
				.next,
		).toBe("bigint");

		const firstNode = select(
			{ first: over(firstValue(posts.amount), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		const firstConverted = convertRow(
			{ first: "700" },
			columnPlanForResult(firstNode, tables),
		);
		expect(firstConverted.first).toBe(700n);
		expect(typeof firstConverted.first).toBe("bigint");

		const lastNode = select(
			{ last: over(lastValue(posts.amount), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		const lastConverted = convertRow(
			{ last: "800" },
			columnPlanForResult(lastNode, tables),
		);
		expect(lastConverted.last).toBe(800n);
		expect(typeof lastConverted.last).toBe("bigint");

		const nthNode = select(
			{ nth: over(nthValue(posts.amount, 2), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		const nthConverted = convertRow(
			{ nth: "900" },
			columnPlanForResult(nthNode, tables),
		);
		expect(nthConverted.nth).toBe(900n);
		expect(typeof nthConverted.nth).toBe("bigint");

		// lag's own multi-argument form (offset + default) -- same first-
		// argument-is-the-operand contract passthroughArgumentState relies on.
		const laggedWithDefaultNode = select(
			{
				prevOrDefault: over(lag(posts.amount, 1, posts.amount), {
					orderBy: [posts.status],
				}),
			},
			posts,
		).selectQuery;
		const laggedWithDefaultConverted = convertRow(
			{
				// biome-ignore lint/style/useNamingConvention: prev_or_default models the real driver row key toSnakeCase(alias) produces -- resultKey (camelCase) is what the CONVERTED row carries.
				prev_or_default: "1000",
			},
			columnPlanForResult(laggedWithDefaultNode, tables),
		);
		expect(laggedWithDefaultConverted.prevOrDefault).toBe(1000n);
		expect(typeof laggedWithDefaultConverted.prevOrDefault).toBe("bigint");
	});

	it("ntile/percentRank/cumeDist need no conversion -- they pass through unchanged", () => {
		const node = select(
			{
				bucket: over(ntile(4), { orderBy: [posts.status] }),
				pct: over(percentRank(), { orderBy: [posts.status] }),
				cume: over(cumeDist(), { orderBy: [posts.status] }),
			},
			posts,
		).selectQuery;
		const converted = convertRow(
			{ bucket: 2, pct: 0.5, cume: 0.75 },
			columnPlanForResult(node, tables),
		);
		expect(converted.bucket).toBe(2);
		expect(converted.pct).toBe(0.5);
		expect(converted.cume).toBe(0.75);
	});

	it("sum stays uncast when windowed too, the same as unwindowed (D104: the delegation must not special-case it)", () => {
		const node = select(
			{ total: over(sum(posts.amount), { orderBy: [posts.status] }) },
			posts,
		).selectQuery;
		const converted = convertRow(
			{ total: "30" },
			columnPlanForResult(node, tables),
		);
		// unconverted: the driver's own value, matching the unwindowed
		// sum()'s own "left alone" behavior (convert.test.ts).
		expect(converted.total).toBe("30");
	});
});

describe("window functions through the chain surface (task 4.3)", () => {
	it("a chain-built window projection compiles byte-identically to the core builder formulation", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);

		const chainCompiled = handle
			.select(
				{
					rnk: over(rank(), { partitionBy: [posts.status] }),
				},
				posts,
			)
			.compile();
		const coreCompiled = compile(
			select({ rnk: over(rank(), { partitionBy: [posts.status] }) }, posts),
		);

		expect(chainCompiled).toEqual(coreCompiled);
	});

	// The chain delegates where/groupBy/having to core's own select() stage
	// (chain.ts's makeJoinableChain/makeFilteredChain/makeGroupedChain),
	// which is what lets 3.1's guard come along for free -- but that is a
	// fact about today's code, not a contract (criterion 15: prove the
	// rejection on the OTHER path too, not only on the builder
	// window-placement.test.ts already covers).
	it("the chain's where/groupBy/having refuse a window function too", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ posts }, driver);
		const windowed = over(lag(posts.active), { partitionBy: [posts.status] });

		expect(() => handle.select(posts).where(windowed)).toThrowError(
			expect.objectContaining({ code: "window-function-not-allowed" }),
		);
		expect(() => handle.select(posts).groupBy(windowed)).toThrowError(
			expect.objectContaining({ code: "window-function-not-allowed" }),
		);
		expect(() =>
			handle.select(posts).groupBy(posts.status).having(windowed),
		).toThrowError(
			expect.objectContaining({ code: "window-function-not-allowed" }),
		);
	});
});

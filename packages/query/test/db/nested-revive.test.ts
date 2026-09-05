import type { BuilderFunctionName, SelectProjection } from "@hejbro/core";
import {
	avg,
	BUILDER_READ_SHAPES,
	bigint,
	bytea,
	count,
	cumeDist,
	date as dateColumn,
	denseRank,
	eq,
	firstValue,
	interval,
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
	rowNumber,
	schema,
	select,
	sql,
	sum,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid()
		.notNull()
		.references(() => posts.id),
	viewCount: bigint().notNull(),
	createdAt: timestamptz().notNull(),
	payload: bytea(),
});

// What node-postgres actually delivers for a json cell: the PARSED value.
// Child keys are the derived table's snake aliases; the F1 arrival
// contract fixes each shape (bigint as text, timestamptz as ISO-8601,
// bytea as the driver-pinned hex form).
const rawRow = {
	id: "0b0e5b3e-0000-4000-8000-000000000001",
	title: "hello",
	comments: [
		{
			id: "0b0e5b3e-0000-4000-8000-000000000002",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			post_id: "0b0e5b3e-0000-4000-8000-000000000001",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			view_count: "9007199254740993",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			created_at: "2026-08-28T09:00:00+00:00",
			payload: "\\x0102ff",
		},
	],
};

describe("nested revive (add-relational-reads task 3.4)", () => {
	it("revives nested values to their declared read types", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ app, posts, comments }, driver);

		const rows = await handle.select(posts).related({ comments: true });
		const comment = rows[0]?.comments[0];
		expect(comment?.viewCount).toBe(9007199254740993n);
		expect(comment?.createdAt).toEqual(new Date("2026-08-28T09:00:00+00:00"));
		expect(comment?.payload).toEqual(new Uint8Array([1, 2, 255]));
		// keys arrive under the declared TypeScript names, not the aliases
		expect(comment?.postId).toBe("0b0e5b3e-0000-4000-8000-000000000001");
	});

	it("empty collection stays [], missing single row stays null", async () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey(),
			joinedAt: timestamptz().notNull(),
		});
		const posts2 = table(app, "posts2", {
			id: uuid().primaryKey(),
			authorId: uuid().references(() => authors.id),
		});
		const comments2 = table(app, "comments2", {
			id: uuid().primaryKey(),
			postId: uuid()
				.notNull()
				.references(() => posts2.id),
		});
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-00000000000a",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			author_id: null,
			comments2: [],
			author: null,
		};
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, authors, posts2, comments2 }, driver);
		const rows = await handle
			.select(posts2)
			.related({ comments2: true, author: true });
		expect(rows[0]?.comments2).toEqual([]);
		expect(rows[0]?.author).toBeNull();
	});
});

describe("nested revive shape table (crap-coverage for the revive paths)", () => {
	it("revives numeric modes, intervals, and at-risk arrays element-wise", async () => {
		const metrics = table(app, "metrics", {
			id: uuid().primaryKey(),
			postId: uuid()
				.notNull()
				.references(() => posts.id),
			score: numeric({ mode: "string" }),
			spent: interval(),
			amounts: bigint().array(),
		});
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			title: "hello",
			metrics: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000003",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
					score: "12.500",
					spent: "1 day 02:03:04",
					amounts: ["9007199254740993", null, "1"],
				},
			],
		};
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, posts, comments, metrics }, driver);
		const rows = await handle.select(posts).related({ metrics: true });
		const metric = rows[0]?.metrics[0];
		expect(metric?.score).toBe("12.500");
		expect(metric?.spent).toMatchObject({ days: 1 });
		expect(metric?.amounts).toEqual([9007199254740993n, null, 1n]);
	});

	it("a schema-map table that does not reference the parent is not a relation", () => {
		const bystanders = table(app, "bystanders", { id: uuid().primaryKey() });
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const handle = db({ app, posts, comments, bystanders }, driver);
		const derive = () =>
			handle
				.select(posts)
				// @ts-expect-error bystanders declares no edge to posts
				.related({ bystanders: true });
		expect(derive).toThrowError(/bystanders/);
		try {
			derive();
			expect.unreachable("derive() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("unknown-relation");
		}
	});
});

describe("nested revive edges (crap-coverage: null cells, failures, uncast passthrough)", () => {
	it("a null nested scalar passes through; a malformed value fails loudly", async () => {
		const metrics2 = table(app, "metrics2", {
			id: uuid().primaryKey(),
			postId: uuid()
				.notNull()
				.references(() => posts.id),
			spent: interval(),
		});
		const goodRow = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			title: "hello",
			metrics2: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000004",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
					spent: null,
				},
				{
					id: "0b0e5b3e-0000-4000-8000-000000000005",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
				},
			],
		};
		const good = recordingTransactionalDriver({ rows: [goodRow] });
		const rows = await db({ app, posts, comments, metrics2 }, good.driver)
			.select(posts)
			.related({ metrics2: true });
		expect(rows[0]?.metrics2[0]?.spent).toBeNull();
		expect(rows[0]?.metrics2[1]?.spent).toBeUndefined();

		const badRow = {
			...goodRow,
			metrics2: [{ ...goodRow.metrics2[0], spent: "not an interval" }],
		};
		const bad = recordingTransactionalDriver({ rows: [badRow] });
		await expect(
			db({ app, posts, comments, metrics2 }, bad.driver)
				.select(posts)
				.related({ metrics2: true }),
		).rejects.toMatchObject({ code: "result-conversion-failed" });
	});

	it("malformed nested date and datetime values fail loudly too (R1)", async () => {
		const stamps = table(app, "stamps", {
			id: uuid().primaryKey(),
			postId: uuid()
				.notNull()
				.references(() => posts.id),
			day: dateColumn(),
			at: timestamptz(),
		});
		const buildRow = (patch: Record<string, unknown>) => ({
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			title: "hello",
			stamps: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000008",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table snake alias).
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
					day: "2026-08-28",
					at: "2026-08-28T09:00:00+00:00",
					...patch,
				},
			],
		});
		const badDay = recordingTransactionalDriver({
			rows: [buildRow({ day: "not-a-date" })],
		});
		await expect(
			db({ app, posts, comments, stamps }, badDay.driver)
				.select(posts)
				.related({ stamps: true }),
		).rejects.toMatchObject({ code: "result-conversion-failed" });
		const badAt = recordingTransactionalDriver({
			rows: [buildRow({ at: "not-a-datetime" })],
		});
		await expect(
			db({ app, posts, comments, stamps }, badAt.driver)
				.select(posts)
				.related({ stamps: true }),
		).rejects.toMatchObject({ code: "result-conversion-failed" });
	});

	it("a computed sql`` nested column passes through unconverted (no declared state)", async () => {
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table's snake alias) -- the revive's whole point.
			counts: [{ n: 7, cast_id: "x" }],
		};
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, posts, comments }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				counts: jsonArrayFrom(
					select(
						{ n: sql`count(*)`, castId: sql`${comments.id}::uuid` },
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		const counts = rows[0]?.counts as ReadonlyArray<{ n: unknown }>;
		expect(counts[0]?.n).toBe(7);
	});
});

describe("grandchild revive (g3 review F4 -- kills the nested-plan recursion mutant)", () => {
	it("a depth-2 nested value revives to its declared type", async () => {
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			threads: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000007",
					parent: {
						id: "0b0e5b3e-0000-4000-8000-000000000001",
						title: "hello",
						// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table snake alias).
						view_total: "9007199254740993",
					},
				},
			],
		};
		const totals = table(app, "totals", {
			id: uuid().primaryKey(),
			title: text().notNull(),
			viewTotal: bigint().notNull(),
		});
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const handle = db({ app, posts, comments, totals }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				threads: jsonArrayFrom(
					select(
						{
							id: comments.id,
							parent: jsonObjectFrom(
								select(totals).where(eq(totals.id, posts.id)),
							),
						},
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		const threads = rows[0]?.threads as ReadonlyArray<{
			parent: { viewTotal: bigint } | null;
		}>;
		const grandchild = threads[0]?.parent;
		expect(grandchild?.viewTotal).toBe(9007199254740993n);
	});
});

// #452 task 1.3: BUILDER_READ_SHAPES-driven revive table -- one row per
// builder function (windowed and unwindowed where the function allows
// it), asserting the revived JS value matches its shape: `int8` revives
// as `bigint` regardless of argument, `argument` revives exactly as its
// own argument's declared state (a bigint argument parses, a text one
// passes through unchanged), `own` is never revived at all -- the raw
// JSON arrival passes straight through unconverted.
describe("nested revive follows BUILDER_READ_SHAPES (#452 task 1.3)", () => {
	const items = table(app, "items", {
		id: uuid().primaryKey(),
		postId: uuid()
			.notNull()
			.references(() => posts.id),
		amount: bigint().notNull(),
		label: text().notNull(),
	});

	const pastPrecision = "9007199254740993";

	const revive = async (
		cell: Parameters<typeof jsonArrayFrom>[0],
		rawCellValue: unknown,
	): Promise<unknown> => {
		const { driver } = recordingTransactionalDriver({
			rows: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000001",
					stats: [{ cell: rawCellValue }],
				},
			],
		});
		const handle = db({ app, posts, comments, items }, driver);
		const rows = await handle.select(
			{ id: posts.id, stats: jsonArrayFrom(cell) },
			posts,
		);
		return (rows[0]?.stats[0] as Record<string, unknown> | undefined)?.cell;
	};

	const itemsFor = <TProjection extends SelectProjection>(
		projected: TProjection,
	) => select(projected, items).where(eq(items.postId, posts.id));

	// A real partitionBy+orderBy, not an empty spec -- {} proved nothing
	// about a real window's own clauses; the revived value must be the
	// same either way (#452 review).
	const itemsSpec = { partitionBy: [items.postId], orderBy: [items.amount] };

	it.each([
		["count", () => itemsFor({ cell: count() })],
		["count (windowed)", () => itemsFor({ cell: over(count(), itemsSpec) })],
		[
			"row_number (windowed)",
			() => itemsFor({ cell: over(rowNumber(), itemsSpec) }),
		],
		["rank (windowed)", () => itemsFor({ cell: over(rank(), itemsSpec) })],
		[
			"dense_rank (windowed)",
			() => itemsFor({ cell: over(denseRank(), itemsSpec) }),
		],
	])("%s revives as bigint (int8 shape)", async (_label, build) => {
		expect(await revive(build(), pastPrecision)).toBe(9007199254740993n);
	});

	it.each([
		["min", () => itemsFor({ cell: min(items.amount) })],
		[
			"min (windowed)",
			() => itemsFor({ cell: over(min(items.amount), itemsSpec) }),
		],
		["max", () => itemsFor({ cell: max(items.amount) })],
		[
			"max (windowed)",
			() => itemsFor({ cell: over(max(items.amount), itemsSpec) }),
		],
		[
			"lag (windowed)",
			() => itemsFor({ cell: over(lag(items.amount), itemsSpec) }),
		],
		[
			"lead (windowed)",
			() => itemsFor({ cell: over(lead(items.amount), itemsSpec) }),
		],
		[
			"first_value (windowed)",
			() => itemsFor({ cell: over(firstValue(items.amount), itemsSpec) }),
		],
		[
			"last_value (windowed)",
			() => itemsFor({ cell: over(lastValue(items.amount), itemsSpec) }),
		],
		[
			"nth_value (windowed)",
			() => itemsFor({ cell: over(nthValue(items.amount, 1), itemsSpec) }),
		],
	])(
		"%s revives per its bigint argument (argument shape)",
		async (_label, build) => {
			expect(await revive(build(), pastPrecision)).toBe(9007199254740993n);
		},
	);

	it.each([
		["min over a text argument", () => itemsFor({ cell: min(items.label) })],
		["max over a text argument", () => itemsFor({ cell: max(items.label) })],
		[
			"min over a text argument (windowed)",
			() => itemsFor({ cell: over(min(items.label), itemsSpec) }),
		],
		[
			"max over a text argument (windowed)",
			() => itemsFor({ cell: over(max(items.label), itemsSpec) }),
		],
		[
			"lag over a text argument (windowed)",
			() => itemsFor({ cell: over(lag(items.label), itemsSpec) }),
		],
		[
			"lead over a text argument (windowed)",
			() => itemsFor({ cell: over(lead(items.label), itemsSpec) }),
		],
		[
			"first_value over a text argument (windowed)",
			() => itemsFor({ cell: over(firstValue(items.label), itemsSpec) }),
		],
		[
			"last_value over a text argument (windowed)",
			() => itemsFor({ cell: over(lastValue(items.label), itemsSpec) }),
		],
		[
			"nth_value over a text argument (windowed)",
			() => itemsFor({ cell: over(nthValue(items.label, 1), itemsSpec) }),
		],
	])(
		"%s revives per its text argument, not forced to bigint",
		async (_label, build) => {
			expect(await revive(build(), "hello")).toBe("hello");
		},
	);

	it.each([
		["sum", () => itemsFor({ cell: sum(items.amount) })],
		[
			"sum (windowed)",
			() => itemsFor({ cell: over(sum(items.amount), itemsSpec) }),
		],
		["avg", () => itemsFor({ cell: avg(items.amount) })],
		[
			"avg (windowed)",
			() => itemsFor({ cell: over(avg(items.amount), itemsSpec) }),
		],
		[
			"percent_rank (windowed)",
			() => itemsFor({ cell: over(percentRank(), itemsSpec) }),
		],
		[
			"cume_dist (windowed)",
			() => itemsFor({ cell: over(cumeDist(), itemsSpec) }),
		],
		["ntile (windowed)", () => itemsFor({ cell: over(ntile(4), itemsSpec) })],
	])(
		"%s is never revived (own shape) -- the raw arrival passes through",
		async (_label, build) => {
			expect(await revive(build(), 42)).toBe(42);
		},
	);
});

// #444 F6 task 6.2: characterize which aggregate cell shapes inside a
// nested read actually come back wrong before fixing anything.
// withJsonSafeCasts' at-risk cast (select.ts) is columnRef-only, so a
// bigint-typed aggregate cell in a jsonArrayFrom/jsonObjectFrom
// projection compiles WITHOUT the ::text cast that carries the value
// through JSON transport losslessly -- convert.ts's columnStateForExpr
// already resolves count()/min()/max()'s declared bigint state
// correctly (a JS-side revive concern, separate from this SQL-level
// cast), so it WILL attempt BigInt(rawJsonValue) on whatever the
// uncast JSON number already lost precision to. sum()/avg() are never
// converted by convert.ts at all (PASSTHROUGH_AGGREGATES excludes
// them, deliberately -- Postgres's own promotion table isn't modeled),
// so they never claim a wrong bigint either way, cast or not.
describe("aggregate cell casts inside a nested read, characterized (#444 F6 task 6.2)", () => {
	it("an aggregate cell in a nested read survives past 2^53", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "0b0e5b3e-0000-4000-8000-000000000001", stats: [] }],
		});
		const handle = db({ app, posts, comments }, driver);
		await handle.select(
			{
				id: posts.id,
				stats: jsonArrayFrom(
					select(
						{ maxViews: max(comments.viewCount), total: count() },
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		const sentSql = topLevelSent[0]?.sql ?? "";
		// at risk, and convert.ts DOES try to revive both as bigint: must
		// be cast, so a real server hands back text, not a lossy number.
		expect(sentSql).toContain('max("app"."comments"."view_count")::text');
		expect(sentSql).toContain("count(*)::text");
	});

	it("sum() is never converted by convert.ts, cast or not -- already safe from the wrong-bigint defect", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ id: "0b0e5b3e-0000-4000-8000-000000000001", stats: [] }],
		});
		const handle = db({ app, posts, comments }, driver);
		await handle.select(
			{
				id: posts.id,
				stats: jsonArrayFrom(
					select({ total: sum(comments.viewCount) }, comments).where(
						eq(comments.postId, posts.id),
					),
				),
			},
			posts,
		);
		const sentSql = topLevelSent[0]?.sql ?? "";
		expect(sentSql).toContain('sum("app"."comments"."view_count")');
		expect(sentSql).not.toContain('sum("app"."comments"."view_count")::text');
	});
});

// #444 F6 follow-up (found live, task 7.3): the ::text cast alone was not
// enough -- convert.ts's own uncast() only recognized a cast-wrapped
// columnRef, so a cast-wrapped aggregate (functionCall) fell through
// columnStateForExpr unresolved and the now-text value arrived un-revived
// (a string, not a bigint). uncast() now sees through any cast-wrapped
// expr, not columnRef only.
describe("a cast aggregate cell actually revives, not just compiles cast (#444 F6 live-witness follow-up)", () => {
	it("a cast max(bigint)/count() cell in a nested read revives to bigint, not a string", async () => {
		const rawRow = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			stats: [
				{
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the projection's own alias).
					max_views: "9007199254740993",
					total: "2",
				},
			],
		};
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ app, posts, comments }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				stats: jsonArrayFrom(
					select(
						{ maxViews: max(comments.viewCount), total: count() },
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		const stat = rows[0]?.stats[0];
		expect(stat?.maxViews).toBe(9007199254740993n);
		expect(stat?.total).toBe(2n);
	});

	// #444 F6 spec delta -- "Scenario: An explicit user cast is left
	// alone": a caller's OWN `` sql`${max(t.a)}::text` `` is an
	// instruction ("give me text"), not the compiler's own at-risk
	// encoding, so it is deliberately never undone -- unlike
	// hejbro's own cast (the test above), this one keeps its
	// as-written text shape. Pins the behavior the group-8 red test
	// found (a user-authored template never matches the compiler's
	// own two-chunk cast shape, see convert.ts's `castTarget`) now
	// that it is specified, not just true by accident.
	it("a user-authored sql cast (interpolating an aggregate, ::text) in a nested read stays text, not revived", async () => {
		const rawRow = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the projection's own rendered SQL alias, snake_case).
			stats: [{ max_views: "9007199254740993" }],
		};
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ app, posts, comments }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				stats: jsonArrayFrom(
					select(
						{ maxViews: sql`${max(comments.viewCount)}::text` },
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		expect(rows[0]?.stats[0]?.maxViews).toBe("9007199254740993");
	});

	// Same instruction, windowed target -- the "two-chunk cast shape" logic
	// castTarget/uncast rely on has no reason to differ by windowing, but
	// this exact input (a user's own template wrapping an over(...) cell)
	// had no test until now (#452 neighbor-input promotion).
	it("a user-authored sql cast interpolating a WINDOWED aggregate stays text, not revived", async () => {
		const rawRow = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			// biome-ignore lint/style/useNamingConvention: models the real json child key (the projection's own rendered SQL alias, snake_case).
			stats: [{ max_views: "9007199254740993" }],
		};
		const { driver } = recordingTransactionalDriver({ rows: [rawRow] });
		const handle = db({ app, posts, comments }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				stats: jsonArrayFrom(
					select(
						{ maxViews: sql`${over(max(comments.viewCount), {})}::text` },
						comments,
					).where(eq(comments.postId, posts.id)),
				),
			},
			posts,
		);
		expect(rows[0]?.stats[0]?.maxViews).toBe("9007199254740993");
	});
});

/**
 * #452 task 1.4: `select.ts`'s cast decision (`atRiskCastSuffix`) and
 * `convert.ts`'s revive decision (`columnStateForExpr`/
 * `aggregateColumnState`) each read `BUILDER_READ_SHAPES` now, but the
 * two sides still cannot share a function (core is pure, this side
 * works over declared tables) -- this test asserts their AGREEMENT
 * observably instead: for every row in the table, "select.ts cast it"
 * and "convert.ts revived it to bigint" must be the same boolean.
 *
 * **This is a ratchet, not a fixed-shape regression test** — `expected`
 * is derived from `BUILDER_READ_SHAPES` itself (`shape !== "own"`), and
 * `builderCases` is a `Record<BuilderFunctionName, …>`: a constructor
 * added to the vocabulary without a matching case here fails `tsc` at
 * that record's own declaration, and the `it.each` below iterates the
 * table's actual rows, not a hand-copied list -- the windowed `count`
 * row is the one that was red before task 1.2's fix and green after.
 */
describe("select.ts casts iff convert.ts revives (#452 task 1.4 ratchet)", () => {
	// a past-2^53 value, delivered as text: distinguishes "revived as
	// bigint" (exact) from "passed through as a plain JS value" (a
	// string arriving un-revived stays exactly this string, never
	// becomes the bigint).
	const rawTextValue = "9007199254740993";

	const agreementFor = async (
		alias: string,
		stats: Parameters<typeof jsonArrayFrom>[0],
	): Promise<{
		readonly wasCast: boolean;
		readonly wasRevivedToBigint: boolean;
	}> => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000001",
					stats: [{ [alias]: rawTextValue }],
				},
			],
		});
		const handle = db({ app, posts, comments }, driver);
		const rows = await handle.select(
			{
				id: posts.id,
				stats: jsonArrayFrom(stats),
			},
			posts,
		);
		const sentSql = topLevelSent[0]?.sql ?? "";
		const revivedValue = (
			rows[0]?.stats[0] as Record<string, unknown> | undefined
		)?.[alias];
		return {
			wasCast: sentSql.includes("::text"),
			wasRevivedToBigint: typeof revivedValue === "bigint",
		};
	};

	// single-word aliases throughout (no camelCase hump) so the raw
	// driver row's own key and the converted row's resultKey are spelled
	// identically -- a hump (e.g. "maxViews") renders as a different
	// snake_case SQL alias ("max_views") than the camelCase resultKey
	// the converted row carries, a separate naming-translation concern
	// this ratchet isn't about.
	const cellFor = <TProjection extends SelectProjection>(
		projected: TProjection,
	) => select(projected, comments).where(eq(comments.postId, posts.id));

	// A real partitionBy+orderBy, not an empty spec (#452 review) -- the
	// agreement outcome must be identical either way.
	const commentsSpec = {
		partitionBy: [comments.postId],
		orderBy: [comments.createdAt],
	};

	type BuilderCase = {
		readonly unwindowed?: () => ReturnType<typeof cellFor>;
		readonly windowed: () => ReturnType<typeof cellFor>;
	};

	const builderCases: Record<BuilderFunctionName, BuilderCase> = {
		count: {
			unwindowed: () => cellFor({ cell: count() }),
			windowed: () => cellFor({ cell: over(count(), commentsSpec) }),
		},
		// biome-ignore lint/style/useNamingConvention: BuilderFunctionName's own Postgres names (D57).
		row_number: {
			windowed: () => cellFor({ cell: over(rowNumber(), commentsSpec) }),
		},
		rank: { windowed: () => cellFor({ cell: over(rank(), commentsSpec) }) },
		// biome-ignore lint/style/useNamingConvention: BuilderFunctionName's own Postgres names (D57).
		dense_rank: {
			windowed: () => cellFor({ cell: over(denseRank(), commentsSpec) }),
		},
		min: {
			unwindowed: () => cellFor({ cell: min(comments.viewCount) }),
			windowed: () =>
				cellFor({ cell: over(min(comments.viewCount), commentsSpec) }),
		},
		max: {
			unwindowed: () => cellFor({ cell: max(comments.viewCount) }),
			windowed: () =>
				cellFor({ cell: over(max(comments.viewCount), commentsSpec) }),
		},
		lag: {
			windowed: () =>
				cellFor({ cell: over(lag(comments.viewCount), commentsSpec) }),
		},
		lead: {
			windowed: () =>
				cellFor({ cell: over(lead(comments.viewCount), commentsSpec) }),
		},
		// biome-ignore lint/style/useNamingConvention: BuilderFunctionName's own Postgres names (D57).
		first_value: {
			windowed: () =>
				cellFor({ cell: over(firstValue(comments.viewCount), commentsSpec) }),
		},
		// biome-ignore lint/style/useNamingConvention: BuilderFunctionName's own Postgres names (D57).
		last_value: {
			windowed: () =>
				cellFor({ cell: over(lastValue(comments.viewCount), commentsSpec) }),
		},
		// biome-ignore lint/style/useNamingConvention: BuilderFunctionName's own Postgres names (D57).
		nth_value: {
			windowed: () =>
				cellFor({ cell: over(nthValue(comments.viewCount, 1), commentsSpec) }),
		},
		sum: {
			unwindowed: () => cellFor({ cell: sum(comments.viewCount) }),
			windowed: () =>
				cellFor({ cell: over(sum(comments.viewCount), commentsSpec) }),
		},
		avg: {
			unwindowed: () => cellFor({ cell: avg(comments.viewCount) }),
			windowed: () =>
				cellFor({ cell: over(avg(comments.viewCount), commentsSpec) }),
		},
		// biome-ignore lint/style/useNamingConvention: BuilderFunctionName's own Postgres names (D57).
		percent_rank: {
			windowed: () => cellFor({ cell: over(percentRank(), commentsSpec) }),
		},
		// biome-ignore lint/style/useNamingConvention: BuilderFunctionName's own Postgres names (D57).
		cume_dist: {
			windowed: () => cellFor({ cell: over(cumeDist(), commentsSpec) }),
		},
		ntile: { windowed: () => cellFor({ cell: over(ntile(4), commentsSpec) }) },
	};

	type RatchetRow = readonly [
		name: string,
		form: "unwindowed" | "windowed",
		expected: boolean,
		build: () => ReturnType<typeof cellFor>,
	];

	/** `builderCases` is total over `BuilderFunctionName` -- every key `Object.entries(BUILDER_READ_SHAPES)` can produce resolves, `noUncheckedIndexedAccess`'s own conservative `| undefined` aside. */
	const caseFor = (name: BuilderFunctionName): BuilderCase => {
		const found = builderCases[name];
		if (found === undefined) {
			throw new Error(`no builderCases entry for ${name}`);
		}
		return found;
	};

	const ratchetRows: ReadonlyArray<RatchetRow> = Object.entries(
		BUILDER_READ_SHAPES,
	).flatMap(([name, shape]) => {
		const builderCase = caseFor(name as BuilderFunctionName);
		const expected = shape !== "own";
		const windowedRow: RatchetRow = [
			name,
			"windowed",
			expected,
			builderCase.windowed,
		];
		if (builderCase.unwindowed === undefined) {
			return [windowedRow];
		}
		const unwindowedRow: RatchetRow = [
			name,
			"unwindowed",
			expected,
			builderCase.unwindowed,
		];
		return [unwindowedRow, windowedRow];
	});

	it.each(ratchetRows)(
		"%s (%s): cast and revive agree (expected %s)",
		async (_name, _form, expected, build) => {
			const result = await agreementFor("cell", build());
			expect(result.wasCast).toBe(expected);
			expect(result.wasRevivedToBigint).toBe(expected);
		},
	);
});

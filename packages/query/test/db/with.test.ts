import {
	bigint,
	count,
	eq,
	jsonArrayFrom,
	jsonObjectFrom,
	max,
	schema,
	select,
	table,
	timestamptz,
	uuid,
	withCte,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { columnPlanForStatement, convertRow } from "../../src/db/convert";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	amount: bigint({ mode: "bigint" }),
});
const tables = { posts };

describe("a field needing conversion arrives converted through a with wrapper (add-ctes task 5.3)", () => {
	it("a bigint field projected through a CTE reads back as a real bigint, not the driver's raw text", () => {
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			return select({ id: ranked.id, amount: ranked.amount }, ranked);
		});
		const plan = columnPlanForStatement(stage, tables);
		const converted = convertRow({ id: "1", amount: "9007199254740993" }, plan);
		expect(converted.amount).toBe(9007199254740993n);
		expect(typeof converted.amount).toBe("bigint");
	});
});

// D106 R1 B1 (harden-aggregate-vocabulary): a nested read projected
// inside a CTE body and read back through the CTE's column used to
// arrive as the cast's text -- the CTE column resolved a scalar state
// and dropped the entry's nested plan.
describe("a nested read carries its revive plan out of a CTE", () => {
	const comments = table(app, "comments", {
		id: uuid().primaryKey(),
		postId: uuid().notNull(),
		score: bigint({ mode: "bigint" }),
		at: timestamptz(),
	});
	const declared = { posts, comments };

	const build = () =>
		withCte((w) => {
			const base = w.as(
				"base",
				select(
					{
						id: posts.id,
						n: jsonArrayFrom(
							select(
								{ score: comments.score, at: comments.at },
								comments,
							).where(eq(comments.postId, posts.id)),
						),
						o: jsonObjectFrom(
							select({ c: count(), m: max(comments.score) }, comments).where(
								eq(comments.postId, posts.id),
							),
						),
					},
					posts,
				),
			);
			return select({ id: base.id, n: base.n, o: base.o }, base);
		});

	it("revives bigint, timestamptz and aggregate cells through the CTE exactly as without one", () => {
		const plan = columnPlanForStatement(build(), declared);
		const converted = convertRow(
			{
				id: "1",
				n: [{ score: "9007199254740997", at: "2026-01-02T03:04:05.000Z" }],
				o: { c: "3", m: "9007199254740997" },
			},
			plan,
		);
		const n = converted.n as ReadonlyArray<{ score: unknown; at: unknown }>;
		expect(n[0]?.score).toBe(9007199254740997n);
		expect(n[0]?.at).toBeInstanceOf(Date);
		const o = converted.o as { c: unknown; m: unknown };
		expect(o.c).toBe(3n);
		expect(o.m).toBe(9007199254740997n);
	});
});

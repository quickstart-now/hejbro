import { describe, expect, it } from "vitest";
import {
	bigint,
	defineFunction,
	insert,
	interval,
	schema,
	table,
	text,
	uuid,
} from "../../src/index";

/**
 * Regression coverage for the crash this project found while investigating
 * #322's write-side literal kinds: a plpgsql function/trigger body embeds
 * mutations via `ctx.return(insert(...).values(...))` (an ordinary,
 * supported pattern), and `defineFunction`/`defineTrigger` run that body
 * TWICE through `recordBodyWithGuard` (`plpgsql/body-context.ts`) to check
 * determinism, comparing the two recordings with `stableJson` — a thin
 * wrapper over native `JSON.stringify`. Before task 2.3's `bigint`/
 * `interval`/`array` literal kinds settled on carrying a plain `text`
 * string, an earlier attempt carried a raw `bigint` in the AST, and
 * `JSON.stringify` throws a raw `TypeError` on a `bigint` anywhere in the
 * object graph — crashing this determinism check the moment a body
 * embedded a bigint-valued insert, before the function was ever declared.
 * Text-only literal kinds are JSON-safe by construction, so this never
 * reaches `stableJson` at all; these tests pin that a body embedding each
 * of the three new literal kinds still declares successfully.
 */
const app = schema("app");
const metrics = table(app, "metrics", {
	id: uuid().primaryKey(),
	amount: bigint().notNull(),
	duration: interval(),
	tags: text().array(),
});

describe("plpgsql body determinism guard survives bigint/interval/array mutation write values (task 2.3, #322)", () => {
	it("a function body embedding a bigint-valued insert declares without crashing recordBodyWithGuard's stableJson determinism check", () => {
		expect(() =>
			defineFunction(
				app,
				"record_metric_amount",
				{ returns: metrics },
				(ctx) => {
					ctx.return(insert(metrics).values({ amount: 1n }).returning());
				},
			),
		).not.toThrow();
	});

	it("a function body embedding a structured-interval-valued insert declares without crashing", () => {
		expect(() =>
			defineFunction(
				app,
				"record_metric_duration",
				{ returns: metrics },
				(ctx) => {
					ctx.return(
						insert(metrics)
							.values({
								amount: 1n,
								duration: {
									years: 0,
									months: 1,
									days: 0,
									hours: 0,
									minutes: 0,
									seconds: 0,
									microseconds: 0,
								},
							})
							.returning(),
					);
				},
			),
		).not.toThrow();
	});

	it("a function body embedding an array-valued insert declares without crashing", () => {
		expect(() =>
			defineFunction(app, "record_metric_tags", { returns: metrics }, (ctx) => {
				ctx.return(
					insert(metrics)
						.values({ amount: 1n, tags: ["a", "b"] })
						.returning(),
				);
			}),
		).not.toThrow();
	});
});

import {
	bigint,
	count,
	cumeDist,
	denseRank,
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
	sum,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { SelectResult } from "../../src/types/select-result";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	// bigint({mode:"number"}) mirrors select-result.test.ts's own
	// min/max precedent -- proves a value function's origin brand
	// (not just its family) survives over(), the same way min/max's
	// Aggregated<TExpr> already does.
	amount: bigint({ mode: "number" }),
	status: text(),
});

describe("window function result types (task 4.1)", () => {
	it("rowNumber/rank/denseRank read as bigint | null -- ReadAs survives over()'s union-parameter design", () => {
		const rowNum = over(rowNumber(), {});
		const rnk = over(rank(), {});
		const denseRnk = over(denseRank(), {});
		type Proj = SelectResult<{
			readonly rowNum: typeof rowNum;
			readonly rnk: typeof rnk;
			readonly denseRnk: typeof denseRnk;
		}>;
		// A strict structural check, not a one-directional `extends`:
		// `toEqualTypeOf` fails just as loudly if the brand degraded to a
		// WIDER type (e.g. the plain numeric family union, were the brand
		// lost) as it would for a narrower one -- its own built-in negative
		// control, the same property a hand-written `extends string`
		// contrast would otherwise have to prove separately.
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly rowNum: bigint | null;
			readonly rnk: bigint | null;
			readonly denseRnk: bigint | null;
		}>();
	});

	it("ntile/percentRank/cumeDist need no brand -- the numeric family's widest honest type, same as sum/avg", () => {
		const bucket = over(ntile(4), {});
		const pct = over(percentRank(), {});
		const cume = over(cumeDist(), {});
		type Proj = SelectResult<{
			readonly bucket: typeof bucket;
			readonly pct: typeof pct;
			readonly cume: typeof cume;
		}>;
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly bucket: number | bigint | string | null;
			readonly pct: number | bigint | string | null;
			readonly cume: number | bigint | string | null;
		}>();
	});

	it("lag/lead/firstValue/lastValue/nthValue keep the operand's own declared type", () => {
		const lagged = over(lag(posts.amount), {});
		const led = over(lead(posts.status), {});
		const first = over(firstValue(posts.amount), {});
		const last = over(lastValue(posts.amount), {});
		const nth = over(nthValue(posts.amount, 2), {});
		type Proj = SelectResult<{
			readonly lagged: typeof lagged;
			readonly led: typeof led;
			readonly first: typeof first;
			readonly last: typeof last;
			readonly nth: typeof nth;
		}>;
		// posts.amount is bigint({mode:"number"}) -- the declared read type,
		// not the numeric family's wide union; posts.status is a plain text
		// column.
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly lagged: number | null;
			readonly led: string | null;
			readonly first: number | null;
			readonly last: number | null;
			readonly nth: number | null;
		}>();
	});

	it("a windowed aggregate keeps the aggregate's own mapping (count stays bigint, sum stays the wide union)", () => {
		const windowedCount = over(count(), {});
		const windowedSum = over(sum(posts.amount), {});
		type Proj = SelectResult<{
			readonly windowedCount: typeof windowedCount;
			readonly windowedSum: typeof windowedSum;
		}>;
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly windowedCount: bigint | null;
			readonly windowedSum: number | bigint | string | null;
		}>();
	});
});

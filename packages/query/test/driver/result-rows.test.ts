import { describe, expect, it } from "vitest";
import type { QueryResultLike } from "../../src/driver/result-rows";
import { lastRows } from "../../src/driver/result-rows";

describe("lastRows (task 1.6, #892)", () => {
	it.each<[string, unknown, ReadonlyArray<unknown>]>([
		[
			"a single Result (the ordinary, single-command case)",
			{ rows: [{ a: 1 }] },
			[{ a: 1 }],
		],
		[
			"an array of two Results (two select commands) -- the second's rows",
			[{ rows: [{ a: 1 }] }, { rows: [{ b: 2 }] }],
			[{ b: 2 }],
		],
		[
			"an array of two Results shaped like our own SETUP_SESSION_SQL (both rows: [])",
			[{ rows: [] }, { rows: [] }],
			[],
		],
		[
			"an array of two Results (DDL then select) -- the select's rows",
			[{ rows: [] }, { rows: [{ a: 1 }] }],
			[{ a: 1 }],
		],
		[
			"an array of two Results (select then a SET, the last one rows: []) -- [], never undefined",
			[{ rows: [{ a: 1 }] }, { rows: [] }],
			[],
		],
		[
			"a single Result shaped like a comment-only/empty text (rows: [])",
			{ rows: [] },
			[],
		],
	])("%s", (_label, input, expected) => {
		expect(lastRows(input as never)).toEqual(expected);
	});

	it("a zero-length array is an internal-invariant failure, not a user-reachable path (486/R6 -- measured unreachable through the sql escape hatch)", () => {
		expect(() => lastRows([] as never)).toThrow(
			/internal invariant failure, not a user-reachable path -- file an issue/,
		);
	});

	it("never keys off `rows === undefined` -- a hand-built shape no real driver produces, since `Array.isArray` alone decides the multi-command path", () => {
		// A single Result whose own `rows` happens to be missing (a shape no
		// real driver produces, built by hand to prove the point) must still
		// take the single-result path -- there is no fold to try since
		// `Array.isArray` is false, so this is `.rows` read straight through,
		// not defaulted or detected as multi-command.
		const singleResultMissingRows = {} as QueryResultLike;
		expect(lastRows(singleResultMissingRows)).toBeUndefined();
	});
});

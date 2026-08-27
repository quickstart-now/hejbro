import { describe, expect, it } from "vitest";
import { parseArrayText } from "../../src/types/array-text";

describe("parseArrayText", () => {
	it("parses quoted, escaped, and NULL elements; rejects unparsable text whole", () => {
		expect(parseArrayText("{}")).toEqual([]);
		expect(parseArrayText("{1,2,3}")).toEqual(["1", "2", "3"]);
		expect(parseArrayText('{"a,b","c}d"}')).toEqual(["a,b", "c}d"]);
		expect(parseArrayText('{"say \\"hi\\"","back\\\\slash"}')).toEqual([
			'say "hi"',
			"back\\slash",
		]);
		expect(parseArrayText("{NULL,1,NULL}")).toEqual([null, "1", null]);
		expect(parseArrayText('{"NULL"}')).toEqual(["NULL"]);
		// quoted elements may contain whitespace (interval[]'s own text does) --
		// only the reserved characters (delimiter, braces, quote, backslash)
		// force quoting, never whitespace on its own.
		expect(parseArrayText('{"1 day","2 days"}')).toEqual(["1 day", "2 days"]);
		// a quoted empty string is a real array_out output (e.g. text[]'s own
		// '' element) -- distinct from the empty *array* ("{}").
		expect(parseArrayText('{""}')).toEqual([""]);

		// `reasonPattern` pins down *which* internal guard fired, not just
		// that some guard fired -- a weaker `code`-only assertion can't tell
		// "the intended guard rejected this" apart from "a different guard
		// incidentally rejected this for the wrong reason" (planner review,
		// batch A rework: this is what let mutations IM-2/M6 survive).
		const rejects = (
			raw: string,
			code: string,
			reasonPattern: RegExp | string,
		) => {
			try {
				parseArrayText(raw);
				expect.unreachable(
					`parseArrayText(${JSON.stringify(raw)}) should have thrown`,
				);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect(error).toHaveProperty("code", code);
				expect((error as Error).message).toMatch(/Next:/);
				expect((error as Error).message).toMatch(reasonPattern);
			}
		};

		rejects("1,2,3}", "unparsable-array-text", "missing opening");
		// the opening-brace guard alone (no other guard incidentally catches
		// this one): without it this text would silently parse as the empty
		// array instead of throwing (planner review, batch A rework M6).
		rejects("1}", "unparsable-array-text", "missing opening");
		rejects(
			'{"unterminated',
			"unparsable-array-text",
			"unterminated quoted element",
		);
		rejects(
			"{1,2,3}trailing",
			"unparsable-array-text",
			"trailing content after the closing",
		);
		rejects("{1,,3}", "unparsable-array-text", "expected an element at index");
		// out of scope by design (design.md Non-Goals: one level of nesting
		// only) -- rejected whole, never partially parsed into e.g. ["{1", "2}"].
		// The empty-element guard is what actually fires here (the same one
		// "{1,,3}" hits) -- pinning the reason is what stops a mutation that
		// merely widens the unquoted-element charset from surviving by
		// having the *trailing-content* guard catch it instead for the
		// wrong reason (planner review, batch A rework IM-2).
		rejects(
			"{{1,2},{3,4}}",
			"unparsable-array-text",
			"expected an element at index",
		);
		// a dimension-prefixed literal ("[0:1]={1,2}") is also out of scope --
		// the leading "[" is never a valid array-literal start.
		rejects("[0:1]={1,2}", "unparsable-array-text", "missing opening");
		// truncated text with no closing brace at all -- a shape array_out
		// never emits, but one a truncated wire/storage read genuinely can
		// produce. Without this guard the parser would silently return a
		// *partial* array (planner review, batch B condition M14) instead of
		// rejecting the whole text, exactly what 1.1's own contract forbids.
		rejects('{"a"', "unparsable-array-text", /expected "," or "\}"/);
	});
});

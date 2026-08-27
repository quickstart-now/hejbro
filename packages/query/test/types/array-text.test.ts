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

		const rejects = (raw: string, code: string) => {
			try {
				parseArrayText(raw);
				expect.unreachable(
					`parseArrayText(${JSON.stringify(raw)}) should have thrown`,
				);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect(error).toHaveProperty("code", code);
				expect((error as Error).message).toMatch(/Next:/);
			}
		};

		rejects("1,2,3}", "unparsable-array-text");
		rejects('{"unterminated', "unparsable-array-text");
		rejects("{1,2,3}trailing", "unparsable-array-text");
		rejects("{1,,3}", "unparsable-array-text");
		// out of scope by design (design.md Non-Goals: one level of nesting
		// only) -- rejected whole, never partially parsed into e.g. ["{1", "2}"].
		rejects("{{1,2},{3,4}}", "unparsable-array-text");
		// a dimension-prefixed literal ("[0:1]={1,2}") is also out of scope --
		// the leading "[" is never a valid array-literal start.
		rejects("[0:1]={1,2}", "unparsable-array-text");
	});
});

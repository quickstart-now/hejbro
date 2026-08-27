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
	});
});

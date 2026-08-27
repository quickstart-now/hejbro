import { describe, expect, it } from "vitest";
import { serializeArrayLiteral } from "../../src/types/array-literal-write";
import type { TypeNode } from "../../src/types/type-node";

const TEXT: TypeNode = { typeName: "text" };
const BIGINT: TypeNode = { typeName: "bigint" };
const BOOLEAN: TypeNode = { typeName: "boolean" };
const TIMESTAMPTZ: TypeNode = { typeName: "timestamptz" };
const INTERVAL: TypeNode = { typeName: "interval" };
const JSONB: TypeNode = { typeName: "jsonb" };

describe("serializeArrayLiteral (#322 task 2.3 -- canonical Postgres array literal text writer)", () => {
	it("renders an empty array as {}", () => {
		expect(serializeArrayLiteral([], TEXT)).toBe("{}");
	});

	it("renders bare (unquoted) numeric/boolean elements", () => {
		expect(serializeArrayLiteral([1n, 2n, 3n], BIGINT)).toBe("{1,2,3}");
		expect(serializeArrayLiteral([true, false], BOOLEAN)).toBe("{t,f}");
	});

	it("quotes text elements only when their own text needs it (comma, brace, quote, backslash, whitespace)", () => {
		expect(serializeArrayLiteral(["hello", "world"], TEXT)).toBe(
			"{hello,world}",
		);
		expect(serializeArrayLiteral(["a,b"], TEXT)).toBe('{"a,b"}');
		expect(serializeArrayLiteral(["{braced}"], TEXT)).toBe('{"{braced}"}');
		expect(serializeArrayLiteral(['say "hi"'], TEXT)).toBe('{"say \\"hi\\""}');
		expect(serializeArrayLiteral(["back\\slash"], TEXT)).toBe(
			'{"back\\\\slash"}',
		);
		expect(serializeArrayLiteral(["has space"], TEXT)).toBe('{"has space"}');
	});

	it('distinguishes a literal string "NULL" (quoted) from an actual null element (bare NULL)', () => {
		expect(serializeArrayLiteral(["NULL"], TEXT)).toBe('{"NULL"}');
		expect(serializeArrayLiteral([null], TEXT)).toBe("{NULL}");
		// case-insensitive: Postgres's own array-in parser treats any-case
		// "null" as the SQL null token, so any-case text needs the same
		// quoting to survive as a literal string.
		expect(serializeArrayLiteral(["null"], TEXT)).toBe('{"null"}');
		expect(serializeArrayLiteral(["Null"], TEXT)).toBe('{"Null"}');
	});

	it("quotes an empty string element (indistinguishable from no text otherwise)", () => {
		expect(serializeArrayLiteral([""], TEXT)).toBe('{""}');
	});

	it("mixes null and non-null elements in one array without confusing the two", () => {
		expect(serializeArrayLiteral(["a", null, "b"], TEXT)).toBe("{a,NULL,b}");
	});

	it("serializes interval elements through the shared serializeInterval (always-full grammar)", () => {
		const zeroInterval = {
			years: 0,
			months: 1,
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
			microseconds: 0,
		};
		expect(serializeArrayLiteral([zeroInterval], INTERVAL)).toBe(
			'{"0 years 1 mons 0 days 00:00:00.000000"}',
		);
	});

	it("serializes datetime elements as ISO text (unquoted -- ISO text has no comma/brace/quote/backslash/whitespace)", () => {
		expect(
			serializeArrayLiteral(
				[new Date("2020-01-01T00:00:00.000Z")],
				TIMESTAMPTZ,
			),
		).toBe("{2020-01-01T00:00:00.000Z}");
	});

	it("rejects an unsupported element family (json/bytea/net/nested array) with ambiguous-literal, never a partial array", () => {
		expect(() => serializeArrayLiteral([{ a: 1 }], JSONB)).toThrowError(
			expect.objectContaining({ code: "ambiguous-literal" }),
		);
	});
});

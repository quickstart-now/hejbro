import { describe, expect, it } from "vitest";
import { liftColumnValue } from "../../src/query/column-value";
import type { TypeNode } from "../../src/types/type-node";

const BIGINT: TypeNode = { typeName: "bigint" };
const NUMERIC: TypeNode = { typeName: "numeric", precision: null, scale: null };
const INTERVAL: TypeNode = { typeName: "interval" };
const TEXT: TypeNode = { typeName: "text" };
const BIGINT_ARRAY: TypeNode = { typeName: "array", element: BIGINT };
const TEXT_ARRAY: TypeNode = { typeName: "array", element: TEXT };
const INTERVAL_ARRAY: TypeNode = { typeName: "array", element: INTERVAL };
const JSONB_ARRAY: TypeNode = {
	typeName: "array",
	element: { typeName: "jsonb" },
};

const ZERO_INTERVAL = {
	years: 0,
	months: 0,
	days: 0,
	hours: 0,
	minutes: 0,
	seconds: 0,
	microseconds: 0,
};

describe("liftColumnValue (#322 task 2.3 -- the sole constructor of bigint/interval/array literal kinds)", () => {
	it("lifts a raw JS bigint to its own literal kind, decimal text, never pre-stringified elsewhere", () => {
		expect(liftColumnValue(9007199254740993n, BIGINT)).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "bigint", text: "9007199254740993" },
		});
	});

	it("lifts a structured IntervalValue through the shared serializeInterval", () => {
		expect(liftColumnValue({ ...ZERO_INTERVAL, months: 2 }, INTERVAL)).toEqual({
			nodeKind: "literal",
			literal: {
				literalKind: "interval",
				text: "0 years 2 mons 0 days 00:00:00.000000",
			},
		});
	});

	it("lifts a JS array of the declared element type through serializeArrayLiteral", () => {
		expect(liftColumnValue([1n, 2n, null], BIGINT_ARRAY)).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "array", text: "{1,2,NULL}" },
		});
		expect(liftColumnValue(["a", "b"], TEXT_ARRAY)).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "array", text: "{a,b}" },
		});
	});

	it("lifts an array of interval elements (approved element scope includes interval)", () => {
		expect(
			liftColumnValue([{ ...ZERO_INTERVAL, days: 3 }], INTERVAL_ARRAY),
		).toEqual({
			nodeKind: "literal",
			literal: {
				literalKind: "array",
				text: '{"0 years 0 mons 3 days 00:00:00.000000"}',
			},
		});
	});

	it("rejects an array whose declared element type has no write path yet (jsonb[]), same ambiguous-literal a raw scalar of that shape already gets", () => {
		expect(() => liftColumnValue([{ a: 1 }], JSONB_ARRAY)).toThrowError(
			expect.objectContaining({ code: "ambiguous-literal" }),
		);
	});

	it("delegates every ordinary scalar to the unchanged liftOperand -- string/number/boolean/Date/null all behave exactly as before #322", () => {
		expect(liftColumnValue("hello", TEXT)).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "string", value: "hello" },
		});
		expect(liftColumnValue(42, NUMERIC)).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "number", value: 42 },
		});
		expect(liftColumnValue(null, TEXT)).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "null" },
		});
	});

	it("passes an Expr through unchanged (sql`` escape hatch, unaffected by this function's own dispatch)", () => {
		const expr = {
			family: "unknown" as const,
			exprNode: { nodeKind: "rawSql" as const, sql: "now()" },
		};
		expect(liftColumnValue(expr, TEXT)).toBe(expr.exprNode);
	});
});

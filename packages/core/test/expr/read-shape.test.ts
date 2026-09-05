import { describe, expect, it } from "vitest";
import type { BuilderFunctionName, ExprNode, ReadShape } from "../../src/index";
import {
	avg,
	BUILDER_READ_SHAPES,
	columnRef,
	count,
	cumeDist,
	denseRank,
	firstValue,
	lag,
	lastValue,
	lead,
	max,
	min,
	nthValue,
	ntile,
	percentRank,
	rank,
	rowNumber,
	sum,
} from "../../src/index";

const placeholder = columnRef("app", "t", "c", { typeName: "bigint" });

/** The function name a plain aggregate call carries -- `built.exprNode` is a `FunctionCallNode` by construction for every one of these five. */
const functionNameOfAggregate = (built: {
	readonly exprNode: ExprNode;
}): string => {
	const node = built.exprNode;
	if (node.nodeKind !== "functionCall") {
		throw new Error(`expected a functionCall node, got ${node.nodeKind}`);
	}
	return node.functionName;
};

/** The function name a bare window-only call carries -- `windowFn` is already a `FunctionCallNode`, no narrowing needed. */
const functionNameOfWindowOnly = (built: {
	readonly windowFn: { readonly functionName: string };
}): string => built.windowFn.functionName;

/**
 * Every aggregate/window constructor the public barrel exports (D110 --
 * the closure claim's own input table), invoked with a placeholder
 * argument where one is required, paired with the function name it
 * actually produced -- the string-level half of the closure a type
 * cannot see (#452 task 1.1).
 */
const constructorFunctionNames: ReadonlyArray<readonly [string, string]> = [
	["count", functionNameOfAggregate(count())],
	["min", functionNameOfAggregate(min(placeholder))],
	["max", functionNameOfAggregate(max(placeholder))],
	["sum", functionNameOfAggregate(sum(placeholder))],
	["avg", functionNameOfAggregate(avg(placeholder))],
	["rowNumber", functionNameOfWindowOnly(rowNumber())],
	["rank", functionNameOfWindowOnly(rank())],
	["denseRank", functionNameOfWindowOnly(denseRank())],
	["percentRank", functionNameOfWindowOnly(percentRank())],
	["cumeDist", functionNameOfWindowOnly(cumeDist())],
	["ntile", functionNameOfWindowOnly(ntile(4))],
	["lag", functionNameOfWindowOnly(lag(placeholder))],
	["lead", functionNameOfWindowOnly(lead(placeholder))],
	["firstValue", functionNameOfWindowOnly(firstValue(placeholder))],
	["lastValue", functionNameOfWindowOnly(lastValue(placeholder))],
	["nthValue", functionNameOfWindowOnly(nthValue(placeholder, 1))],
];

describe("BUILDER_READ_SHAPES closure (#452 task 1.1)", () => {
	it.each(constructorFunctionNames)(
		"%s's own function name has a row in BUILDER_READ_SHAPES",
		(_label, functionName) => {
			expect(Object.hasOwn(BUILDER_READ_SHAPES, functionName)).toBe(true);
		},
	);

	it("is closed over BuilderFunctionName: a table missing one row fails satisfies", () => {
		const incomplete = {
			count: "int8",
			// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57).
			row_number: "int8",
			rank: "int8",
			// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57).
			dense_rank: "int8",
			min: "argument",
			max: "argument",
			lag: "argument",
			lead: "argument",
			// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57).
			first_value: "argument",
			// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57).
			last_value: "argument",
			// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57).
			nth_value: "argument",
			avg: "own",
			// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57).
			percent_rank: "own",
			// biome-ignore lint/style/useNamingConvention: Postgres's own function name (D57).
			cume_dist: "own",
			ntile: "own",
			// @ts-expect-error omits "sum" -- a Record<BuilderFunctionName, ReadShape>
			// missing any one member fails `satisfies`, the exact type-level
			// guarantee BUILDER_READ_SHAPES's own declaration relies on.
		} satisfies Record<BuilderFunctionName, ReadShape>;
		expect(incomplete).toBeDefined();
	});
});

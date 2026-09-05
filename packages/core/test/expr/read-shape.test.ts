import { describe, expect, it } from "vitest";
import * as aggregateModule from "../../src/expr/aggregate";
import * as windowModule from "../../src/expr/window";
import type { BuilderFunctionName, ExprNode, ReadShape } from "../../src/index";
import * as coreBarrel from "../../src/index";
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

/**
 * Runtime exports these two modules carry that are NOT themselves an
 * aggregate/window function constructor, excluded with a reason rather
 * than silently: `over()` attaches a window spec to an existing
 * aggregate or window-only call, so it never produces a function-call
 * node under its own name and has no row of its own in
 * `BUILDER_READ_SHAPES`.
 */
const NON_CONSTRUCTOR_EXPORTS: ReadonlySet<string> = new Set(["over"]);

/** Every function-valued runtime export of `module`, minus {@link NON_CONSTRUCTOR_EXPORTS} -- a type-only export (e.g. `Aggregated`) or a non-function value (e.g. `readAsBrand`, a symbol) never appears here. */
const constructorExportNames = (
	module: Record<string, unknown>,
): ReadonlyArray<string> =>
	Object.entries(module)
		.filter(
			([name, value]) =>
				typeof value === "function" && !NON_CONSTRUCTOR_EXPORTS.has(name),
		)
		.map(([name]) => name);

/**
 * Every aggregate/window constructor the public surface exports, derived
 * from the two defining modules (`expr/aggregate.ts`, `expr/window.ts`)
 * rather than hand-copied (#452 task 1.1 rework) -- a constructor added
 * to either module without a matching entry in
 * {@link constructorFunctionNames} below fails the set-equality
 * assertion this file makes, closing the gap a hand-written list alone
 * could not: a 17th constructor added to `window.ts` used to pass this
 * suite silently before this derivation existed.
 */
const derivedConstructorNames: ReadonlySet<string> = new Set([
	...constructorExportNames(aggregateModule),
	...constructorExportNames(windowModule),
]);

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
 * The 16 constructors {@link derivedConstructorNames} names, each
 * invoked with a placeholder argument where one is required, paired
 * with the function name it actually produced -- the string-level half
 * of the closure a type cannot see (#452 task 1.1). Arity differs per
 * constructor, so this call table stays hand-written; the "covers
 * exactly the public surface" claim (D110) is what the first test below
 * checks against {@link derivedConstructorNames}, not this table's own
 * length.
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
	it("the hand-written call table covers exactly the constructors expr/aggregate.ts and expr/window.ts export (D110)", () => {
		const handWrittenLabels = new Set(
			constructorFunctionNames.map(([label]) => label),
		);
		expect([...handWrittenLabels].sort()).toEqual(
			[...derivedConstructorNames].sort(),
		);
	});

	it("every derived constructor is reachable from the public barrel (src/index.ts)", () => {
		const allReachable = [...derivedConstructorNames].every(
			(name) =>
				typeof (coreBarrel as Record<string, unknown>)[name] === "function",
		);
		expect(allReachable).toBe(true);
	});

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

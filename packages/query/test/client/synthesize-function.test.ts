import { describe, expect, it } from "vitest";
import type { ContractFunctionMeta } from "../../src/client/contract-types";
import { synthesizeFunction } from "../../src/client/synthesize-function";

const TOTAL_POSTS_META: ContractFunctionMeta = {
	schema: "app",
	name: "total_posts",
	args: [
		{
			key: "minWeight",
			sqlName: "min_weight",
			typeNode: { typeName: "bigint" },
			mode: "number",
			notNullElements: false,
		},
	],
	returns: { kind: "scalar", typeNode: { typeName: "bigint" }, mode: "bigint" },
};

const POST_BY_ID_META: ContractFunctionMeta = {
	schema: "app",
	name: "post_by_id",
	args: [
		{
			key: "postId",
			sqlName: "post_id",
			typeNode: { typeName: "uuid" },
			mode: null,
			notNullElements: false,
		},
	],
	returns: { kind: "table", schema: "app", name: "posts" },
};

describe("synthesizeFunction (#587/G3)", () => {
	it("builds a real FunctionDeclaration, keeping each argument's key beside its SQL name", () => {
		const fn = synthesizeFunction(TOTAL_POSTS_META);

		expect(fn.declarationKind).toBe("function");
		expect(fn.schemaName).toBe("app");
		expect(fn.functionName).toBe("total_posts");
		expect(fn.args).toEqual([
			{
				key: "minWeight",
				argName: "min_weight",
				typeNode: { typeName: "bigint" },
				mode: "number",
				notNullElements: false,
			},
		]);
		expect(fn.returns).toEqual({
			returnsKind: "scalar",
			typeNode: { typeName: "bigint" },
			mode: "bigint",
		});
	});

	it("a table return synthesizes to the setofTable shape createFnApi's dispatchCall matches on", () => {
		const fn = synthesizeFunction(POST_BY_ID_META);

		expect(fn.returns).toEqual({
			returnsKind: "setofTable",
			schemaName: "app",
			tableName: "posts",
		});
	});
});

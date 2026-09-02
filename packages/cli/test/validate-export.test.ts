import { describe, expect, it } from "vitest";
import { validateExport } from "../src/vendor/validate-export";

const FORMAT_TEXT = '{"descriptionFormat":1,"snapshotFormat":8}';

const SNAPSHOT = '{"formatVersion":8,"dialect":"postgres","objects":{}}';

describe("validateExport", () => {
	it("keeps a function's carried facts", () => {
		const schemaText = JSON.stringify({
			tables: [],
			functions: [
				{
					schemaName: "app",
					functionName: "total_posts",
					exportName: "totalPosts",
					args: [
						{ key: "postId", sqlName: "post_id" },
						{ key: "createdAt", sqlName: "created_at" },
					],
					returns: { kind: "scalar" },
				},
				{
					schemaName: "app",
					functionName: "posts_touch",
					exportName: null,
					args: [],
					returns: null,
				},
			],
			roles: [],
			snapshot: JSON.parse(SNAPSHOT),
		});

		const validated = validateExport(FORMAT_TEXT, schemaText);

		expect(validated.payload.functions).toEqual([
			{
				schemaName: "app",
				functionName: "total_posts",
				exportName: "totalPosts",
				args: [
					{ key: "postId", sqlName: "post_id" },
					{ key: "createdAt", sqlName: "created_at" },
				],
				returns: { kind: "scalar" },
			},
			{
				schemaName: "app",
				functionName: "posts_touch",
				exportName: null,
				args: [],
				returns: null,
			},
		]);
	});
});

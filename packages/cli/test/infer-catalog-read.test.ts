import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import {
	INFER_CATALOG_QUERIES,
	readInferenceCatalog,
} from "../src/infer/catalog";

type InferQueryKey = keyof typeof INFER_CATALOG_QUERIES;

const FIXTURE_ROWS: {
	readonly [K in InferQueryKey]: ReadonlyArray<DriverRow>;
} = {
	columnDetails: [
		{
			schema: "app",
			table: "posts",
			name: "id",
			position: 1,
			identityKind: "a",
			generatedKind: "",
		},
	],
	foreignKeyDetails: [
		{
			schema: "app",
			table: "comments",
			name: "comments_post_id_fkey",
			targetSchema: "app",
			targetTable: "posts",
			targetColumns: ["id"],
			onDelete: "c",
			onUpdate: "a",
		},
	],
	checkExpressions: [
		{
			schema: "app",
			table: "posts",
			name: "posts_title_length",
			expression: "(char_length(title) > 0)",
		},
	],
	indexDetails: [
		{
			schema: "app",
			table: "posts",
			name: "posts_slug_idx",
			isUnique: true,
			method: "btree",
			predicate: null,
			columns: [
				{
					text: "slug",
					column: "slug",
					opclass: "text_ops",
					opclassIsDefault: true,
					descending: false,
					nullsFirst: false,
				},
			],
		},
		{
			schema: "app",
			table: "members",
			name: "members_email_lower_idx",
			isUnique: false,
			method: "btree",
			predicate: null,
			columns: [
				{
					text: "lower(email)",
					column: null,
					opclass: "text_ops",
					opclassIsDefault: true,
					descending: false,
					nullsFirst: false,
				},
			],
		},
		{
			schema: "app",
			table: "task_schedules",
			name: "task_schedules_due_at_idx",
			isUnique: false,
			method: "btree",
			predicate: null,
			columns: [
				{
					text: "due_at",
					column: "due_at",
					opclass: "timestamptz_ops",
					opclassIsDefault: true,
					descending: true,
					nullsFirst: true,
				},
			],
		},
		{
			schema: "app",
			table: "tasks",
			name: "tasks_metadata_gin_idx",
			isUnique: false,
			method: "gin",
			predicate: null,
			columns: [
				{
					text: "metadata",
					column: "metadata",
					opclass: "jsonb_path_ops",
					opclassIsDefault: false,
					descending: false,
					nullsFirst: false,
				},
			],
		},
		{
			schema: "app",
			table: "tasks",
			name: "tasks_project_id_title_idx",
			isUnique: true,
			method: "btree",
			predicate: "(status <> 'done'::text)",
			columns: [
				{
					text: "project_id",
					column: "project_id",
					opclass: "uuid_ops",
					opclassIsDefault: true,
					descending: false,
					nullsFirst: false,
				},
				{
					text: "title",
					column: "title",
					opclass: "text_ops",
					opclassIsDefault: true,
					descending: false,
					nullsFirst: false,
				},
			],
		},
	],
	enumLabels: [{ schema: "app", name: "status", label: "draft", sortOrder: 1 }],
	identitySequenceOptions: [
		{
			schema: "app",
			table: "posts",
			column: "id",
			startValue: "1",
			increment: "1",
			minValue: "1",
			maxValue: "9223372036854775807",
			cache: "1",
			cycle: false,
		},
	],
};

/** A fake single-connection session that answers each query by matching its exact text against {@link INFER_CATALOG_QUERIES} -- order-independent, since `readInferenceCatalog` is free to run its reads concurrently in any order. */
const makeFakeSession = (): {
	readonly session: DriverSession;
	readonly calls: CompileResult[];
} => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			const entry = (
				Object.entries(INFER_CATALOG_QUERIES) as ReadonlyArray<
					[InferQueryKey, string]
				>
			).find(([, sql]) => sql === compiled.sql);
			if (entry === undefined) {
				throw new Error(
					`unexpected query sent to readInferenceCatalog: ${compiled.sql}`,
				);
			}
			return FIXTURE_ROWS[entry[0]];
		},
	};
	return { session, calls };
};

describe("readInferenceCatalog / 1.2", () => {
	it("issues only parameterless read-only statements", async () => {
		const { session, calls } = makeFakeSession();

		await readInferenceCatalog(session);

		expect(calls).toHaveLength(Object.keys(INFER_CATALOG_QUERIES).length);
		expect(
			calls.every(
				(call) =>
					call.params.length === 0 && /^select\b/i.test(call.sql.trim()),
			),
		).toBe(true);
	});

	it("returns the detail rows parsed and typed", async () => {
		const { session } = makeFakeSession();

		const catalog = await readInferenceCatalog(session);

		expect(catalog).toEqual(FIXTURE_ROWS);
	});
});

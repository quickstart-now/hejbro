import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { CHECK_CATALOG_QUERIES, readCatalog } from "../src/check/catalog";

type CatalogQueryKey = keyof typeof CHECK_CATALOG_QUERIES;

const FIXTURE_ROWS: {
	readonly [K in CatalogQueryKey]: ReadonlyArray<DriverRow>;
} = {
	schemas: [{ schema: "app" }],
	tables: [{ schema: "app", table: "posts", rls: true }],
	columns: [
		{
			schema: "app",
			table: "posts",
			name: "id",
			notNull: true,
			catalogType: "integer",
			baseTypeKind: null,
			baseTypeSchema: null,
			baseTypeName: null,
			catalogDefault: null,
		},
	],
	constraints: [
		{
			schema: "app",
			table: "posts",
			name: "posts_pkey",
			type: "p",
			columns: ["id"],
		},
	],
	indexes: [{ schema: "app", table: "posts", name: "posts_slug_idx" }],
	enums: [{ schema: "app", name: "status" }],
	sequences: [{ schema: "app", name: "posts_id_seq" }],
	functions: [{ schema: "app", name: "touch_updated_at" }],
	views: [{ schema: "app", name: "posts_view" }],
	policies: [{ schema: "app", table: "posts", name: "posts_select" }],
	triggers: [{ schema: "app", table: "posts", name: "posts_touch" }],
	tableGrants: [
		{
			schema: "app",
			table: "posts",
			role: "authenticated",
			privilege: "SELECT",
		},
	],
	schemaUsageGrants: [
		{ schema: "app", role: "authenticated", privilege: "USAGE" },
	],
	defaultTableGrants: [
		{ schema: "app", role: "authenticated", privilege: "SELECT" },
	],
};

/** A fake single-connection session that answers each query by matching its exact text against {@link CHECK_CATALOG_QUERIES} -- order-independent, since `readCatalog` is free to run its 14 reads concurrently in any order. */
const makeFakeSession = (): {
	readonly session: DriverSession;
	readonly calls: CompileResult[];
} => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			const entry = (
				Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
					[CatalogQueryKey, string]
				>
			).find(([, sql]) => sql === compiled.sql);
			if (entry === undefined) {
				throw new Error(
					`unexpected query sent to readCatalog: ${compiled.sql}`,
				);
			}
			return FIXTURE_ROWS[entry[0]];
		},
	};
	return { session, calls };
};

describe("readCatalog", () => {
	it("issues only parameterless read-only statements", async () => {
		const { session, calls } = makeFakeSession();

		await readCatalog(session);

		expect(calls).toHaveLength(Object.keys(CHECK_CATALOG_QUERIES).length);
		expect(
			calls.every(
				(call) =>
					call.params.length === 0 && /^select\b/i.test(call.sql.trim()),
			),
		).toBe(true);
	});

	it("returns the catalog rows the comparison needs", async () => {
		const { session } = makeFakeSession();

		const catalog = await readCatalog(session);

		expect(catalog).toEqual(FIXTURE_ROWS);
	});
});

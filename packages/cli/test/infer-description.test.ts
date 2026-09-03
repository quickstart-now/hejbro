import { toSnakeCase } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { InferenceCatalog } from "../src/infer/catalog";
import { describeCatalog } from "../src/infer/description";

const emptyCatalog = (): Catalog => ({
	schemas: [],
	tables: [],
	columns: [],
	constraints: [],
	indexes: [],
	enums: [],
	sequences: [],
	functions: [],
	views: [],
	policies: [],
	triggers: [],
	tableGrants: [],
	schemaUsageGrants: [],
	defaultTableGrants: [],
	extensions: [],
});

const emptyInferenceCatalog = (): InferenceCatalog => ({
	columnDetails: [],
	foreignKeyDetails: [],
	checkExpressions: [],
	indexDetails: [],
	enumLabels: [],
	sequenceOwnership: [],
});

describe("describeCatalog / 1.6", () => {
	it("carries every column the reading found, guessed key included, even one no builder expresses", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "widgets", rls: false }],
			columns: [
				{
					schema: "app",
					table: "widgets",
					name: "id",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "widgets",
					name: "location",
					notNull: false,
					catalogType: "point",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "point",
					catalogDefault: null,
				},
			],
		};
		const inferenceCatalog: InferenceCatalog = {
			...emptyInferenceCatalog(),
			columnDetails: [
				{
					schema: "app",
					table: "widgets",
					name: "id",
					position: 1,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "location",
					position: 2,
					identityKind: "",
					generatedKind: "",
				},
			],
		};

		const description = describeCatalog(catalog, inferenceCatalog);

		const widgets = description.tables.find((t) => t.table === "widgets");
		if (widgets === undefined) {
			throw new Error("expected widgets table description");
		}
		// "point" has no column builder (1.3's own loss case) -- the
		// description still carries it, guessed key and all, because it is
		// built from the catalog reading directly, never from a declaration
		// round trip.
		expect(widgets.columns).toEqual([
			{ sqlName: "id", tsKey: "id" },
			{ sqlName: "location", tsKey: "location" },
		]);
	});

	it("carries the collision suffix for two SQL names folding to the same key, both present", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "widgets", rls: false }],
			columns: [
				{
					schema: "app",
					table: "widgets",
					name: "user_id",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "widgets",
					name: "USER_ID",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
			],
		};
		const inferenceCatalog: InferenceCatalog = {
			...emptyInferenceCatalog(),
			columnDetails: [
				{
					schema: "app",
					table: "widgets",
					name: "user_id",
					position: 1,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "USER_ID",
					position: 2,
					identityKind: "",
					generatedKind: "",
				},
			],
		};

		const description = describeCatalog(catalog, inferenceCatalog);

		const widgets = description.tables.find((t) => t.table === "widgets");
		if (widgets === undefined) {
			throw new Error("expected widgets table description");
		}
		expect(widgets.columns).toEqual([
			{ sqlName: "user_id", tsKey: "userId" },
			{ sqlName: "USER_ID", tsKey: "userId2" },
		]);
	});

	/**
	 * D106 R3-B2: a third, ordinary column `user_id2` has its own distinct
	 * base key `userId2` -- exactly the suffix the `user_id`/`USER_ID`
	 * collision would otherwise hand out next. `user_id2` must keep its
	 * own bare key regardless: `table.ts`'s own exclusion rule
	 * (`isNameRoundTrippable`, reachable end-to-end only through a live
	 * catalog read) is exactly
	 * `toSnakeCase(tsKey) === sqlName`, so asserting that round trip here
	 * is this suite's own way of pinning "never mis-reported as
	 * undeclarable" without a database.
	 */
	it("keeps an ordinary column's own bare key even when an unrelated collision's suffix would otherwise land on it", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "widgets", rls: false }],
			columns: [
				{
					schema: "app",
					table: "widgets",
					name: "user_id",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "widgets",
					name: "USER_ID",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
				{
					schema: "app",
					table: "widgets",
					name: "user_id2",
					notNull: true,
					catalogType: "uuid",
					baseTypeKind: "b",
					baseTypeSchema: "pg_catalog",
					baseTypeName: "uuid",
					catalogDefault: null,
				},
			],
		};
		const inferenceCatalog: InferenceCatalog = {
			...emptyInferenceCatalog(),
			columnDetails: [
				{
					schema: "app",
					table: "widgets",
					name: "user_id",
					position: 1,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "USER_ID",
					position: 2,
					identityKind: "",
					generatedKind: "",
				},
				{
					schema: "app",
					table: "widgets",
					name: "user_id2",
					position: 3,
					identityKind: "",
					generatedKind: "",
				},
			],
		};

		const description = describeCatalog(catalog, inferenceCatalog);

		const widgets = description.tables.find((t) => t.table === "widgets");
		if (widgets === undefined) {
			throw new Error("expected widgets table description");
		}
		expect(widgets.columns).toEqual([
			{ sqlName: "user_id", tsKey: "userId" },
			{ sqlName: "USER_ID", tsKey: "userId3" },
			{ sqlName: "user_id2", tsKey: "userId2" },
		]);
		const userId2 = widgets.columns.find((c) => c.sqlName === "user_id2");
		if (userId2 === undefined) {
			throw new Error("expected user_id2's own description entry");
		}
		expect(toSnakeCase(userId2.tsKey)).toBe(userId2.sqlName);
	});

	it("carries distinct role names from the grants present", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			tableGrants: [
				{
					schema: "app",
					table: "posts",
					role: "app_writer",
					privilege: "SELECT",
				},
			],
		};

		const description = describeCatalog(catalog, emptyInferenceCatalog());

		expect(description.roleNames).toEqual(["app_writer"]);
	});
});

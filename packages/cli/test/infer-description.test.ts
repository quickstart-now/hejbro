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
	identitySequenceOptions: [],
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

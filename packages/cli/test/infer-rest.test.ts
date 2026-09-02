import { schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { EnumLabelRow, InferenceCatalog } from "../src/infer/catalog";
import {
	inferEnums,
	inferRoleNames,
	notInferredSummary,
	standaloneSequences,
} from "../src/infer/rest";

const emptyInferenceCatalog = (): InferenceCatalog => ({
	columnDetails: [],
	foreignKeyDetails: [],
	checkExpressions: [],
	indexDetails: [],
	enumLabels: [],
	sequenceOwnership: [],
});

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

describe("inferEnums / 1.5", () => {
	it("orders values by enumsortorder, not catalog read order", () => {
		const app = schema("app");
		// Deliberately out of enumsortorder in the row array itself, the way
		// a concurrent, order-agnostic catalog read could return them.
		const labelRows: ReadonlyArray<EnumLabelRow> = [
			{ schema: "app", name: "mood", label: "sad", sortOrder: 2 },
			{ schema: "app", name: "mood", label: "happy", sortOrder: 1 },
		];

		const enums = inferEnums(
			[{ schema: "app", name: "mood" }],
			labelRows,
			() => app,
		);

		expect(enums.declarations).toHaveLength(1);
		expect(enums.declarations[0]?.values).toEqual(["happy", "sad"]);
		expect(enums.byIdentity.get("app.mood")?.values).toEqual(["happy", "sad"]);
	});
});

describe("inferRoleNames / 1.5", () => {
	it("collects distinct role names from every grant kind, sorted", () => {
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
			schemaUsageGrants: [
				{ schema: "app", role: "app_reader", privilege: "USAGE" },
			],
			defaultTableGrants: [
				{ schema: "app", role: "app_writer", privilege: "SELECT" },
			],
		};

		expect(inferRoleNames(catalog)).toEqual(["app_reader", "app_writer"]);
	});
});

describe("notInferredSummary / 1.5", () => {
	it("names exactly the elements the delta enumerates -- function, trigger, view, policy expression, plus grants beyond role name", () => {
		const catalog: Catalog = {
			...emptyCatalog(),
			functions: [{ schema: "app", name: "touch_updated_at" }],
			triggers: [{ schema: "app", table: "posts", name: "posts_touch" }],
			views: [{ schema: "app", name: "open_tasks" }],
			policies: [{ schema: "app", table: "posts", name: "posts_read_all" }],
		};

		const summary = notInferredSummary(catalog);

		expect(summary.functions).toEqual([
			{ schema: "app", name: "touch_updated_at" },
		]);
		expect(summary.triggers).toEqual([
			{ schema: "app", table: "posts", name: "posts_touch" },
		]);
		expect(summary.views).toEqual([{ schema: "app", name: "open_tasks" }]);
		// Policy *expressions* are what's not inferred (existence is read via
		// the shared inventory) -- this reports every policy present, since
		// none of them has its expression inferred.
		expect(summary.policies).toEqual([
			{ schema: "app", table: "posts", name: "posts_read_all" },
		]);
		// "grant beyond its role name" is a blanket rule, not per-instance --
		// there is no per-grant list to name (declaration-inference delta).
		expect(summary.grantsBeyondRoleName).toBe(true);
	});
});

describe("standaloneSequences / 1.5b (CI-G1-R1-10 (D))", () => {
	it("names only the sequence no column owns -- identity- and serial-owned ones are excluded", () => {
		// Three sequences: one an identity column owns (already expressed by
		// that column's own declaration), one a serial column owns (D66:
		// the DSL synthesizes it from serial()/bigserial()/smallserial()),
		// and one no column owns at all -- only the third is a real loss.
		const catalog: Catalog = {
			...emptyCatalog(),
			sequences: [
				{ schema: "app", name: "posts_id_seq" },
				{ schema: "app", name: "legacy_id_seq" },
				{ schema: "app", name: "orphan_seq" },
			],
		};
		const inferenceCatalog: InferenceCatalog = {
			...emptyInferenceCatalog(),
			sequenceOwnership: [
				{
					sequenceSchema: "app",
					sequenceName: "posts_id_seq",
					schema: "app",
					table: "posts",
					column: "id",
					ownership: "i",
					startValue: "1",
					increment: "1",
					minValue: "1",
					maxValue: "9223372036854775807",
					cache: "1",
					cycle: false,
				},
				{
					sequenceSchema: "app",
					sequenceName: "legacy_id_seq",
					schema: "app",
					table: "legacy",
					column: "id",
					ownership: "a",
					startValue: "1",
					increment: "1",
					minValue: "1",
					maxValue: "2147483647",
					cache: "1",
					cycle: false,
				},
			],
		};

		expect(standaloneSequences(catalog, inferenceCatalog)).toEqual([
			{ schema: "app", name: "orphan_seq" },
		]);
	});
});

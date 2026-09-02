import { schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import type { EnumLabelRow } from "../src/infer/catalog";
import {
	inferEnums,
	inferRoleNames,
	notInferredSummary,
	standaloneSequences,
} from "../src/infer/rest";

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

describe("standaloneSequences / 1.5", () => {
	it("names every sequence read, since none has a declaration path (D66: no defineSequence() in the public DSL)", () => {
		// Every sequence hejbro ever *emits* is synthesized from a serial or
		// identity column (D66, engine/generate.ts's own synthesizeSequence
		// Declarations comment) -- there is no way to declare a standalone
		// one, identity-owned or not. This module does not attempt to tell
		// the two apart (open question, reported to ci-planner): it names
		// every sequence the shared inventory read, full stop.
		const catalog: Catalog = {
			...emptyCatalog(),
			sequences: [{ schema: "app", name: "posts_id_seq" }],
		};

		expect(standaloneSequences(catalog)).toEqual([
			{ schema: "app", name: "posts_id_seq" },
		]);
	});
});

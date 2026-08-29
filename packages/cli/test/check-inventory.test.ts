import type { HejbroInput, Snapshot } from "@hejbro/core";
import {
	emptySnapshot,
	generateMigration,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import { buildInventory } from "../src/check/inventory";

const app = schema("app");

const buildTestSnapshot = (
	declarations: ReadonlyArray<HejbroInput>,
): Snapshot =>
	generateMigration({ declarations, previousSnapshot: emptySnapshot }).snapshot;

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

describe("buildInventory / 5.1 unmanaged tables", () => {
	it("lists an unmanaged table and still exits zero", () => {
		// "still exits zero" is enforced by construction, not by this test:
		// buildInventory never produces a Finding (no code, no HejbroError --
		// 2.1's own code set has no inventory entry), so nothing it returns
		// can ever affect renderCheckReport's exit code. check-command.test.ts's
		// "prints the inventory section in the report" test asserts that
		// end-to-end (findings: [], inventory non-empty -> exitCode: 0).
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "posts", rls: false },
				{ schema: "app", table: "legacy_table", rls: false },
			],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.unmanagedTables).toEqual([
			{ schema: "app", table: "legacy_table" },
		]);
	});

	it("does not list a table in a schema no declaration touches", () => {
		// "inside the declared schemas" (spec) -- a table in a schema this
		// project never declares anything in is not this project's business
		// to report at all, managed or not.
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "posts", rls: false },
				{ schema: "other", table: "unrelated", rls: false },
			],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.unmanagedTables).toEqual([]);
	});

	it("does not list a declared table as unmanaged", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.unmanagedTables).toEqual([]);
	});
});

describe("buildInventory / 5.1 extensions", () => {
	it("lists the installed extensions", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
			extensions: [{ name: "pgcrypto" }, { name: "uuid-ossp" }],
		};

		const inventory = buildInventory(snapshot, catalog);

		expect(inventory.extensions).toEqual(["pgcrypto", "uuid-ossp"]);
	});
});

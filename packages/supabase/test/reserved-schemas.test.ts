import {
	emptySnapshot,
	existingTable,
	generateMigration,
	grant,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { reservedSchemaValidator } from "../src/validators/reserved-schemas";

describe("reservedSchemaValidator", () => {
	it("errors when a schema declaration targets a reserved schema", () => {
		const auth = schema("auth");
		const diagnostics = reservedSchemaValidator(emptySnapshot, [auth]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.severity).toBe("error");
		expect(diagnostics[0]?.code).toBe("reserved-schema");
	});

	it("errors when a table declaration targets a reserved schema", () => {
		const storage = schema("storage");
		const objects = table(storage, "custom_objects", { id: uuid() });
		const result = generateMigration({
			declarations: [storage, objects],
			previousSnapshot: emptySnapshot,
			validators: [reservedSchemaValidator],
		});
		expect(result.errors).toHaveLength(2);
		expect(result.errors.map((e) => e.code)).toEqual([
			"reserved-schema",
			"reserved-schema",
		]);
	});

	it("blocks generateMigration end-to-end (error joins result.errors, sql stays empty)", () => {
		const auth = schema("auth");
		const result = generateMigration({
			declarations: [auth],
			previousSnapshot: emptySnapshot,
			validators: [reservedSchemaValidator],
		});
		expect(result.sql).toBe("");
		expect(result.hasChanges).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("reserved-schema");
	});

	it("does not flag a managed schema", () => {
		const app = schema("app");
		expect(reservedSchemaValidator(emptySnapshot, [app])).toEqual([]);
	});

	it("does not flag existingTable references (declaration path only)", () => {
		const authUsers = existingTable("auth", "users", { id: uuid() });
		const app = schema("app");
		const profiles = table(
			app,
			"profiles",
			{ id: uuid().primaryKey() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.id],
						references: { table: authUsers, columns: [authUsers.id] },
					},
				],
			}),
		);
		const result = generateMigration({
			declarations: [app, profiles],
			previousSnapshot: emptySnapshot,
			validators: [reservedSchemaValidator],
		});
		expect(result.errors).toEqual([]);
	});

	it("does not flag a schemaUsage grant to a non-reserved schema", () => {
		const app = schema("app");
		const grants = grant(app).usage.to("anon");
		expect(
			reservedSchemaValidator(emptySnapshot, [app, ...grants.grants]),
		).toEqual([]);
	});
});

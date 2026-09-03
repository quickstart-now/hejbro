import {
	emptySnapshot,
	existingTable,
	generateMigration,
	getTableMeta,
	grant,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { storageBucket } from "../src/storage/bucket";
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

	it("an existingTable in a reserved schema is exempt (add-unmanaged-objects, J6-2)", () => {
		const authUsers = existingTable("auth", "users", { id: uuid() });
		const diagnostics = reservedSchemaValidator(emptySnapshot, [
			getTableMeta(authUsers),
		]);
		expect(diagnostics).toEqual([]);
	});

	it("a managed table in auth is still refused (the exemption does not swallow the protection)", () => {
		const auth = schema("auth");
		const shadow = table(auth, "shadow_users", { id: uuid() });
		const diagnostics = reservedSchemaValidator(emptySnapshot, [
			getTableMeta(shadow),
		]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe("reserved-schema");
	});

	it("does not flag a schema-usage grant to a non-reserved schema", () => {
		const app = schema("app");
		const grants = grant(app).usage.to("anon");
		expect(
			reservedSchemaValidator(emptySnapshot, [app, ...grants.grants]),
		).toEqual([]);
	});

	it("does not flag a storage bucket declaration (no owning schema to check)", () => {
		// Buckets are the one real path through schemaOf's fallback
		// `return null` (see schema-of.ts's doc comment) -- this pins that
		// reservedSchemaValidator actually exercises it, not just that
		// schemaOf itself returns null in isolation. Every real
		// generation that includes a bucket runs this exact path
		// (examples/supabase does).
		const avatars = storageBucket("avatars");
		expect(reservedSchemaValidator(emptySnapshot, [avatars])).toEqual([]);
	});
});

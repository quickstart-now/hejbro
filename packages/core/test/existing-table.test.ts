import { describe, expect, it } from "vitest";
import {
	emptySnapshot,
	existingTable,
	generateMigration,
	schema,
	table,
	uuid,
} from "../src/index";

describe("existingTable", () => {
	const authUsers = existingTable("auth", "users", { id: uuid() });
	const app = schema("app");

	it("serves as an FK target without entering the snapshot", () => {
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
		});
		expect(result.sql).toContain('references "auth"."users"');
		expect(result.sql).not.toContain('create schema "auth"');
		expect(Object.keys(result.snapshot.objects)).not.toContain(
			"table:auth.users",
		);
	});

	it("hard-errors when passed as a declaration", () => {
		expect(() =>
			generateMigration({
				declarations: [authUsers],
				previousSnapshot: emptySnapshot,
			}),
		).toThrowError(
			expect.objectContaining({ code: "existing-table-declared" }),
		);
	});
});

import {
	emptySnapshot,
	generateMigration,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { authUsers } from "../src/auth-tables";

describe("authUsers", () => {
	it("serves as an FK target without entering the snapshot", () => {
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
		});
		expect(result.sql).toContain('references "auth"."users"');
		expect(result.sql).not.toContain('create schema "auth"');
		expect(Object.keys(result.snapshot.objects)).not.toContain(
			"table:auth.users",
		);
	});
});

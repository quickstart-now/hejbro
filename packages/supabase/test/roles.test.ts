import { emptySnapshot, generateMigration, grant, schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { anonRole, authenticatedRole, serviceRole } from "../src/roles";

describe("role constants", () => {
	it("brands the three Supabase role names", () => {
		expect(anonRole).toBe("anon");
		expect(authenticatedRole).toBe("authenticated");
		expect(serviceRole).toBe("service_role");
	});

	it("fans out through grant().to(anonRole, authenticatedRole)", () => {
		const app = schema("app");
		const result = generateMigration({
			declarations: [
				app,
				grant(app).tables("select").to(anonRole, authenticatedRole),
			],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain('to "anon"');
		expect(result.sql).toContain('to "authenticated"');
	});
});

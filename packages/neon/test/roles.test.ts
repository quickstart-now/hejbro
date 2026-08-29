import { emptySnapshot, generateMigration, grant, schema } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { anonymousRole, authenticatedRole } from "../src/roles";

describe("Neon role constants", () => {
	it("names Neon's own roles", () => {
		expect(authenticatedRole).toBe("authenticated");
		expect(anonymousRole).toBe("anonymous");
	});

	it("fans out through grant().to(anonymousRole, authenticatedRole)", () => {
		const app = schema("app");
		const result = generateMigration({
			declarations: [
				app,
				grant(app).tables("select").to(anonymousRole, authenticatedRole),
			],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain('to "anonymous"');
		expect(result.sql).toContain('to "authenticated"');
	});
});

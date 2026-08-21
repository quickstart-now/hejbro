import {
	emptySnapshot,
	eq,
	generateMigration,
	grant,
	rls,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { exposedTableValidator } from "../src/validators/exposed-tables";

describe("exposedTableValidator", () => {
	it("warns when a schema grants anon/authenticated and a table has no RLS", () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const result = generateMigration({
			declarations: [app, posts, grant(app).tables("select").to("anon")],
			previousSnapshot: emptySnapshot,
			validators: [exposedTableValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("exposed-table-without-rls");
		expect(result.warnings[0]?.message).toContain('"app"."posts"');
	});

	it("does not warn when the same table declares RLS", () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() }, (t) => ({
			rls: rls.enabled({
				read: rls
					.policy("posts_read")
					.for("select")
					.to("anon")
					.using(eq(t.id, t.id)),
			}),
		}));
		const result = generateMigration({
			declarations: [app, posts, grant(app).tables("select").to("anon")],
			previousSnapshot: emptySnapshot,
			validators: [exposedTableValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("does not warn when the grant is to service_role only", () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const result = generateMigration({
			declarations: [
				app,
				posts,
				grant(app).tables("select").to("service_role"),
			],
			previousSnapshot: emptySnapshot,
			validators: [exposedTableValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("does not warn without any grant on the schema", () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const result = generateMigration({
			declarations: [app, posts],
			previousSnapshot: emptySnapshot,
			validators: [exposedTableValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("does not warn for a schema-usage-only grant (not allTables/defaultTables)", () => {
		const app = schema("app");
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const result = generateMigration({
			declarations: [app, posts, grant(app).usage.to("anon")],
			previousSnapshot: emptySnapshot,
			validators: [exposedTableValidator],
		});
		expect(result.warnings).toEqual([]);
	});
});

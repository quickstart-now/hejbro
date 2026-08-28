import { eq, schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

const app = schema("app");
const activeUsers = table(app, "active_users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
});
const archivedUsers = table(app, "archived_users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
});

describe("set-op compile (add-set-operations task 3.1)", () => {
	it("compiles with lifted params from both branches in render order", () => {
		const combined = select(activeUsers)
			.where(eq(activeUsers.name, "mo"))
			.unionAll(select(archivedUsers).where(eq(archivedUsers.name, "po")))
			.limit(2);
		const result = compile(combined);
		expect(result.kind).toBe("setOp");
		expect(result.sql).toBe(
			'select "id", "name" from "app"."active_users" where "app"."active_users"."name" = $1 union all select "id", "name" from "app"."archived_users" where "app"."archived_users"."name" = $2 limit 2',
		);
		expect(result.params).toEqual(["mo", "po"]);
	});
});

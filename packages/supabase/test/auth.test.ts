import {
	emptySnapshot,
	eq,
	generateMigration,
	rls,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { authJwt, authJwtCached, authUid, authUidCached } from "../src/auth";
import { authenticatedRole } from "../src/roles";

describe("authUid()", () => {
	it("renders auth.uid() inside an rls policy using clause via generateMigration", () => {
		const app = schema("app");
		const accounts = table(
			app,
			"accounts",
			{
				id: uuid().primaryKey().defaultRandom(),
				userId: uuid().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("accounts_read_own")
						.for("select")
						.to(authenticatedRole)
						.using(eq(t.userId, authUid())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain(
			'using ("app"."accounts"."user_id" = auth.uid())',
		);
	});
});

describe("authJwt()", () => {
	it("builds a jsonb auth.jwt() expression node", () => {
		expect(authJwt().exprNode).toEqual({
			nodeKind: "functionCall",
			schemaName: "auth",
			functionName: "jwt",
			args: [],
		});
		expect(authJwt().family).toBe("json");
	});
});

describe("authUidCached()", () => {
	it("renders (select auth.uid()) inside an rls policy using clause via generateMigration (#97)", () => {
		const app = schema("app");
		const accounts = table(
			app,
			"accounts",
			{
				id: uuid().primaryKey().defaultRandom(),
				userId: uuid().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("accounts_read_own")
						.for("select")
						.to(authenticatedRole)
						.using(eq(t.userId, authUidCached())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain(
			'using ("app"."accounts"."user_id" = (select auth.uid()))',
		);
	});

	it("builds a rawSql-backed uuid expression node, reusing the existing node kind (#97)", () => {
		expect(authUidCached().exprNode).toEqual({
			nodeKind: "rawSql",
			sql: "(select auth.uid())",
		});
		expect(authUidCached().family).toBe("uuid");
	});
});

describe("authJwtCached()", () => {
	it("builds a rawSql-backed jsonb expression node (#97)", () => {
		expect(authJwtCached().exprNode).toEqual({
			nodeKind: "rawSql",
			sql: "(select auth.jwt())",
		});
		expect(authJwtCached().family).toBe("json");
	});
});

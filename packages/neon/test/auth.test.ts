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
import { authJwt, authUid } from "../src/auth";
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

	it("builds a uuid auth.uid() expression node -- the extension's identity function", () => {
		expect(authUid().exprNode).toEqual({
			nodeKind: "functionCall",
			schemaName: "auth",
			functionName: "uid",
			args: [],
		});
		expect(authUid().family).toBe("uuid");
	});
});

describe("authJwt()", () => {
	it("builds a jsonb auth.jwt() expression node -- the extension's claims function", () => {
		expect(authJwt().exprNode).toEqual({
			nodeKind: "functionCall",
			schemaName: "auth",
			functionName: "jwt",
			args: [],
		});
		expect(authJwt().family).toBe("json");
	});
});

import type { PolicyDeclaration } from "@hejbro/core";
import {
	and,
	emptySnapshot,
	eq,
	exists,
	generateMigration,
	isNotNull,
	not,
	rls,
	schema,
	select,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { authJwt, authJwtCached, authUid, authUidCached } from "../src/auth";
import { rlsUncachedAuthCallValidator } from "../src/validators/rls-uncached-auth-call";

describe("rlsUncachedAuthCallValidator", () => {
	const app = schema("app");

	it("warns on a plain authUid() in a policy's using clause", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey(), userId: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("accounts_read_own")
						.for("select")
						.to("authenticated")
						.using(eq(t.userId, authUid())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
		expect(result.warnings[0]?.message).toContain(
			'policy "accounts_read_own" on "app"."accounts"',
		);
		expect(result.warnings[0]?.message).toContain("using clause");
		expect(result.warnings[0]?.message).toContain("auth.uid()");
		expect(result.warnings[0]?.message).toContain(
			"Next: use authUidCached() here",
		);
	});

	it("warns on a plain authJwt() in a policy's with check clause", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey(), role: uuid().notNull() },
			() => ({
				rls: rls.enabled({
					insertAdminOnly: rls
						.policy("accounts_insert_admin_only")
						.for("insert")
						.to("authenticated")
						.withCheck(eq(authJwt(), authJwt())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
		expect(result.warnings[0]?.message).toContain(
			'policy "accounts_insert_admin_only" on "app"."accounts"',
		);
		expect(result.warnings[0]?.message).toContain("with check clause");
		expect(result.warnings[0]?.message).toContain("auth.jwt()");
		expect(result.warnings[0]?.message).toContain(
			"Next: use authJwtCached() here",
		);
	});

	it("does not warn on authUidCached() in using", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey(), userId: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("accounts_read_own")
						.for("select")
						.to("authenticated")
						.using(eq(t.userId, authUidCached())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("does not warn on authJwtCached() in with check", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey() },
			() => ({
				rls: rls.enabled({
					insertAdminOnly: rls
						.policy("accounts_insert_admin_only")
						.for("insert")
						.to("authenticated")
						.withCheck(eq(authJwtCached(), authJwtCached())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("finds a plain authUid() nested inside and(...)", () => {
		const comments = table(
			app,
			"comments",
			{
				id: uuid().primaryKey(),
				profileId: uuid().notNull(),
				userId: uuid().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("comments_read_own")
						.for("select")
						.to("authenticated")
						.using(and(eq(t.profileId, t.profileId), eq(t.userId, authUid()))),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, comments],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
	});

	it("warns on both clauses independently when both call the plain form", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey(), userId: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					readWriteOwn: rls
						.policy("accounts_rw_own")
						.for("all")
						.to("authenticated")
						.using(eq(t.userId, authUid()))
						.withCheck(eq(t.userId, authUid())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings.map((w) => w.message)).toEqual([
			expect.stringContaining("using clause"),
			expect.stringContaining("with check clause"),
		]);
	});

	it("finds a plain authUid() wrapped in isNotNull(...) (nullTest)", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey() },
			() => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("accounts_read_own")
						.for("select")
						.to("authenticated")
						.using(isNotNull(authUid())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
	});

	it("finds a plain authUid() wrapped in not(...)", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey(), userId: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("accounts_read_own")
						.for("select")
						.to("authenticated")
						.using(not(eq(t.userId, authUid()))),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
	});

	it("does not warn on an exists(...) subquery with no where clause (nothing to walk)", () => {
		const profiles = table(app, "profiles", { id: uuid().primaryKey() });
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey() },
			() => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("accounts_read_own")
						.for("select")
						.to("authenticated")
						.using(exists(select(profiles))),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, profiles, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("finds a plain authUid() inside an exists(...) subquery's where clause (the real examples/supabase shape)", () => {
		// examples/supabase's own policies hit exactly this shape twice out
		// of its three real uncached-auth-call sites: an ownership check
		// reached through exists(select(...).where(...)), not a direct
		// using(...) comparison. Unlike core's own someExprNode (which
		// treats exists() as opaque -- a different concern, column-scope
		// checking), this validator must descend into it: the subquery's
		// predicate still runs once per outer row.
		const profiles = table(app, "profiles", {
			id: uuid().primaryKey(),
			userId: uuid().notNull(),
		});
		const attachments = table(
			app,
			"attachments",
			{ id: uuid().primaryKey(), profileId: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("attachments_read_own")
						.for("select")
						.to("authenticated")
						.using(
							exists(
								select(profiles).where(
									and(
										eq(profiles.id, t.profileId),
										eq(profiles.userId, authUid()),
									),
								),
							),
						),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, profiles, attachments],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
	});

	it("finds a plain authUid() inside an exists(...) subquery's join condition", () => {
		const profiles = table(app, "profiles", {
			id: uuid().primaryKey(),
			userId: uuid().notNull(),
		});
		const attachments = table(app, "attachments", {
			id: uuid().primaryKey(),
			profileId: uuid().notNull(),
		});
		const attachmentBlobs = table(
			app,
			"attachment_blobs",
			{ attachmentId: uuid().primaryKey() },
			(t) => ({
				rls: rls.enabled({
					readOwn: rls
						.policy("attachment_blobs_read_own")
						.for("select")
						.to("authenticated")
						.using(
							exists(
								select(attachments)
									.innerJoin(profiles, eq(profiles.userId, authUid()))
									.where(eq(attachments.id, t.attachmentId)),
							),
						),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, profiles, attachments, attachmentBlobs],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
	});

	it("does not warn on a plain authUid() used in a column default (#97: not a policy, out of scope by design)", () => {
		const accounts = table(app, "accounts", {
			id: uuid().primaryKey(),
			createdBy: uuid().default(authUid()),
		});
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	// The four cases below hand-build a PolicyDeclaration's `using` ExprNode
	// directly (bypassing the DSL builders) to reach node shapes the fluent
	// RLS/comparison helpers above don't exercise: inList, between, a
	// functionCall nested inside another functionCall's args, and
	// sqlTemplate. Calling rlsUncachedAuthCallValidator directly (not
	// through generateMigration) is the same pattern used elsewhere for
	// hand-built declarations that don't need a full table/schema around
	// them.
	describe("less common ExprNode shapes", () => {
		const literalTrue: PolicyDeclaration["using"] = {
			nodeKind: "literal",
			literal: { literalKind: "boolean", value: true },
		};
		const basePolicy: Omit<PolicyDeclaration, "using" | "withCheck"> = {
			declarationKind: "policy",
			schemaName: "app",
			tableName: "accounts",
			policyName: "accounts_exotic",
			permissive: true,
			command: "select",
			roles: ["authenticated"],
			declaredAt: null,
		};

		it("finds a plain authUid() inside an inList's values", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "inList",
					negated: false,
					operand: literalTrue,
					values: [authUid().exprNode],
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});

		it("finds a plain authUid() inside a between's lowerBound", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "between",
					negated: false,
					operand: literalTrue,
					lowerBound: authUid().exprNode,
					upperBound: literalTrue,
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});

		it("finds a plain authUid() nested inside another functionCall's args (e.g. coalesce)", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "coalesce",
					args: [authUid().exprNode, literalTrue],
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});

		it("finds a plain authUid() inside a sqlTemplate chunk", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "sqlTemplate",
					chunks: [
						{ chunkKind: "text", text: "1 = 1 and " },
						{ chunkKind: "expr", expr: authUid().exprNode },
						{ chunkKind: "text", text: " is not null" },
					],
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});
	});
});

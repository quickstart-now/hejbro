import type { ExprNode, PolicyDeclaration, SelectNode } from "@hejbro/core";
import {
	and,
	emptySnapshot,
	eq,
	exists,
	generateMigration,
	grant,
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
	// Every policy below targets "authenticated" -- #203's schema-usage
	// check would otherwise also warn, which isn't what these tests
	// exercise (that check has its own suite, core-validators.test.ts).
	const usageGrant = grant(app).usage.to("authenticated");

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
			declarations: [app, usageGrant, accounts],
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
			declarations: [app, usageGrant, accounts],
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
			declarations: [app, usageGrant, accounts],
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
			declarations: [app, usageGrant, accounts],
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
			declarations: [app, usageGrant, comments],
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
			declarations: [app, usageGrant, accounts],
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
			declarations: [app, usageGrant, accounts],
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
			declarations: [app, usageGrant, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
	});

	it("finds a plain authUid() inside an exists(...) subquery's orderBy term", () => {
		// buildExists (packages/core/src/query/select.ts) only overrides the
		// wrapped query's projection to constantOne -- it does not clear
		// orderBy, so a term set via the public .orderBy(...) builder before
		// exists(...) wraps the query survives into the persisted
		// ExistsNode untouched. Confirmed directly against the built
		// ExprNode before writing this test: exists(select(t).where(...)
		// .orderBy(authUid())) produces query.orderBy[0].expr === the
		// uncached functionCall node. Meaningless for what EXISTS actually
		// returns, but still a real, type-checking path through the DSL,
		// so it must warn.
		const profiles = table(app, "profiles", {
			id: uuid().primaryKey(),
			userId: uuid().notNull(),
		});
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
						.using(
							exists(
								select(profiles)
									.where(eq(profiles.id, profiles.id))
									.orderBy(authUid()),
							),
						),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, usageGrant, profiles, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsUncachedAuthCallValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe("rls-uncached-auth-call");
	});

	// #444 F5b: childrenOfHandlers' exists entry used to hand-list
	// where/joins.on/orderBy only (a private copy of core's own pre-#444
	// traversal), missing the two clauses #443 added.
	it("flags an uncached auth.uid() inside an exists() subquery's having", () => {
		const profiles = table(app, "profiles", {
			id: uuid().primaryKey(),
			userId: uuid().notNull(),
		});
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
						.using(
							exists(
								select(profiles)
									.where(eq(profiles.id, profiles.id))
									.groupBy(profiles.userId)
									.having(eq(profiles.userId, authUid())),
							),
						),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, usageGrant, profiles, accounts],
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
			declarations: [app, usageGrant, profiles, accounts],
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
			declarations: [app, usageGrant, profiles, attachments],
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
			declarations: [app, usageGrant, profiles, attachments, attachmentBlobs],
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

		// add-window-functions task 1.6: window is hand-built here rather
		// than via the public DSL (the over()/rank() vocabulary lands in
		// group 2) -- the point of this test is childrenOfHandlers' own
		// window arm, not the builder. Same shape as the exists()/having
		// case above (#444 F5b): a private, hand-written traversal would
		// have missed this the same way core's pre-#444 one missed
		// groupBy/having.
		it("finds a plain authUid() inside over()'s partitionBy", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "window",
					fn: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName: "rank",
						args: [],
					},
					partitionBy: [authUid().exprNode],
					orderBy: [],
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});

		it("finds a plain authUid() inside over()'s orderBy", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "window",
					fn: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName: "rank",
						args: [],
					},
					partitionBy: [],
					orderBy: [{ expr: authUid().exprNode, direction: "asc" }],
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});

		it("finds a plain authUid() inside the windowed function's own argument", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "window",
					fn: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName: "coalesce",
						args: [authUid().exprNode, literalTrue],
					},
					partitionBy: [],
					orderBy: [],
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});

		// add-aggregate-filter task (#501): filter(...)'s two positions
		// (fn, where) are plain sibling expressions, not a subquery -- same
		// shape as window's own arm just above, same reason it must warn.
		it("finds a plain authUid() inside a filtered aggregate's condition", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "aggregateFilter",
					fn: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName: "count",
						args: [{ nodeKind: "rawSql", sql: "*" }],
					},
					where: authUid().exprNode,
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});

		it("finds a plain authUid() inside a filtered aggregate's own function argument", () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: {
					nodeKind: "aggregateFilter",
					fn: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName: "coalesce",
						args: [authUid().exprNode, literalTrue],
					},
					where: literalTrue,
				},
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]?.code).toBe("rls-uncached-auth-call");
		});
	});
});

/**
 * One row per {@link ExprNode} kind × child position this validator's
 * traversal knows, plus three contrast rows (#515, tasks.md 1.3): pinned
 * against the pre-fold `childrenOfHandlers` table (commit 9244e528) --
 * running this same table again after the fold to `exprChildren` must
 * stay byte-identical, which is the proof no child position was lost.
 * `exists`/`selectExpr` keep their own branch after the fold: a
 * subquery's predicate runs once per outer row exactly like the policy's
 * own clause, so this validator descends into it (#444 F5b) where core's
 * own `exprChildren` deliberately treats it as opaque. The contrast rows
 * (comparison/window/exists with a plain literal instead of an auth call)
 * guard against the table trivially reporting a warning regardless of
 * content.
 */
describe("rlsUncachedAuthCallValidator: one row per node kind × child position, pinned pre-fold (#515)", () => {
	const literalTrue: ExprNode = {
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
	const innerSelect = (where: ExprNode): SelectNode => ({
		queryKind: "select",
		projection: { projectionKind: "constantOne" },
		from: { schemaName: "app", tableName: "profiles" },
		joins: [],
		where,
		groupBy: [],
		having: null,
		orderBy: [],
		limit: null,
		offset: null,
		distinct: null,
	});
	const authCall = (): ExprNode => authUid().exprNode;

	type Row = {
		readonly label: string;
		readonly using: ExprNode;
		readonly expectedWarnings: number;
	};

	const rows: ReadonlyArray<Row> = [
		// Zero-child kinds: no auth call reachable, always zero warnings.
		{ label: "literal", using: literalTrue, expectedWarnings: 0 },
		{
			label: "rawSql",
			using: { nodeKind: "rawSql", sql: "true" },
			expectedWarnings: 0,
		},
		{
			label: "plpgsqlRef",
			using: { nodeKind: "plpgsqlRef", path: ["new", "flag"] },
			expectedWarnings: 0,
		},
		{
			label: "columnRef",
			using: {
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "accounts",
				columnName: "id",
			},
			expectedWarnings: 0,
		},
		// comparison: left, then right.
		{
			label: "comparison left",
			using: {
				nodeKind: "comparison",
				operator: "=",
				left: authCall(),
				right: literalTrue,
			},
			expectedWarnings: 1,
		},
		{
			label: "comparison right",
			using: {
				nodeKind: "comparison",
				operator: "=",
				left: literalTrue,
				right: authCall(),
			},
			expectedWarnings: 1,
		},
		// logical: operands 1, 2, 3 -- one auth call at a time, the other two plain.
		{
			label: "logical operand 1",
			using: {
				nodeKind: "logical",
				operator: "and",
				operands: [authCall(), literalTrue, literalTrue],
			},
			expectedWarnings: 1,
		},
		{
			label: "logical operand 2",
			using: {
				nodeKind: "logical",
				operator: "and",
				operands: [literalTrue, authCall(), literalTrue],
			},
			expectedWarnings: 1,
		},
		{
			label: "logical operand 3",
			using: {
				nodeKind: "logical",
				operator: "and",
				operands: [literalTrue, literalTrue, authCall()],
			},
			expectedWarnings: 1,
		},
		{
			label: "not operand",
			using: { nodeKind: "not", operand: authCall() },
			expectedWarnings: 1,
		},
		{
			label: "nullTest operand",
			using: { nodeKind: "nullTest", negated: false, operand: authCall() },
			expectedWarnings: 1,
		},
		// inList: operand, then values 1 and 2.
		{
			label: "inList operand",
			using: {
				nodeKind: "inList",
				negated: false,
				operand: authCall(),
				values: [literalTrue, literalTrue],
			},
			expectedWarnings: 1,
		},
		{
			label: "inList value 1",
			using: {
				nodeKind: "inList",
				negated: false,
				operand: literalTrue,
				values: [authCall(), literalTrue],
			},
			expectedWarnings: 1,
		},
		{
			label: "inList value 2",
			using: {
				nodeKind: "inList",
				negated: false,
				operand: literalTrue,
				values: [literalTrue, authCall()],
			},
			expectedWarnings: 1,
		},
		// between: operand, lowerBound, upperBound.
		{
			label: "between operand",
			using: {
				nodeKind: "between",
				negated: false,
				operand: authCall(),
				lowerBound: literalTrue,
				upperBound: literalTrue,
			},
			expectedWarnings: 1,
		},
		{
			label: "between lowerBound",
			using: {
				nodeKind: "between",
				negated: false,
				operand: literalTrue,
				lowerBound: authCall(),
				upperBound: literalTrue,
			},
			expectedWarnings: 1,
		},
		{
			label: "between upperBound",
			using: {
				nodeKind: "between",
				negated: false,
				operand: literalTrue,
				lowerBound: literalTrue,
				upperBound: authCall(),
			},
			expectedWarnings: 1,
		},
		// functionCall: args 1 and 2, wrapped in a non-auth outer call (coalesce).
		{
			label: "functionCall arg 1",
			using: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "coalesce",
				args: [authCall(), literalTrue],
			},
			expectedWarnings: 1,
		},
		{
			label: "functionCall arg 2",
			using: {
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "coalesce",
				args: [literalTrue, authCall()],
			},
			expectedWarnings: 1,
		},
		// sqlTemplate: expr chunks 1 and 2.
		{
			label: "sqlTemplate expr chunk 1",
			using: {
				nodeKind: "sqlTemplate",
				chunks: [
					{ chunkKind: "expr", expr: authCall() },
					{ chunkKind: "text", text: " and " },
					{ chunkKind: "expr", expr: literalTrue },
				],
			},
			expectedWarnings: 1,
		},
		{
			label: "sqlTemplate expr chunk 2",
			using: {
				nodeKind: "sqlTemplate",
				chunks: [
					{ chunkKind: "expr", expr: literalTrue },
					{ chunkKind: "text", text: " and " },
					{ chunkKind: "expr", expr: authCall() },
				],
			},
			expectedWarnings: 1,
		},
		// window: fn's own argument, then partitionBy, then orderBy.
		{
			label: "window fn argument",
			using: {
				nodeKind: "window",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "coalesce",
					args: [authCall(), literalTrue],
				},
				partitionBy: [],
				orderBy: [],
			},
			expectedWarnings: 1,
		},
		{
			label: "window partitionBy",
			using: {
				nodeKind: "window",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "rank",
					args: [],
				},
				partitionBy: [authCall()],
				orderBy: [],
			},
			expectedWarnings: 1,
		},
		{
			label: "window orderBy",
			using: {
				nodeKind: "window",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "rank",
					args: [],
				},
				partitionBy: [],
				orderBy: [{ expr: authCall(), direction: "asc" }],
			},
			expectedWarnings: 1,
		},
		// aggregateFilter: fn's own argument, then where.
		{
			label: "aggregateFilter fn argument",
			using: {
				nodeKind: "aggregateFilter",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "coalesce",
					args: [authCall(), literalTrue],
				},
				where: literalTrue,
			},
			expectedWarnings: 1,
		},
		{
			label: "aggregateFilter where",
			using: {
				nodeKind: "aggregateFilter",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "count",
					args: [{ nodeKind: "rawSql", sql: "*" }],
				},
				where: authCall(),
			},
			expectedWarnings: 1,
		},
		// exists/selectExpr: this validator's own descent into the subquery's where.
		{
			label: "exists subquery where",
			using: {
				nodeKind: "exists",
				negated: false,
				query: innerSelect(authCall()),
			},
			expectedWarnings: 1,
		},
		{
			label: "selectExpr subquery where",
			using: {
				nodeKind: "selectExpr",
				mode: "jsonObject",
				query: innerSelect(authCall()),
			},
			expectedWarnings: 1,
		},
		// Contrast rows: same shapes, a plain literal instead of an auth call --
		// the witness that the table doesn't warn regardless of content.
		{
			label: "contrast: comparison with no auth call",
			using: {
				nodeKind: "comparison",
				operator: "=",
				left: literalTrue,
				right: literalTrue,
			},
			expectedWarnings: 0,
		},
		{
			label: "contrast: window with no auth call",
			using: {
				nodeKind: "window",
				fn: {
					nodeKind: "functionCall",
					schemaName: null,
					functionName: "rank",
					args: [],
				},
				partitionBy: [literalTrue],
				orderBy: [{ expr: literalTrue, direction: "asc" }],
			},
			expectedWarnings: 0,
		},
		{
			label: "contrast: exists subquery with no auth call",
			using: {
				nodeKind: "exists",
				negated: false,
				query: innerSelect(literalTrue),
			},
			expectedWarnings: 0,
		},
	];

	rows.forEach((row) => {
		it(`${row.label}: ${row.expectedWarnings} warning(s)`, () => {
			const policy: PolicyDeclaration = {
				...basePolicy,
				using: row.using,
				withCheck: null,
			};
			const warnings = rlsUncachedAuthCallValidator(emptySnapshot, [policy]);
			expect(warnings).toHaveLength(row.expectedWarnings);
		});
	});
});

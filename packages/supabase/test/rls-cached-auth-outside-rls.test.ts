import type { TableDeclaration } from "@hejbro/core";
import {
	boolean,
	check,
	emptySnapshot,
	eq,
	exists,
	generateMigration,
	index,
	isNotNull,
	rls,
	schema,
	select,
	sql,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { authJwtCached, authUid, authUidCached } from "../src/auth";
import { rlsCachedAuthOutsideRlsValidator } from "../src/validators/rls-cached-auth-outside-rls";

describe("rlsCachedAuthOutsideRlsValidator", () => {
	const app = schema("app");

	it("errors when a column default calls authUidCached()", () => {
		const accounts = table(app, "accounts", {
			id: uuid().primaryKey(),
			createdBy: uuid().default(authUidCached()),
		});
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsCachedAuthOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("rls-cached-auth-outside-rls");
		expect(result.errors[0]?.message).toBe(
			'column "app"."accounts"."created_by"\'s default calls authUidCached() — a scalar subquery is illegal here. Next: use authUid() here, or move the check into a policy.',
		);
	});

	it("does not error when a column default calls the plain authUid()", () => {
		const accounts = table(app, "accounts", {
			id: uuid().primaryKey(),
			createdBy: uuid().default(authUid()),
		});
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsCachedAuthOutsideRlsValidator],
		});
		expect(result.errors).toEqual([]);
	});

	it("errors when a CHECK calls authJwtCached()", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey() },
			() => ({
				checks: [check("accounts_role_check", isNotNull(authJwtCached()))],
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsCachedAuthOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("rls-cached-auth-outside-rls");
		expect(result.errors[0]?.message).toBe(
			'check "accounts_role_check" on table "app"."accounts" calls authJwtCached() — a scalar subquery is illegal here. Next: use authJwt() here, or move the check into a policy.',
		);
	});

	it("errors when a partial index predicate calls authUidCached()", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey(), createdBy: uuid() },
			(t) => ({
				indexes: [
					index("accounts_created_by_idx")
						.on(t.createdBy)
						.where(eq(t.createdBy, authUidCached())),
				],
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsCachedAuthOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("rls-cached-auth-outside-rls");
		expect(result.errors[0]?.message).toBe(
			'index "accounts_created_by_idx" on table "app"."accounts" calls authUidCached() — a scalar subquery is illegal here. Next: use authUid() here, or move the check into a policy.',
		);
	});

	// #284 (US3, T006 revival): `IndexColumnDeclaration` is a two-variant
	// union (`{ name }` | `{ expression }`, R5) — an unnamed index's
	// description must render an expression entry the same way
	// `contracts/sql.md` does (`(<expression>)`), not crash reading
	// `.name` off a variant that doesn't have one. Built by hand (not
	// `table()`) because an expression index always requires an explicit
	// name (D86/R6, `index-expression-requires-name`) — `table()` can
	// never actually produce the unnamed case this branch handles, so
	// this is a pure unit test of `indexDescription` via the validator,
	// on a hand-assembled `TableDeclaration` of core's public shape.
	it("describes an unnamed index's expression column as its rendered SQL", () => {
		const accounts: TableDeclaration = {
			declarationKind: "table",
			schema: app,
			tableName: "accounts",
			columns: [],
			indexes: [
				{
					columns: [
						{
							expression: sql`lower(email)`.exprNode,
							desc: false,
							nulls: null,
							opclass: null,
						},
					],
					unique: false,
					indexName: null,
					predicate: authUidCached().exprNode,
					method: null,
				},
			],
			foreignKeys: [],
			checks: [],
			rls: null,
			existing: false,
			declaredAt: null,
		};
		const result = rlsCachedAuthOutsideRlsValidator(emptySnapshot, [
			app,
			accounts,
		]);
		expect(result).toHaveLength(1);
		expect(result[0]?.message).toBe(
			'the index on ((lower(email))) on table "app"."accounts" calls authUidCached() — a scalar subquery is illegal here. Next: use authUid() here, or move the check into a policy.',
		);
	});

	// CHECK and index-predicate expressions can never legitimately contain
	// an exists(...) at all -- core's own validateChecks/
	// validateIndexPredicates reject any exists() node in either clause at
	// declaration time (packages/core/src/dsl/table.ts), regardless of
	// what's inside it. A column default has no such guard (the issue's
	// own callout: ".default(...) has no structural validation at all"),
	// so it's the one place today where an authUidCached() nested inside
	// exists(...) can actually reach this validator -- which is exactly
	// what exercises someDeepExprNode's descent instead of someExprNode's
	// shallow, opaque-at-exists behavior.
	it("finds authUidCached() buried inside an exists(...) subquery in a column default", () => {
		const profiles = table(app, "profiles", {
			id: uuid().primaryKey(),
			userId: uuid(),
		});
		const accounts = table(app, "accounts", {
			id: uuid().primaryKey(),
			hasProfile: boolean().default(
				exists(select(profiles).where(eq(profiles.userId, authUidCached()))),
			),
		});
		const result = generateMigration({
			declarations: [app, profiles, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsCachedAuthOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("rls-cached-auth-outside-rls");
	});

	// This validator is scoped to default/CHECK/index-predicate only (its
	// own doc comment) -- a policy's using/withCheck is exactly where
	// authUidCached()/authJwtCached() belong (that's what makes them
	// legal there and illegal everywhere else this file checks): Postgres
	// evaluates a policy's own clause once per statement already, so the
	// scalar-subquery form is correct, not a violation. rls-uncached-auth-call.ts
	// covers the opposite direction (the plain, uncached form inside a
	// policy).
	it("does not error when a policy's using/withCheck calls authUidCached()/authJwtCached() (out of this validator's scope)", () => {
		const accounts = table(
			app,
			"accounts",
			{ id: uuid().primaryKey() },
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("accounts_read_own")
						.for("select")
						.to("authenticated")
						.using(eq(t.id, authUidCached())),
					write: rls
						.policy("accounts_write_own")
						.for("insert")
						.to("authenticated")
						.withCheck(isNotNull(authJwtCached())),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsCachedAuthOutsideRlsValidator],
		});
		expect(result.errors).toEqual([]);
	});

	it("does not error on a table with no default/check/index at all", () => {
		const accounts = table(app, "accounts", { id: uuid().primaryKey() });
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [rlsCachedAuthOutsideRlsValidator],
		});
		expect(result.errors).toEqual([]);
	});
});

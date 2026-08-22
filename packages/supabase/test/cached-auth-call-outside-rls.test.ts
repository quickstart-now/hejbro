import {
	boolean,
	check,
	emptySnapshot,
	eq,
	exists,
	generateMigration,
	index,
	isNotNull,
	schema,
	select,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { authJwtCached, authUid, authUidCached } from "../src/auth";
import { cachedAuthCallOutsideRlsValidator } from "../src/validators/cached-auth-call-outside-rls";

describe("cachedAuthCallOutsideRlsValidator", () => {
	const app = schema("app");

	it("errors when a column default calls authUidCached()", () => {
		const accounts = table(app, "accounts", {
			id: uuid().primaryKey(),
			createdBy: uuid().default(authUidCached()),
		});
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [cachedAuthCallOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("cached-auth-call-outside-rls");
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
			validators: [cachedAuthCallOutsideRlsValidator],
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
			validators: [cachedAuthCallOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("cached-auth-call-outside-rls");
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
			validators: [cachedAuthCallOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("cached-auth-call-outside-rls");
		expect(result.errors[0]?.message).toBe(
			'index "accounts_created_by_idx" on table "app"."accounts" calls authUidCached() — a scalar subquery is illegal here. Next: use authUid() here, or move the check into a policy.',
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
			validators: [cachedAuthCallOutsideRlsValidator],
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("cached-auth-call-outside-rls");
	});

	it("does not error on a table with no default/check/index at all", () => {
		const accounts = table(app, "accounts", { id: uuid().primaryKey() });
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
			validators: [cachedAuthCallOutsideRlsValidator],
		});
		expect(result.errors).toEqual([]);
	});
});

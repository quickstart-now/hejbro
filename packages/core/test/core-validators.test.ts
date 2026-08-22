import { describe, expect, it } from "vitest";
import type { GrantDeclaration } from "../src/dsl/grant";
import type { PolicyDeclaration } from "../src/dsl/rls";
import {
	notNullWithoutDefaultWarnings,
	rlsUnreachableSchemaWarnings,
} from "../src/engine/core-validators";
import { encodeExprNode } from "../src/expr/codec";
import type { HejbroDeclaration, KindChange } from "../src/kind/object-kind";
import type { JsonValue } from "../src/snapshot/stable-json";

// #110: default is now a structured expression node (D67/D70); this
// builds a minimal valid one -- notNullWithoutDefaultWarnings only checks
// presence (columnDefault(...) === null), not content.
const stringDefault = (value: string): JsonValue =>
	encodeExprNode({
		nodeKind: "literal",
		literal: { literalKind: "string", value },
	});

const tableSnapshot = (
	name: string,
	columns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: JsonValue;
	}>,
) => ({
	schema: "app",
	name,
	columns,
	indexes: [],
	foreignKeys: [],
});

const alterChange = (
	previousColumns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: JsonValue;
	}>,
	nextColumns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: JsonValue;
	}>,
): KindChange => ({
	kind: "table",
	operation: "alter",
	identity: "app.posts",
	previous: tableSnapshot("posts", previousColumns),
	next: tableSnapshot("posts", nextColumns),
	notes: [],
});

const createChange = (
	columns: ReadonlyArray<{
		readonly name: string;
		readonly notNull?: true;
		readonly default?: JsonValue;
	}>,
): KindChange => ({
	kind: "table",
	operation: "create",
	identity: "app.posts",
	previous: null,
	next: tableSnapshot("posts", columns),
	notes: [],
});

describe("notNullWithoutDefaultWarnings", () => {
	it("warns once, with a fixed message, when an alter adds a not-null column without a default", () => {
		const change = alterChange(
			[{ name: "id", notNull: true }],
			[
				{ name: "id", notNull: true },
				{ name: "status", notNull: true },
			],
		);

		const warnings = notNullWithoutDefaultWarnings([change]);

		expect(warnings).toEqual([
			{
				severity: "warning",
				code: "not-null-without-default",
				message:
					'column "app"."posts"."status" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.',
				declaredAt: null,
			},
		]);
	});

	it("does not warn for a brand-new table (create, not alter)", () => {
		const change = createChange([{ name: "status", notNull: true }]);

		expect(notNullWithoutDefaultWarnings([change])).toEqual([]);
	});

	it("does not warn when the added not-null column has a default", () => {
		const change = alterChange(
			[{ name: "id", notNull: true }],
			[
				{ name: "id", notNull: true },
				{ name: "status", notNull: true, default: stringDefault("draft") },
			],
		);

		expect(notNullWithoutDefaultWarnings([change])).toEqual([]);
	});

	it("does not warn when the added column is nullable", () => {
		const change = alterChange(
			[{ name: "id", notNull: true }],
			[{ name: "id", notNull: true }, { name: "status" }],
		);

		expect(notNullWithoutDefaultWarnings([change])).toEqual([]);
	});

	// #23/D66: a serial-family column's default lives in the sequence kind's
	// own snapshot node, not ColumnSnapshot.default (see sequence-kind.ts) --
	// so at the ColumnSnapshot level this column looks exactly like a plain
	// not-null column with no default. Without cross-referencing the
	// sibling `sequence` change in the same diff, this validator would warn
	// on every serial column ever added to an existing table -- a
	// permanent false positive users would learn to ignore, which is
	// exactly how #23's underlying SQL defect stayed invisible until now.
	it("does not warn when the added not-null column is owned by a sequence in the same diff (serial column add)", () => {
		const tableChange = alterChange(
			[{ name: "title", notNull: true }],
			[
				{ name: "title", notNull: true },
				{ name: "n", notNull: true },
			],
		);
		const sequenceChange: KindChange = {
			kind: "sequence",
			operation: "create",
			identity: "app.posts_n_seq",
			previous: null,
			next: {
				schema: "app",
				name: "posts_n_seq",
				table: "posts",
				column: "n",
				baseType: "integer",
			},
			notes: [],
		};

		expect(
			notNullWithoutDefaultWarnings([tableChange, sequenceChange]),
		).toEqual([]);
	});

	// Control group for the case above, in the *same* diff: a plain
	// not-null column with no default and no owning sequence still warns --
	// the sequence cross-reference only suppresses the specific column a
	// sequence in this diff actually owns, not the whole diff.
	it("still warns for a plain not-null column with no default alongside a serial column add in the same diff", () => {
		const tableChange = alterChange(
			[{ name: "title", notNull: true }],
			[
				{ name: "title", notNull: true },
				{ name: "n", notNull: true },
				{ name: "status", notNull: true },
			],
		);
		const sequenceChange: KindChange = {
			kind: "sequence",
			operation: "create",
			identity: "app.posts_n_seq",
			previous: null,
			next: {
				schema: "app",
				name: "posts_n_seq",
				table: "posts",
				column: "n",
				baseType: "integer",
			},
			notes: [],
		};

		expect(
			notNullWithoutDefaultWarnings([tableChange, sequenceChange]),
		).toEqual([
			{
				severity: "warning",
				code: "not-null-without-default",
				message:
					'column "app"."posts"."status" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.',
				declaredAt: null,
			},
		]);
	});
});

const policy = (
	roles: ReadonlyArray<string>,
	overrides: Partial<PolicyDeclaration> = {},
): PolicyDeclaration => ({
	declarationKind: "policy",
	schemaName: "app",
	tableName: "posts",
	policyName: "posts_select",
	permissive: true,
	command: "select",
	roles,
	using: null,
	withCheck: null,
	declaredAt: null,
	...overrides,
});

const schemaUsageGrant = (
	schemaName: string,
	role: string,
): GrantDeclaration => ({
	declarationKind: "grant",
	grantKind: "schema-usage",
	schemaName,
	role,
	privileges: [],
	declaredAt: null,
});

describe("rlsUnreachableSchemaWarnings", () => {
	it("warns when the policy's schema grants usage to none of its target roles", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [policy(["anon"])];

		expect(rlsUnreachableSchemaWarnings(declarations)).toEqual([
			{
				severity: "warning",
				code: "rls-unreachable-schema",
				message:
					'policy "posts_select" on "app"."posts" targets role(s) "anon" but schema "app" grants usage to none of them — every row is unreachable through this policy (permission denied for schema before RLS is even consulted). Next: grant(schema).usage.to("anon"), or add the missing role(s) to an existing schema-usage grant.',
				declaredAt: null,
			},
		]);
	});

	it("does not warn when the target role has a schema-usage grant", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			policy(["anon"]),
			schemaUsageGrant("app", "anon"),
		];

		expect(rlsUnreachableSchemaWarnings(declarations)).toEqual([]);
	});

	it("does not warn when only one of several target roles has usage (partial reachability)", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			policy(["anon", "authenticated"]),
			schemaUsageGrant("app", "authenticated"),
		];

		expect(rlsUnreachableSchemaWarnings(declarations)).toEqual([]);
	});

	it("warns naming every target role when none of several has usage", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			policy(["authenticated", "anon"]),
		];

		const warnings = rlsUnreachableSchemaWarnings(declarations);

		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.message).toContain('"anon", "authenticated"');
	});

	// PostgreSQL semantics, not a hejbro-specific carve-out: `grant usage
	// on schema … to public` covers every role, not only one literally
	// named "public".
	it("does not warn when the schema-usage grant's role is public, even for an unrelated target role", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			policy(["anon"]),
			schemaUsageGrant("app", "public"),
		];

		expect(rlsUnreachableSchemaWarnings(declarations)).toEqual([]);
	});

	// A policy `to("public")` applies to every role -- it's reachable as
	// soon as *any* role can use the schema, not only one literally
	// named "public".
	it("does not warn when the policy targets public and any role has usage", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			policy(["public"]),
			schemaUsageGrant("app", "authenticated"),
		];

		expect(rlsUnreachableSchemaWarnings(declarations)).toEqual([]);
	});

	it("warns when the policy targets public and no role has any usage grant on the schema", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [policy(["public"])];

		const warnings = rlsUnreachableSchemaWarnings(declarations);

		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe("rls-unreachable-schema");
	});

	it("still warns when the matching-role grant is on a different schema", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			policy(["anon"]),
			schemaUsageGrant("other", "anon"),
		];

		const warnings = rlsUnreachableSchemaWarnings(declarations);

		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe("rls-unreachable-schema");
	});

	it("does not warn about a non-schema-usage grant on the same schema/role", () => {
		const nonUsageGrant: GrantDeclaration = {
			declarationKind: "grant",
			grantKind: "all-tables-privileges",
			schemaName: "app",
			role: "anon",
			privileges: ["select"],
			declaredAt: null,
		};
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			policy(["anon"]),
			nonUsageGrant,
		];

		expect(rlsUnreachableSchemaWarnings(declarations)).toEqual([
			expect.objectContaining({ code: "rls-unreachable-schema" }),
		]);
	});

	it("ignores non-policy, non-grant declarations", () => {
		const declarations: ReadonlyArray<HejbroDeclaration> = [
			{ declarationKind: "schema", schemaName: "app" } as HejbroDeclaration,
		];

		expect(rlsUnreachableSchemaWarnings(declarations)).toEqual([]);
	});
});

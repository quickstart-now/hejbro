import { describe, expect, it } from "vitest";
import type { GrantDeclaration, TablePrivilege } from "../src/dsl/grant";
import { grant } from "../src/dsl/grant";
import { schema } from "../src/dsl/schema";
import { generateMigration } from "../src/engine/generate";
import { createDefaultRegistry } from "../src/kind/registry";
import { grantKind } from "../src/kinds/grant-kind";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";

const app = schema("app");
const registry = createDefaultRegistry();

const requireGrant = (
	grants: ReadonlyArray<GrantDeclaration>,
): GrantDeclaration => {
	const [declaration] = grants;
	if (declaration === undefined) {
		throw new Error("expected exactly one fanned-out grant declaration");
	}
	return declaration;
};

const usageGrant = (role = "anon"): GrantDeclaration =>
	requireGrant(grant(app).usage.to(role).grants);

const allTablesGrant = (
	privileges: ReadonlyArray<TablePrivilege>,
	role = "service_role",
): GrantDeclaration =>
	requireGrant(
		grant(app)
			.tables(...privileges)
			.to(role).grants,
	);

const defaultPrivilegesGrant = (
	privileges: ReadonlyArray<TablePrivilege>,
	role = "anon",
): GrantDeclaration =>
	requireGrant(
		grant(app)
			.defaultPrivileges.tables(...privileges)
			.to(role).grants,
	);

describe("grantKind.serialize / identify", () => {
	it("serializes to schema/grantKind/role/privileges", () => {
		const declaration = allTablesGrant(["select", "insert"]);
		expect(grantKind.serialize(declaration)).toEqual({
			schema: "app",
			grantKind: "all-tables-privileges",
			role: "service_role",
			privileges: ["select", "insert"],
		});
	});

	it("identifies as schema.grantKind.role", () => {
		const snapshot = grantKind.serialize(usageGrant());
		expect(grantKind.identify(snapshot)).toBe("app.schema-usage.anon");
	});
});

describe("grantKind.diff", () => {
	it("diffs create when there is no previous snapshot", () => {
		const next = grantKind.serialize(usageGrant());
		const identity = "app.schema-usage.anon";
		expect(grantKind.diff(null, next, identity)).toEqual([
			{
				kind: "grant",
				operation: "create",
				identity,
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs drop when there is no next snapshot", () => {
		const previous = grantKind.serialize(usageGrant());
		const identity = "app.schema-usage.anon";
		expect(grantKind.diff(previous, null, identity)).toEqual([
			{
				kind: "grant",
				operation: "drop",
				identity,
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("diffs no change for identical privilege sets", () => {
		const previous = grantKind.serialize(allTablesGrant(["select"]));
		const next = grantKind.serialize(allTablesGrant(["select"]));
		expect(
			grantKind.diff(previous, next, "app.all-tables-privileges.service_role"),
		).toEqual([]);
	});

	it("diffs a privilege-set change as a single alter, notes in canonical +/- order", () => {
		const previous = grantKind.serialize(allTablesGrant(["select", "update"]));
		const next = grantKind.serialize(allTablesGrant(["select", "insert"]));
		const identity = "app.all-tables-privileges.service_role";
		expect(grantKind.diff(previous, next, identity)).toEqual([
			{
				kind: "grant",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["+insert", "-update"],
			},
		]);
	});
});

describe("grantKind.emit", () => {
	it("schema-usage: create", () => {
		const next = grantKind.serialize(usageGrant());
		const statements = grantKind.emit({
			kind: "grant",
			operation: "create",
			identity: "app.schema-usage.anon",
			previous: null,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'grant usage on schema "app" to "anon";',
		]);
	});

	it("schema-usage: drop", () => {
		const previous = grantKind.serialize(usageGrant());
		const statements = grantKind.emit({
			kind: "grant",
			operation: "drop",
			identity: "app.schema-usage.anon",
			previous,
			next: null,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'revoke usage on schema "app" from "anon";',
		]);
	});

	it("schema-usage: renders the public role bare", () => {
		const next = grantKind.serialize(usageGrant("public"));
		const statements = grantKind.emit({
			kind: "grant",
			operation: "create",
			identity: "app.schema-usage.public",
			previous: null,
			next,
			notes: [],
		});
		expect(statements[0]?.sql).toBe('grant usage on schema "app" to public;');
	});

	it("all-tables-privileges: create", () => {
		const next = grantKind.serialize(allTablesGrant(["select", "insert"]));
		const statements = grantKind.emit({
			kind: "grant",
			operation: "create",
			identity: "app.all-tables-privileges.service_role",
			previous: null,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'grant select, insert on all tables in schema "app" to "service_role";',
		]);
	});

	it("all-tables-privileges: drop revokes the full previous list", () => {
		const previous = grantKind.serialize(
			allTablesGrant(["select", "insert", "update", "delete"]),
		);
		const statements = grantKind.emit({
			kind: "grant",
			operation: "drop",
			identity: "app.all-tables-privileges.service_role",
			previous,
			next: null,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'revoke select, insert, update, delete on all tables in schema "app" from "service_role";',
		]);
	});

	it("all-tables-privileges: alter emits grant for additions and revoke for removals", () => {
		const previous = grantKind.serialize(allTablesGrant(["select", "update"]));
		const next = grantKind.serialize(allTablesGrant(["select", "insert"]));
		const statements = grantKind.emit({
			kind: "grant",
			operation: "alter",
			identity: "app.all-tables-privileges.service_role",
			previous,
			next,
			notes: ["+insert", "-update"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'grant insert on all tables in schema "app" to "service_role";',
			'revoke update on all tables in schema "app" from "service_role";',
		]);
	});

	it("all-tables-privileges: alter emits only a grant statement when nothing was removed", () => {
		const previous = grantKind.serialize(allTablesGrant(["select"]));
		const next = grantKind.serialize(allTablesGrant(["select", "insert"]));
		const statements = grantKind.emit({
			kind: "grant",
			operation: "alter",
			identity: "app.all-tables-privileges.service_role",
			previous,
			next,
			notes: ["+insert"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'grant insert on all tables in schema "app" to "service_role";',
		]);
	});

	it("default-table-privileges: create", () => {
		const next = grantKind.serialize(defaultPrivilegesGrant(["select"]));
		const statements = grantKind.emit({
			kind: "grant",
			operation: "create",
			identity: "app.default-table-privileges.anon",
			previous: null,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter default privileges in schema "app" grant select on tables to "anon";',
		]);
	});

	it("default-table-privileges: drop revokes the full previous list", () => {
		const previous = grantKind.serialize(
			defaultPrivilegesGrant(["select", "insert"]),
		);
		const statements = grantKind.emit({
			kind: "grant",
			operation: "drop",
			identity: "app.default-table-privileges.anon",
			previous,
			next: null,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter default privileges in schema "app" revoke select, insert on tables from "anon";',
		]);
	});

	it("default-table-privileges: alter mirrors all-tables-privileges with the wrapper", () => {
		const previous = grantKind.serialize(defaultPrivilegesGrant(["select"]));
		const next = grantKind.serialize(defaultPrivilegesGrant(["insert"]));
		const statements = grantKind.emit({
			kind: "grant",
			operation: "alter",
			identity: "app.default-table-privileges.anon",
			previous,
			next,
			notes: ["+insert", "-select"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter default privileges in schema "app" grant insert on tables to "anon";',
			'alter default privileges in schema "app" revoke select on tables from "anon";',
		]);
	});

	it("is registered by createDefaultRegistry, depending on schema", () => {
		expect(registry.get("grant")).toBe(grantKind);
		expect(grantKind.dependsOn).toEqual(["schema"]);
	});
});

describe("grant-set expansion through generateMigration", () => {
	it("fans out to(...) roles into one snapshot entry per role", () => {
		const grantSet = grant(app).usage.to("anon", "authenticated");
		const result = generateMigration({
			declarations: [app, grantSet],
			previousSnapshot: emptySnapshot,
			registry,
		});
		expect(Object.keys(result.snapshot.objects)).toEqual(
			expect.arrayContaining([
				"grant:app.schema-usage.anon",
				"grant:app.schema-usage.authenticated",
			]),
		);
	});

	it("routes duplicate (schema, grantKind, role) through buildSnapshot's duplicate-identity error (D28)", () => {
		const first = allTablesGrant(["select"]);
		const second = allTablesGrant(["insert"]);
		expect(() =>
			buildSnapshot([first, second], registry, emptySnapshot),
		).toThrowError(expect.objectContaining({ code: "duplicate-identity" }));
	});
});

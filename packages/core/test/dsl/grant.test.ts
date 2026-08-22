import { describe, expect, it } from "vitest";
import { grant } from "../../src/dsl/grant";
import { schema } from "../../src/dsl/schema";

const app = schema("app");

describe("grant() — the app schema's grant corpus forms", () => {
	it("grant(schema).usage.to(...) fans out one declaration per role (spec §5.4)", () => {
		const { grants } = grant(app).usage.to("authenticated", "anon");
		expect(grants).toHaveLength(2);
		expect(grants.map((g) => g.role)).toEqual(["authenticated", "anon"]);
		expect(grants.map((g) => g.declarationKind)).toEqual(["grant", "grant"]);
		expect(grants.map((g) => g.grantKind)).toEqual([
			"schema-usage",
			"schema-usage",
		]);
		expect(grants.map((g) => g.schemaName)).toEqual(["app", "app"]);
		expect(grants.map((g) => g.privileges)).toEqual([[], []]);
	});

	it("grant(schema).tables(select).to(role) — a single table privilege", () => {
		const { grants } = grant(app).tables("select").to("anon");
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			grantKind: "all-tables-privileges",
			schemaName: "app",
			privileges: ["select"],
			role: "anon",
		});
	});

	it("grant(schema).tables(...) — full CRUD for one role", () => {
		const { grants } = grant(app)
			.tables("select", "insert", "update", "delete")
			.to("service_role");
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			grantKind: "all-tables-privileges",
			privileges: ["select", "insert", "update", "delete"],
			role: "service_role",
		});
	});

	it("grant(schema).defaultPrivileges.tables(select).to(role)", () => {
		const { grants } = grant(app).defaultPrivileges.tables("select").to("anon");
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			grantKind: "default-table-privileges",
			privileges: ["select"],
			role: "anon",
		});
	});
});

describe("grant() — privilege normalization", () => {
	it("normalizes to canonical order and dedupes, regardless of call order", () => {
		const { grants } = grant(app)
			.tables("delete", "select", "select")
			.to("anon");
		expect(grants[0]?.privileges).toEqual(["select", "delete"]);
	});
});

describe("grant() — errors", () => {
	it("rejects .tables() with zero privileges", () => {
		expect(() => grant(app).tables()).toThrowError(
			expect.objectContaining({ code: "grant-empty-privileges" }),
		);
	});

	it("rejects .defaultPrivileges.tables() with zero privileges", () => {
		expect(() => grant(app).defaultPrivileges.tables()).toThrowError(
			expect.objectContaining({ code: "grant-empty-privileges" }),
		);
	});

	it("rejects .usage.to() with no roles", () => {
		expect(() => grant(app).usage.to()).toThrowError(
			expect.objectContaining({ code: "grant-missing-roles" }),
		);
	});

	it("rejects .tables(...).to() with no roles", () => {
		expect(() => grant(app).tables("select").to()).toThrowError(
			expect.objectContaining({ code: "grant-missing-roles" }),
		);
	});
});

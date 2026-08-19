import { describe, expect, it } from "vitest";
import { grant } from "../../src/dsl/grant";
import { schema } from "../../src/dsl/schema";

const ddland = schema("ddland");

describe("grant() — the dd.land corpus forms", () => {
	it("grant(schema).usage.to(...) fans out one declaration per role (spec §5.4)", () => {
		const { grants } = grant(ddland).usage.to("authenticated", "anon");
		expect(grants).toHaveLength(2);
		expect(grants.map((g) => g.role)).toEqual(["authenticated", "anon"]);
		expect(grants.map((g) => g.declarationKind)).toEqual(["grant", "grant"]);
		expect(grants.map((g) => g.grantKind)).toEqual([
			"schemaUsage",
			"schemaUsage",
		]);
		expect(grants.map((g) => g.schemaName)).toEqual(["ddland", "ddland"]);
		expect(grants.map((g) => g.privileges)).toEqual([[], []]);
	});

	it("grant(schema).tables(select).to(role) — a single table privilege", () => {
		const { grants } = grant(ddland).tables("select").to("anon");
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			grantKind: "allTablesPrivileges",
			schemaName: "ddland",
			privileges: ["select"],
			role: "anon",
		});
	});

	it("grant(schema).tables(...) — full CRUD for one role", () => {
		const { grants } = grant(ddland)
			.tables("select", "insert", "update", "delete")
			.to("service_role");
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			grantKind: "allTablesPrivileges",
			privileges: ["select", "insert", "update", "delete"],
			role: "service_role",
		});
	});

	it("grant(schema).defaultPrivileges.tables(select).to(role)", () => {
		const { grants } = grant(ddland)
			.defaultPrivileges.tables("select")
			.to("anon");
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			grantKind: "defaultTablePrivileges",
			privileges: ["select"],
			role: "anon",
		});
	});
});

describe("grant() — privilege normalization", () => {
	it("normalizes to canonical order and dedupes, regardless of call order", () => {
		const { grants } = grant(ddland)
			.tables("delete", "select", "select")
			.to("anon");
		expect(grants[0]?.privileges).toEqual(["select", "delete"]);
	});
});

describe("grant() — errors", () => {
	it("rejects .tables() with zero privileges", () => {
		expect(() => grant(ddland).tables()).toThrowError(
			expect.objectContaining({ code: "grant-empty-privileges" }),
		);
	});

	it("rejects .defaultPrivileges.tables() with zero privileges", () => {
		expect(() => grant(ddland).defaultPrivileges.tables()).toThrowError(
			expect.objectContaining({ code: "grant-empty-privileges" }),
		);
	});

	it("rejects .usage.to() with no roles", () => {
		expect(() => grant(ddland).usage.to()).toThrowError(
			expect.objectContaining({ code: "grant-missing-roles" }),
		);
	});

	it("rejects .tables(...).to() with no roles", () => {
		expect(() => grant(ddland).tables("select").to()).toThrowError(
			expect.objectContaining({ code: "grant-missing-roles" }),
		);
	});
});

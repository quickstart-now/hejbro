import { describe, expect, it } from "vitest";
import { columnRef, familyOfTypeNode, isExpr } from "../../src/index";

describe("familyOfTypeNode", () => {
	it("maps every structural type to its family", () => {
		expect(familyOfTypeNode({ typeName: "uuid" })).toBe("uuid");
		expect(familyOfTypeNode({ typeName: "text" })).toBe("text");
		expect(familyOfTypeNode({ typeName: "varchar", length: 12 })).toBe("text");
		expect(
			familyOfTypeNode({ typeName: "enum", enumSchema: "s", enumName: "e" }),
		).toBe("text");
		expect(familyOfTypeNode({ typeName: "bigint" })).toBe("numeric");
		expect(
			familyOfTypeNode({ typeName: "numeric", precision: null, scale: null }),
		).toBe("numeric");
		expect(familyOfTypeNode({ typeName: "boolean" })).toBe("boolean");
		expect(familyOfTypeNode({ typeName: "timestamptz" })).toBe("datetime");
		expect(familyOfTypeNode({ typeName: "interval" })).toBe("interval");
		expect(familyOfTypeNode({ typeName: "jsonb" })).toBe("json");
		expect(familyOfTypeNode({ typeName: "bytea" })).toBe("bytea");
		expect(familyOfTypeNode({ typeName: "inet" })).toBe("net");
		expect(
			familyOfTypeNode({ typeName: "array", element: { typeName: "text" } }),
		).toBe("array");
	});
});

describe("columnRef", () => {
	it("builds a ref carrying family, node, and sql name", () => {
		const ref = columnRef("ddland", "posts", "published_at", {
			typeName: "timestamptz",
		});
		expect(ref.family).toBe("datetime");
		expect(ref.sqlName).toBe("published_at");
		expect(ref.exprNode).toEqual({
			nodeKind: "columnRef",
			schemaName: "ddland",
			tableName: "posts",
			columnName: "published_at",
		});
		expect(isExpr(ref)).toBe(true);
		expect(isExpr("published_at")).toBe(false);
	});
});

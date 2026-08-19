import { describe, expect, it } from "vitest";
import { renderTypeNode } from "../src/types/type-node";

describe("renderTypeNode", () => {
	it("renders simple types as-is", () => {
		expect(renderTypeNode({ typeName: "uuid" })).toBe("uuid");
		expect(renderTypeNode({ typeName: "text" })).toBe("text");
		expect(renderTypeNode({ typeName: "serial" })).toBe("serial");
		expect(renderTypeNode({ typeName: "smallserial" })).toBe("smallserial");
		expect(renderTypeNode({ typeName: "bigserial" })).toBe("bigserial");
	});

	it("renders time and timestamp without a zone as-is", () => {
		expect(renderTypeNode({ typeName: "time" })).toBe("time");
		expect(renderTypeNode({ typeName: "timestamp" })).toBe("timestamp");
	});

	it("renders timetz and timestamptz in their canonical (spelled-out) sql form", () => {
		expect(renderTypeNode({ typeName: "timetz" })).toBe("time with time zone");
		expect(renderTypeNode({ typeName: "timestamptz" })).toBe(
			"timestamp with time zone",
		);
	});

	it("renders varchar with and without a length", () => {
		expect(renderTypeNode({ typeName: "varchar", length: null })).toBe(
			"varchar",
		);
		expect(renderTypeNode({ typeName: "varchar", length: 255 })).toBe(
			"varchar(255)",
		);
	});

	it("renders char with a length", () => {
		expect(renderTypeNode({ typeName: "char", length: 1 })).toBe("char(1)");
	});

	it("renders numeric with and without precision/scale", () => {
		expect(
			renderTypeNode({ typeName: "numeric", precision: null, scale: null }),
		).toBe("numeric");
		expect(
			renderTypeNode({ typeName: "numeric", precision: 10, scale: null }),
		).toBe("numeric(10)");
		expect(
			renderTypeNode({ typeName: "numeric", precision: 10, scale: 2 }),
		).toBe("numeric(10,2)");
	});

	it("renders enum as a qualified reference", () => {
		expect(
			renderTypeNode({
				typeName: "enum",
				enumSchema: "app",
				enumName: "status",
			}),
		).toBe('"app"."status"');
	});

	it("renders nested arrays", () => {
		expect(
			renderTypeNode({ typeName: "array", element: { typeName: "text" } }),
		).toBe("text[]");
		expect(
			renderTypeNode({
				typeName: "array",
				element: { typeName: "array", element: { typeName: "integer" } },
			}),
		).toBe("integer[][]");
	});
});

import { describe, expect, expectTypeOf, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { sql } from "../src/expr/sql-template";
import type { ColumnBuilder } from "../src/index";
import {
	bigint,
	bigserial,
	char,
	integer,
	json,
	jsonb,
	numeric,
	serial,
	smallint,
	smallserial,
	text,
	timestamptz,
	uuid,
	varchar,
} from "../src/types/column-builder-factories";

describe("ColumnBuilder immutability", () => {
	it("does not mutate the original builder when chaining", () => {
		const base = text();
		const withNotNull = base.notNull();
		expect(base.columnState.notNull).toBe(false);
		expect(withNotNull.columnState.notNull).toBe(true);
	});

	it("chains multiple modifiers into a single new state", () => {
		const built = text().notNull().unique();
		expect(built.columnState).toEqual({
			typeNode: { typeName: "text" },
			notNull: true,
			primaryKey: false,
			unique: true,
			defaultValue: null,
		});
	});
});

describe("uuid().primaryKey()", () => {
	it("sets primaryKey without implicitly setting notNull (materialized later at serialization)", () => {
		const built = uuid().primaryKey();
		expect(built.columnState.primaryKey).toBe(true);
		expect(built.columnState.typeNode).toEqual({ typeName: "uuid" });
	});
});

describe("defaultRandom", () => {
	it("sets a gen_random_uuid() function call default on a uuid column", () => {
		const built = uuid().defaultRandom();
		expect(built.columnState.defaultValue).toEqual({
			nodeKind: "functionCall",
			schemaName: null,
			functionName: "gen_random_uuid",
			args: [],
		});
	});

	it("throws an actionable error on a non-uuid column", () => {
		expect(() => text().defaultRandom()).toThrowError(/uuid/i);
	});
});

describe("defaultNow", () => {
	it("sets a now() function call default on a timestamp-family column", () => {
		const built = timestamptz().defaultNow();
		expect(built.columnState.defaultValue).toEqual({
			nodeKind: "functionCall",
			schemaName: null,
			functionName: "now",
			args: [],
		});
	});

	it("throws an actionable error on a non-date/time column", () => {
		expect(() => integer().defaultNow()).toThrowError(/date|time/i);
	});
});

describe("default", () => {
	it("sets a numeric literal default value", () => {
		const built = integer().default(42);
		expect(built.columnState.defaultValue).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "number", value: 42 },
		});
	});

	it("sets a string literal default value", () => {
		const built = text().default("hi");
		expect(built.columnState.defaultValue).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "string", value: "hi" },
		});
	});

	it("accepts an expression built via the sql tagged template", () => {
		const built = timestamptz().default(sql`now() + interval '1 day'`);
		expect(built.columnState.defaultValue).toEqual({
			nodeKind: "sqlTemplate",
			chunks: [{ chunkKind: "text", text: "now() + interval '1 day'" }],
		});
	});
});

describe("array", () => {
	it("wraps the current type node in an array node", () => {
		const built = text().array();
		expect(built.columnState.typeNode).toEqual({
			typeName: "array",
			element: { typeName: "text" },
		});
	});

	it("wraps nested arrays", () => {
		const built = integer().array().array();
		expect(built.columnState.typeNode).toEqual({
			typeName: "array",
			element: { typeName: "array", element: { typeName: "integer" } },
		});
	});
});

describe("parameterized factories", () => {
	it("varchar defaults to no length", () => {
		expect(varchar().columnState.typeNode).toEqual({
			typeName: "varchar",
			length: null,
		});
	});
	it("varchar accepts a length", () => {
		expect(varchar({ length: 255 }).columnState.typeNode).toEqual({
			typeName: "varchar",
			length: 255,
		});
	});
	it("char requires a length", () => {
		expect(char({ length: 1 }).columnState.typeNode).toEqual({
			typeName: "char",
			length: 1,
		});
	});
	it("numeric defaults to no precision/scale", () => {
		expect(numeric().columnState.typeNode).toEqual({
			typeName: "numeric",
			precision: null,
			scale: null,
		});
	});
	it("numeric accepts precision and scale", () => {
		expect(numeric({ precision: 10, scale: 2 }).columnState.typeNode).toEqual({
			typeName: "numeric",
			precision: 10,
			scale: 2,
		});
	});
});

describe("column builder type families", () => {
	it("factories carry their postgres type family", () => {
		expectTypeOf(uuid()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" }>
		>();
		// this used to pin `text().notNull()` as *the same type* as `text()`
		// (the exact gap group 3 closes) — it now separates (task 3.2).
		expectTypeOf(text().notNull()).toEqualTypeOf<
			ColumnBuilder<"text", { typeName: "text" } & { notNull: true }>
		>();
		expectTypeOf(timestamptz()).toEqualTypeOf<
			ColumnBuilder<"datetime", { typeName: "timestamptz" }>
		>();
		expectTypeOf(uuid().array()).toEqualTypeOf<
			ColumnBuilder<"array", { typeName: "array" }>
		>();
	});
});

describe("column builder declared type name (D1, R3)", () => {
	const appEnum = pgEnum(schema("app"), "post_status", ["draft", "published"]);

	it("factories carry their declared type name", () => {
		// family alone can't tell `json` and `jsonb` apart — the declared
		// type name is the only thing that can (R3).
		expectTypeOf(json()).toEqualTypeOf<
			ColumnBuilder<"json", { typeName: "json" }>
		>();
		expectTypeOf(jsonb()).toEqualTypeOf<
			ColumnBuilder<"json", { typeName: "jsonb" }>
		>();
		// family alone can't tell `smallint`/`bigint` apart either — both
		// are `"numeric"`.
		expectTypeOf(smallint()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "smallint" }>
		>();
		expectTypeOf(bigint()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "bigint" }>
		>();
		expectTypeOf(uuid()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" }>
		>();
		expectTypeOf(varchar()).toEqualTypeOf<
			ColumnBuilder<"text", { typeName: "varchar" }>
		>();
		expectTypeOf(char({ length: 1 })).toEqualTypeOf<
			ColumnBuilder<"text", { typeName: "char" }>
		>();
		expectTypeOf(numeric()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "numeric" }>
		>();
		expectTypeOf(appEnum.column()).toEqualTypeOf<
			ColumnBuilder<"text", { typeName: "enum" }>
		>();
	});
});

describe("notNull and default are visible in the builder type (D1, task 3.2)", () => {
	it("notNull and default are visible in the builder type", () => {
		// unmodified: neither key present in TMeta.
		expectTypeOf(uuid()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" }>
		>();
		expectTypeOf(uuid().notNull()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" } & { notNull: true }>
		>();
		expectTypeOf(integer().default(1)).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "integer" } & { hasDefault: true }>
		>();
		expectTypeOf(uuid().defaultRandom()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" } & { hasDefault: true }>
		>();
		expectTypeOf(timestamptz().defaultNow()).toEqualTypeOf<
			ColumnBuilder<
				"datetime",
				{ typeName: "timestamptz" } & { hasDefault: true }
			>
		>();
		// chains: both keys accumulate, in either order.
		expectTypeOf(uuid().notNull().defaultRandom()).toEqualTypeOf<
			ColumnBuilder<
				"uuid",
				{ typeName: "uuid" } & { notNull: true } & { hasDefault: true }
			>
		>();
		// primaryKey/unique don't touch TMeta — they stay runtime-only
		// (primaryKey doesn't imply notNull at this layer, see its own
		// tsdoc: "materialized later at serialization").
		expectTypeOf(uuid().primaryKey()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" }>
		>();
		expectTypeOf(text().unique()).toEqualTypeOf<
			ColumnBuilder<"text", { typeName: "text" }>
		>();
	});
});

describe("serial family symmetry", () => {
	it("provides serial, smallserial and bigserial factories", () => {
		expect(serial().columnState.typeNode).toEqual({ typeName: "serial" });
		expect(smallserial().columnState.typeNode).toEqual({
			typeName: "smallserial",
		});
		expect(bigserial().columnState.typeNode).toEqual({ typeName: "bigserial" });
	});
});

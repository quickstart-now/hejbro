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
		// task 3.15: array() now also records the element's declared type name.
		expectTypeOf(uuid().array()).toEqualTypeOf<
			ColumnBuilder<"array", { typeName: "array"; element: "uuid" }>
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
		// unique() doesn't touch TMeta. primaryKey() implies notNull at the
		// type level (task 3.16, mirrors materializeNotNull) even though
		// columnState.notNull itself stays untouched here (see its own
		// tsdoc: "materialized later at serialization").
		expectTypeOf(uuid().primaryKey()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" } & { notNull: true }>
		>();
		expectTypeOf(text().unique()).toEqualTypeOf<
			ColumnBuilder<"text", { typeName: "text" }>
		>();
	});
});

describe("every chain method keeps the meta it was chained onto (D1, task 3.15)", () => {
	it("every chain method keeps the meta it was chained onto", () => {
		// base already carries both flags -- each method below is applied
		// *after* them, so a method that drops accumulation is visible.
		type UuidBaseMeta = { typeName: "uuid" } & { notNull: true } & {
			hasDefault: true;
		};
		const uuidBase = uuid()
			.notNull()
			.default("11111111-1111-1111-1111-111111111111");
		expectTypeOf(uuidBase).toEqualTypeOf<ColumnBuilder<"uuid", UuidBaseMeta>>();

		expectTypeOf(uuidBase.notNull()).toEqualTypeOf<
			ColumnBuilder<"uuid", UuidBaseMeta & { notNull: true }>
		>();
		expectTypeOf(uuidBase.primaryKey()).toEqualTypeOf<
			ColumnBuilder<"uuid", UuidBaseMeta>
		>();
		expectTypeOf(uuidBase.unique()).toEqualTypeOf<
			ColumnBuilder<"uuid", UuidBaseMeta>
		>();
		expectTypeOf(
			uuidBase.default("22222222-2222-2222-2222-222222222222"),
		).toEqualTypeOf<
			ColumnBuilder<"uuid", UuidBaseMeta & { hasDefault: true }>
		>();
		expectTypeOf(uuidBase.defaultRandom()).toEqualTypeOf<
			ColumnBuilder<"uuid", UuidBaseMeta & { hasDefault: true }>
		>();
		// array() replaces typeName (never intersects it) but keeps the
		// accumulated flags and records the element's own declared type name.
		expectTypeOf(uuidBase.array()).toEqualTypeOf<
			ColumnBuilder<
				"array",
				{ readonly notNull: true } & { readonly hasDefault: true } & {
					typeName: "array";
					element: "uuid";
				}
			>
		>();

		// defaultNow() needs a date/time-family base.
		type DatetimeBaseMeta = { typeName: "timestamptz" } & { notNull: true } & {
			hasDefault: true;
		};
		const datetimeBase = timestamptz().notNull().default(new Date(0));
		expectTypeOf(datetimeBase).toEqualTypeOf<
			ColumnBuilder<"datetime", DatetimeBaseMeta>
		>();
		expectTypeOf(datetimeBase.defaultNow()).toEqualTypeOf<
			ColumnBuilder<"datetime", DatetimeBaseMeta & { hasDefault: true }>
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

describe("primary key and serial carry their implied not-null (D1, task 3.16)", () => {
	it("primary key and serial carry their implied not-null", () => {
		// primaryKey() implies notNull at the type level (mirrors
		// materializeNotNull), but columnState.notNull itself is untouched --
		// the runtime side effect stays false unless .notNull() is also
		// called (positive/negative contrast, C12).
		const pk = uuid().primaryKey();
		expectTypeOf(pk).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" } & { notNull: true }>
		>();
		expect(pk.columnState.notNull).toBe(false);

		// serial/smallserial/bigserial imply both notNull and hasDefault --
		// the two rules move together (a serial's nextval() default lives on
		// the synthesized sequence, never on columnState.defaultValue), so
		// dropping hasDefault would wrongly make serial().primaryKey() an
		// insert-required field (3.11).
		expectTypeOf(serial()).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "serial" } & { notNull: true } & { hasDefault: true }
			>
		>();
		expectTypeOf(smallserial()).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "smallserial" } & { notNull: true } & { hasDefault: true }
			>
		>();
		expectTypeOf(bigserial()).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "bigserial" } & { notNull: true } & { hasDefault: true }
			>
		>();
		// columnState itself is untouched by the type-level claim -- same
		// runtime shape a plain (non-implied) column would have.
		expect(serial().columnState).toEqual({
			typeNode: { typeName: "serial" },
			notNull: false,
			primaryKey: false,
			unique: false,
			defaultValue: null,
		});

		// serial().primaryKey() combines both sources of implied notNull --
		// still notNull, still hasDefault, never a contradiction.
		expectTypeOf(serial().primaryKey()).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "serial" } & { notNull: true } & { hasDefault: true } & {
					notNull: true;
				}
			>
		>();

		// a plain (non-serial, non-primary-key) column carries neither flag
		// -- the positive/negative contrast this whole task turns on.
		expectTypeOf(integer()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "integer" }>
		>();
	});
});

import { describe, expect, it } from "vitest";
import {
	bigserial,
	char,
	integer,
	numeric,
	serial,
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
	it("sets a random-uuid default on a uuid column", () => {
		const built = uuid().defaultRandom();
		expect(built.columnState.defaultValue).toEqual({
			defaultKind: "random-uuid",
		});
	});

	it("throws an actionable error on a non-uuid column", () => {
		expect(() => text().defaultRandom()).toThrowError(/uuid/i);
	});
});

describe("defaultNow", () => {
	it("sets a now default on a timestamp-family column", () => {
		const built = timestamptz().defaultNow();
		expect(built.columnState.defaultValue).toEqual({ defaultKind: "now" });
	});

	it("throws an actionable error on a non-date/time column", () => {
		expect(() => integer().defaultNow()).toThrowError(/date|time/i);
	});
});

describe("default", () => {
	it("sets a literal default value", () => {
		const built = integer().default(42);
		expect(built.columnState.defaultValue).toEqual({
			defaultKind: "literal",
			value: 42,
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

describe("serial family symmetry", () => {
	it("provides serial, smallserial and bigserial factories", () => {
		expect(serial().columnState.typeNode).toEqual({ typeName: "serial" });
		expect(smallserial().columnState.typeNode).toEqual({
			typeName: "smallserial",
		});
		expect(bigserial().columnState.typeNode).toEqual({ typeName: "bigserial" });
	});
});

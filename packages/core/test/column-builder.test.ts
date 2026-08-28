import { describe, expect, expectTypeOf, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { sql } from "../src/expr/sql-template";
import type { ColumnBuilder } from "../src/index";
import { tableKind } from "../src/kinds/table-kind";
import { emptySnapshot } from "../src/snapshot/snapshot";
import * as columnBuilderFactories from "../src/types/column-builder-factories";
import {
	bigint,
	bigserial,
	char,
	integer,
	json,
	jsonb,
	numeric,
	real,
	serial,
	smallint,
	smallserial,
	text,
	timestamptz,
	uuid,
	varchar,
} from "../src/types/column-builder-factories";
import type {
	DefaultBigintMode,
	DefaultNumericMode,
} from "../src/types/numeric-mode-defaults";
import {
	DEFAULT_BIGINT_MODE,
	DEFAULT_NUMERIC_MODE,
} from "../src/types/numeric-mode-defaults";
import type { BaseTsType } from "../src/types/ts-type-map";

describe("ColumnBuilder immutability", () => {
	it("does not mutate the original builder when chaining", () => {
		const base = text();
		const withNotNull = base.notNull();
		expect(base.columnState.notNull).toBe(false);
		expect(withNotNull.columnState.notNull).toBe(true);
	});

	it("chains multiple modifiers into a single new state", () => {
		const built = text().notNull().unique();
		// task 3.4: columnState grew a mode field (null for non-numeric-mode
		// columns) -- this is the declaration widening, not an output change.
		expect(built.columnState).toEqual({
			typeNode: { typeName: "text" },
			notNull: true,
			primaryKey: false,
			unique: true,
			defaultValue: null,
			mode: null,
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

describe("notNullElements() (add-array-ergonomics, task 1.1)", () => {
	it("flags columnState.notNullElements on an .array() column", () => {
		const built = text().array().notNullElements();
		expect(built.columnState.notNullElements).toBe(true);
		// the flag alone -- the type node/element are otherwise untouched.
		expect(built.columnState.typeNode).toEqual({
			typeName: "array",
			element: { typeName: "text" },
		});
	});

	it("carries the flag in TMeta", () => {
		expectTypeOf(text().array().notNullElements()).toEqualTypeOf<
			ColumnBuilder<
				"array",
				{ typeName: "array"; element: "text" } & { notNullElements: true }
			>
		>();
	});

	it("calling notNullElements() on a non-array builder does not itself throw -- a bare builder has no column name yet to name in an error", () => {
		// note: the type-level guard (`TFamily extends "array" ? ... : never`)
		// resolves the *return type* to `never` here (`text()`'s `TFamily` is
		// `"text"`), but a call whose result type is `never` still
		// type-checks -- TS's control-flow narrowing doesn't reject the call
		// site itself. The flag is simply carried, unconditionally, on
		// `columnState` -- misuse is caught one step later, at `table()`,
		// the first point a column actually has a name (design decision 3,
		// next test below). Cast back to a concrete `ColumnBuilder` purely
		// to inspect the (real, unconditionally set) runtime `columnState` --
		// the cast is test-only plumbing around `never`, not part of the
		// contract.
		const built = text().notNullElements() as unknown as ColumnBuilder<
			"text",
			{ typeName: "text" } & { notNullElements: true }
		>;
		expect(built.columnState.notNullElements).toBe(true);
		expect(built.columnState.typeNode).toEqual({ typeName: "text" });
	});

	it("table() throws invalid-not-null-elements, naming the offending column, when a non-array column carries the flag", () => {
		const buildMisusedTable = () =>
			table(schema("app"), "posts", {
				id: uuid().primaryKey(),
				title: text().notNullElements(),
			});
		expect(buildMisusedTable).toThrow();
		try {
			buildMisusedTable();
			expect.unreachable("buildMisusedTable() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe(
				"invalid-not-null-elements",
			);
			// the message names the actual (snake_cased) column, not just the
			// error code -- a message that stayed green with the column name
			// deleted would not prove misuse is actually reported (mutation
			// standard).
			expect((error as { message: string }).message).toContain('"title"');
		}
	});
});

describe("generatedAlwaysAs (add-generated-columns, task 1.1)", () => {
	it("records the fragment's node on columnState.generated", () => {
		const built = numeric().generatedAlwaysAs(sql`price * quantity`);
		expect(built.columnState.generated).toEqual({
			nodeKind: "sqlTemplate",
			chunks: [{ chunkKind: "text", text: "price * quantity" }],
		});
	});

	it("never touches columnState.defaultValue -- the two are mutually exclusive", () => {
		const built = integer().generatedAlwaysAs(sql`1 + 1`);
		expect(built.columnState.defaultValue).toBeNull();
	});

	it("does not mutate the original builder", () => {
		const base = numeric();
		const built = base.generatedAlwaysAs(sql`1`);
		expect(base.columnState.generated).toBeUndefined();
		expect(built.columnState.generated).toBeDefined();
	});

	it("carries generated: true in TMeta", () => {
		expectTypeOf(numeric().generatedAlwaysAs(sql`1`)).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "numeric" } & { mode: "string" } & { generated: true }
			>
		>();
	});

	it(".array() carries the generated flag through (ArrayCarriedFlags)", () => {
		expectTypeOf(integer().generatedAlwaysAs(sql`1`).array()).toEqualTypeOf<
			ColumnBuilder<
				"array",
				{ readonly generated: true } & {
					typeName: "array";
					element: "integer";
				}
			>
		>();
	});
});

describe("generatedAlwaysAsIdentity / generatedByDefaultAsIdentity (add-generated-columns, task 1.1)", () => {
	it("records the identity kind with empty options by default", () => {
		expect(integer().generatedAlwaysAsIdentity().columnState.identity).toEqual({
			kind: "always",
			options: {},
		});
		expect(
			bigint().generatedByDefaultAsIdentity().columnState.identity,
		).toEqual({
			kind: "byDefault",
			options: {},
		});
	});

	it("records explicit sequence options verbatim", () => {
		const built = bigint().generatedByDefaultAsIdentity({
			startWith: 1000,
			increment: 2,
			minValue: 1,
			maxValue: 9999,
			cache: 10,
			cycle: true,
		});
		expect(built.columnState.identity).toEqual({
			kind: "byDefault",
			options: {
				startWith: 1000,
				increment: 2,
				minValue: 1,
				maxValue: 9999,
				cache: 10,
				cycle: true,
			},
		});
	});

	it("does not mutate the original builder, and leaves columnState.notNull/defaultValue untouched (D66 mirror -- see the TMeta assertion below for the divergence)", () => {
		const base = integer();
		const built = base.generatedAlwaysAsIdentity();
		expect(base.columnState.identity).toBeUndefined();
		expect(built.columnState.identity).toBeDefined();
		expect(built.columnState.notNull).toBe(false);
		expect(built.columnState.defaultValue).toBeNull();
	});

	it("carries identity kind, notNull, and hasDefault in TMeta (camelCase kind, D57) -- columnState.notNull/defaultValue stay untouched (previous test)", () => {
		expectTypeOf(integer().generatedAlwaysAsIdentity()).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "integer" } & {
					identity: "always";
					notNull: true;
					hasDefault: true;
				}
			>
		>();
		expectTypeOf(smallint().generatedByDefaultAsIdentity()).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "smallint" } & {
					identity: "byDefault";
					notNull: true;
					hasDefault: true;
				}
			>
		>();
	});

	describe("identity methods are integer-family-only at the type level (keyed on typeName, not TFamily)", () => {
		// text is a different family entirely (proves the least -- it would
		// pass even under a mis-keyed family check). real/numeric/serial all
		// share TFamily "numeric" with smallint/integer/bigint -- these three
		// are the near-misses that actually exercise the typeName
		// enumeration: a guard mis-keyed on TFamily would wrongly resolve
		// these to a real ColumnBuilder instead of never. The matching
		// runtime throw for each of these three lives in
		// generated-columns.test.ts (a type assertion alone can't catch a
		// broken *runtime* guard, and vice versa -- both sites are checked
		// independently).
		it("generatedAlwaysAsIdentity resolves to never off the enumeration", () => {
			expectTypeOf(text().generatedAlwaysAsIdentity()).toBeNever();
			expectTypeOf(real().generatedAlwaysAsIdentity()).toBeNever();
			expectTypeOf(numeric().generatedAlwaysAsIdentity()).toBeNever();
			expectTypeOf(serial().generatedAlwaysAsIdentity()).toBeNever();
		});

		it("generatedByDefaultAsIdentity resolves to never off the enumeration", () => {
			expectTypeOf(text().generatedByDefaultAsIdentity()).toBeNever();
			expectTypeOf(real().generatedByDefaultAsIdentity()).toBeNever();
			expectTypeOf(numeric().generatedByDefaultAsIdentity()).toBeNever();
			expectTypeOf(serial().generatedByDefaultAsIdentity()).toBeNever();
		});
	});

	it("calling an identity method on a non-integer builder does not itself throw -- table() is where misuse is caught (design decision 2, generated-columns.test.ts)", () => {
		// mirrors notNullElements' own "never-typed call still runs" note.
		// The cast is test-only plumbing around `never` (property access on a
		// `never`-typed expression is itself a compile error, confirmed
		// against this exact call shape -- unlike a bare `never` VALUE sitting
		// in an object literal, which is allowed because `never` is
		// assignable everywhere), not part of the contract.
		const built =
			real().generatedAlwaysAsIdentity() as unknown as ColumnBuilder<
				"numeric",
				{ typeName: "real" } & { identity: "always" }
			>;
		expect(built.columnState.identity).toEqual({ kind: "always", options: {} });
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
		// task 3.4: bigint()'s resolved mode (default 'bigint') is now part
		// of its declared type name.
		expectTypeOf(bigint()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "bigint" } & { mode: "bigint" }>
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
		// task 3.4: numeric()'s resolved mode (default 'string') likewise.
		expectTypeOf(numeric()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "numeric" } & { mode: "string" }>
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

		// task 3.4: array() must also carry the numeric mode flag, or it
		// silently drops the same way notNull/hasDefault used to (3.15's own
		// bug). bigint({mode}) has no notNull/hasDefault of its own here, so
		// ArrayCarriedFlags's mode branch is the only thing under test.
		expectTypeOf(bigint({ mode: "number" }).array()).toEqualTypeOf<
			ColumnBuilder<
				"array",
				{ readonly mode: "number" } & { typeName: "array"; element: "bigint" }
			>
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
			mode: null,
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

describe("bigint/numeric width modes (D3, task 3.4)", () => {
	it("bigint defaults to bigint mode and accepts an opt-in mode", () => {
		// what the type says.
		expectTypeOf(bigint()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "bigint" } & { mode: "bigint" }>
		>();
		expectTypeOf(bigint({ mode: "number" })).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "bigint" } & { mode: "number" }>
		>();
		expectTypeOf(bigint({ mode: "string" })).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "bigint" } & { mode: "string" }>
		>();
		// what actually gets stored (group 4 reads this at row-mapping time).
		expect(bigint().columnState.mode).toBe("bigint");
		expect(bigint({ mode: "number" }).columnState.mode).toBe("number");
	});

	it("numeric defaults to string mode and accepts an opt-in mode", () => {
		expectTypeOf(numeric()).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "numeric" } & { mode: "string" }>
		>();
		expectTypeOf(numeric({ mode: "number" })).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "numeric" } & { mode: "number" }>
		>();
		expectTypeOf(numeric({ mode: "bigint" })).toEqualTypeOf<
			ColumnBuilder<"numeric", { typeName: "numeric" } & { mode: "bigint" }>
		>();
		expect(numeric().columnState.mode).toBe("string");
		expect(numeric({ mode: "bigint" }).columnState.mode).toBe("bigint");
	});

	it("a non-numeric-mode column stays mode: null", () => {
		expect(uuid().columnState.mode).toBeNull();
		expect(text().columnState.mode).toBeNull();
	});

	describe("default mode constants are structurally shared, not duplicated (#310)", () => {
		it("the type-level default mode and the runtime default mode are the same constant", () => {
			// runtime: bigint()/numeric()'s own default reads DEFAULT_BIGINT_MODE/
			// DEFAULT_NUMERIC_MODE from the shared module.
			expect(bigint().columnState.mode).toBe(DEFAULT_BIGINT_MODE);
			expect(numeric().columnState.mode).toBe(DEFAULT_NUMERIC_MODE);
			// type-level: BaseTsType's no-mode fallback resolves to exactly the
			// same type as explicitly spelling out `mode: DefaultBigintMode` /
			// `mode: DefaultNumericMode` -- proves the fallback derives
			// structurally from the same constant, not a hand-spelled literal
			// that merely happens to still agree. (The default *value* itself
			// -- 'bigint'/'string' -- is already pinned by the describe block
			// above; this is the consistency bond, not a duplicate value pin.)
			expectTypeOf<BaseTsType<{ readonly typeName: "bigint" }>>().toEqualTypeOf<
				BaseTsType<{
					readonly typeName: "bigint";
					readonly mode: DefaultBigintMode;
				}>
			>();
			expectTypeOf<
				BaseTsType<{ readonly typeName: "numeric" }>
			>().toEqualTypeOf<
				BaseTsType<{
					readonly typeName: "numeric";
					readonly mode: DefaultNumericMode;
				}>
			>();
			// the fallback's own resolved type, pinned concretely: severing
			// DefaultBigintMode's `typeof` link to DEFAULT_BIGINT_MODE moves this
			// side alone, which the consistency bond above can't see.
			expectTypeOf<
				BaseTsType<{ readonly typeName: "bigint" }>
			>().toEqualTypeOf<bigint>();
			expectTypeOf<
				BaseTsType<{ readonly typeName: "numeric" }>
			>().toEqualTypeOf<string>();
		});
	});

	// The four invariants a mode-only change must hold (C13-style contrast
	// pair, mirrors 3.5's $type harmlessness proof): mode is compile-time
	// information only, never part of the declared SQL type.
	describe("mode changes nothing at runtime (harmlessness)", () => {
		const buildPosts = (idColumn: ReturnType<typeof bigint>) =>
			table(schema("app"), "posts", { id: idColumn });

		const defaultModePosts = buildPosts(bigint());
		const explicitModePosts = buildPosts(bigint({ mode: "number" }));

		it("columnState differs only in the mode field", () => {
			const defaultState = defaultModePosts.id.exprNode;
			const explicitState = explicitModePosts.id.exprNode;
			// column refs carry no mode themselves (family-only, D1 boundary
			// on expr/ast.ts) -- the real comparison is on the declared
			// columns' own columnState, read back off the table declaration.
			expect(defaultState).toEqual(explicitState);
			const [defaultColumn] = getTableMeta(defaultModePosts).columns;
			const [explicitColumn] = getTableMeta(explicitModePosts).columns;
			expect(defaultColumn?.columnState).toEqual({
				...explicitColumn?.columnState,
				mode: "bigint",
			});
			expect(explicitColumn?.columnState.mode).toBe("number");
		});

		it("generates byte-identical SQL", () => {
			const defaultSql = generateMigration({
				declarations: [schema("app"), getTableMeta(defaultModePosts)],
				previousSnapshot: emptySnapshot,
			}).sql;
			const explicitSql = generateMigration({
				declarations: [schema("app"), getTableMeta(explicitModePosts)],
				previousSnapshot: emptySnapshot,
			}).sql;
			expect(explicitSql).toBe(defaultSql);
			expect(explicitSql).toContain('"id" bigint');
		});

		it("produces a byte-identical snapshot with no mode trace", () => {
			const defaultJson = JSON.stringify(
				tableKind.serialize(getTableMeta(defaultModePosts)),
			);
			const explicitJson = JSON.stringify(
				tableKind.serialize(getTableMeta(explicitModePosts)),
			);
			expect(explicitJson).toBe(defaultJson);
			expect(explicitJson).not.toContain("mode");
		});
	});
});

describe("every factory's mode is accounted for (C19)", () => {
	it("the factory name set matches a hand-maintained list", () => {
		// self-maintaining: adding a new factory to
		// column-builder-factories.ts without updating this list fails here
		// first, instead of silently shipping an unreviewed mode default.
		// Only bigint/numeric carry a NumericMode; every other factory is
		// mode: null (checked directly for uuid/text above; bigint/numeric's
		// own values are checked in their own describe block).
		const knownFactoryNames = [
			"uuid",
			"text",
			"boolean",
			"smallint",
			"integer",
			"bigint",
			"real",
			"doublePrecision",
			"date",
			"time",
			"timetz",
			"timestamp",
			"timestamptz",
			"interval",
			"json",
			"jsonb",
			"bytea",
			"inet",
			"cidr",
			"macaddr",
			"serial",
			"smallserial",
			"bigserial",
			"varchar",
			"char",
			"numeric",
		];
		expect(Object.keys(columnBuilderFactories).sort()).toEqual(
			[...knownFactoryNames].sort(),
		);
	});
});

describe(".$type<T>() jsonb brand (D5, task 3.5)", () => {
	it("brands the type without touching columnState", () => {
		type Payload = { readonly kind: "widget"; readonly count: number };
		const branded = jsonb().$type<Payload>();
		expectTypeOf(branded).toEqualTypeOf<
			ColumnBuilder<"json", { typeName: "jsonb" } & { jsonType: Payload }>
		>();
		// runtime identity: same columnState as the unbranded column.
		expect(branded.columnState).toEqual(jsonb().columnState);
	});

	it("$type leaves the declaration byte-identical", () => {
		type Payload = { readonly kind: "widget" };
		const buildWidgets = (
			payload: ReturnType<typeof jsonb>,
		): ReturnType<typeof table> =>
			table(schema("app"), "widgets", { id: uuid().primaryKey(), payload });

		const unbranded = buildWidgets(jsonb());
		const branded = buildWidgets(jsonb().$type<Payload>());

		// columnState differs not at all -- $type carries no runtime payload.
		const [, unbrandedPayload] = getTableMeta(unbranded).columns;
		const [, brandedPayload] = getTableMeta(branded).columns;
		expect(brandedPayload?.columnState).toEqual(unbrandedPayload?.columnState);

		const unbrandedSql = generateMigration({
			declarations: [schema("app"), getTableMeta(unbranded)],
			previousSnapshot: emptySnapshot,
		}).sql;
		const brandedSql = generateMigration({
			declarations: [schema("app"), getTableMeta(branded)],
			previousSnapshot: emptySnapshot,
		}).sql;
		expect(brandedSql).toBe(unbrandedSql);
		expect(brandedSql).toContain('"payload" jsonb');

		const unbrandedJson = JSON.stringify(
			tableKind.serialize(getTableMeta(unbranded)),
		);
		const brandedJson = JSON.stringify(
			tableKind.serialize(getTableMeta(branded)),
		);
		expect(brandedJson).toBe(unbrandedJson);
		// "kind" only ever appears in Payload's own field name, never in a
		// snapshot key/value -- a real leak would introduce it.
		expect(brandedJson).not.toContain("kind");
	});

	it("$type narrows only -- it can't lie past the column's own base type (backlog 7)", () => {
		// negative control (owner-specified): a base-`number` column can't
		// brand as `string` -- our safety difference from Drizzle's
		// unconstrained $type<T>().
		// @ts-expect-error integer's base type is number, not string
		integer().$type<string>();

		// positive controls, one difference each from the negative case
		// above (C12): a real narrowing of the column's own base type.
		type UserId = string & { readonly __brand: "UserId" };
		expectTypeOf(uuid().$type<UserId>()).toEqualTypeOf<
			ColumnBuilder<"uuid", { typeName: "uuid" } & { jsonType: UserId }>
		>();
		expectTypeOf(text().$type<"draft" | "published">()).toEqualTypeOf<
			ColumnBuilder<
				"text",
				{ typeName: "text" } & { jsonType: "draft" | "published" }
			>
		>();
		// json/jsonb's own base is `unknown` -- every type is a subset of
		// `unknown`, so they stay unconstrained in practice without this
		// file (or column-builder.ts's $type signature) special-casing
		// them; see $type's own tsdoc for the one-rule argument.
		type Payload = { readonly kind: "widget" };
		expectTypeOf(jsonb().$type<Payload>()).toEqualTypeOf<
			ColumnBuilder<"json", { typeName: "jsonb" } & { jsonType: Payload }>
		>();
	});

	it("array() carries the jsonb brand through (task 3.4/3.5 ArrayCarriedFlags pattern)", () => {
		type Payload = { readonly kind: "widget" };
		expectTypeOf(jsonb().$type<Payload>().array()).toEqualTypeOf<
			ColumnBuilder<
				"array",
				{ readonly jsonType: Payload } & {
					typeName: "array";
					element: "jsonb";
				}
			>
		>();
	});
});

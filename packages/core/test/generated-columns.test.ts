import { describe, expect, expectTypeOf, it } from "vitest";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { sql } from "../src/expr/sql-template";
import type { ColumnBuilder } from "../src/types/column-builder";
import {
	bigint,
	integer,
	numeric,
	real,
	serial,
	smallint,
	text,
	uuid,
} from "../src/types/column-builder-factories";

/**
 * task 1.2 (add-generated-columns): `table()`'s own misuse validation for
 * the generated/identity trio (design decision 2, four guards, fixed
 * order 1->2->3->4) -- one column-name-bearing error at a time, mirroring
 * not-null-elements.test.ts's own table()-throws shape. Each throw
 * assertion checks four things: the code, the table name, the column
 * name, and the literal "Next:" -- deleting the column name from the
 * message would otherwise leave a green suite (mutation standard, see
 * column-builder.test.ts's own notNullElements precedent).
 */

describe("generated/identity misuse at table() (add-generated-columns, task 1.2)", () => {
	it("guard 1: throws invalid-identity-column when identity is declared on a non-integer column", () => {
		const buildMisusedTable = () =>
			table(schema("app"), "widgets", {
				id: uuid().primaryKey(),
				count: real().generatedAlwaysAsIdentity(),
			});
		expect(buildMisusedTable).toThrow();
		try {
			buildMisusedTable();
			expect.unreachable("buildMisusedTable() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("invalid-identity-column");
			expect((error as { message: string }).message).toContain('"widgets"');
			expect((error as { message: string }).message).toContain('"count"');
			expect((error as { message: string }).message).toContain("Next:");
		}
	});

	it("guard 2: throws invalid-generated-identity when generated is combined with identity", () => {
		const buildMisusedTable = () =>
			table(schema("app"), "widgets", {
				id: uuid().primaryKey(),
				seq: integer().generatedAlwaysAsIdentity().generatedAlwaysAs(sql`1`),
			});
		expect(buildMisusedTable).toThrow();
		try {
			buildMisusedTable();
			expect.unreachable("buildMisusedTable() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe(
				"invalid-generated-identity",
			);
			expect((error as { message: string }).message).toContain('"widgets"');
			expect((error as { message: string }).message).toContain('"seq"');
			expect((error as { message: string }).message).toContain("Next:");
		}
	});

	it("guard 2: is caught the same way regardless of chaining order (identity method called after generatedAlwaysAs)", () => {
		const buildMisusedTable = () =>
			table(schema("app"), "widgets", {
				id: uuid().primaryKey(),
				seq: bigint().generatedAlwaysAs(sql`1`).generatedByDefaultAsIdentity(),
			});
		expect(buildMisusedTable).toThrow();
		try {
			buildMisusedTable();
			expect.unreachable("buildMisusedTable() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe(
				"invalid-generated-identity",
			);
		}
	});

	it("guard 3: throws invalid-generated-default when generated is combined with .default()", () => {
		const buildMisusedTable = () =>
			table(schema("app"), "widgets", {
				id: uuid().primaryKey(),
				total: numeric().generatedAlwaysAs(sql`1`).default(1),
			});
		expect(buildMisusedTable).toThrow();
		try {
			buildMisusedTable();
			expect.unreachable("buildMisusedTable() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe(
				"invalid-generated-default",
			);
			expect((error as { message: string }).message).toContain('"widgets"');
			expect((error as { message: string }).message).toContain('"total"');
			expect((error as { message: string }).message).toContain("Next:");
		}
	});

	it("guard 4: throws invalid-identity-default when an identity method is combined with .default()", () => {
		const buildMisusedTable = () =>
			table(schema("app"), "widgets", {
				id: uuid().primaryKey(),
				seq: integer().generatedAlwaysAsIdentity().default(1),
			});
		expect(buildMisusedTable).toThrow();
		try {
			buildMisusedTable();
			expect.unreachable("buildMisusedTable() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("invalid-identity-default");
			expect((error as { message: string }).message).toContain('"widgets"');
			expect((error as { message: string }).message).toContain('"seq"');
			expect((error as { message: string }).message).toContain("Next:");
		}
	});

	it("precedence: a column violating guard 1 and guard 4 at once reports guard 1's code (wrong type is checked before the default clash)", () => {
		const buildMisusedTable = () =>
			table(schema("app"), "widgets", {
				id: uuid().primaryKey(),
				// .default(1) runs first, on a plain (non-never) real() builder --
				// LiftableFor<"numeric"> accepts the number. .generatedAlwaysAsIdentity()
				// comes last, so its `never` return type (real() is outside the
				// integer enumeration) is only ever produced in *value* position
				// here (assignable to ColumnBuilder in the object literal below),
				// never chained onto -- no cast needed, unlike the reverse
				// ordering (chaining .default() onto an already-`never` identity
				// call is itself a compile error; confirmed via tsc). The built
				// column ends up with BOTH `identity` (guard 1: wrong type) AND a
				// non-null `defaultValue` (guard 4: identity + default) set on
				// columnState -- guard 1 must win, per the fixed 1->2->3->4 order.
				count: real().default(1).generatedAlwaysAsIdentity(),
			});
		expect(buildMisusedTable).toThrow();
		try {
			buildMisusedTable();
			expect.unreachable("buildMisusedTable() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("invalid-identity-column");
			expect((error as { message: string }).message).toContain('"widgets"');
			expect((error as { message: string }).message).toContain('"count"');
			expect((error as { message: string }).message).toContain("Next:");
		}
	});

	describe("the integer enumeration excludes the serial family too (guard 1 runtime check, keyed on typeName -- see column-builder.ts's own tsdoc)", () => {
		it("generatedAlwaysAsIdentity on real/numeric/serial all throw invalid-identity-column", () => {
			const buildWithReal = () =>
				table(schema("app"), "widgets", {
					count: real().generatedAlwaysAsIdentity(),
				});
			const buildWithNumeric = () =>
				table(schema("app"), "widgets", {
					count: numeric().generatedAlwaysAsIdentity(),
				});
			const buildWithSerial = () =>
				table(schema("app"), "widgets", {
					count: serial().generatedAlwaysAsIdentity(),
				});
			[buildWithReal, buildWithNumeric, buildWithSerial].forEach(
				(buildMisusedTable) => {
					expect(buildMisusedTable).toThrow();
					try {
						buildMisusedTable();
						expect.unreachable("buildMisusedTable() should have thrown");
					} catch (error) {
						expect((error as { code: string }).code).toBe(
							"invalid-identity-column",
						);
					}
				},
			);
		});

		it("generatedByDefaultAsIdentity on real/numeric/serial all throw invalid-identity-column", () => {
			const buildWithReal = () =>
				table(schema("app"), "widgets", {
					count: real().generatedByDefaultAsIdentity(),
				});
			const buildWithNumeric = () =>
				table(schema("app"), "widgets", {
					count: numeric().generatedByDefaultAsIdentity(),
				});
			const buildWithSerial = () =>
				table(schema("app"), "widgets", {
					count: serial().generatedByDefaultAsIdentity(),
				});
			[buildWithReal, buildWithNumeric, buildWithSerial].forEach(
				(buildMisusedTable) => {
					expect(buildMisusedTable).toThrow();
					try {
						buildMisusedTable();
						expect.unreachable("buildMisusedTable() should have thrown");
					} catch (error) {
						expect((error as { code: string }).code).toBe(
							"invalid-identity-column",
						);
					}
				},
			);
		});
	});

	it("implied flags: an identity column's TMeta carries notNull/hasDefault, while columnState.notNull/defaultValue stay untouched (D66 mirror -- serial's own divergence)", () => {
		const idBuilder = integer().generatedAlwaysAsIdentity();
		expectTypeOf(idBuilder).toEqualTypeOf<
			ColumnBuilder<
				"numeric",
				{ typeName: "integer" } & {
					identity: "always";
					notNull: true;
					hasDefault: true;
				}
			>
		>();

		// the divergence itself, asserted on the built table's own column entry
		// -- both halves matter: the type claim above, and the runtime state it
		// deliberately does not touch (mirrors primaryKey()/serial's own tsdoc).
		const built = table(schema("app"), "widgets", { id: idBuilder });
		const [column] = getTableMeta(built).columns;
		expect(column?.columnState.notNull).toBe(false);
		expect(column?.columnState.defaultValue).toBeNull();
	});

	it("happy path (positive control): a valid identity column, a valid by-default identity column (with options), and a valid generated column all build without throwing, and guard 4 does not fire on either identity column", () => {
		// R11: guard 4 keys on columnState.defaultValue !== null at runtime
		// (TMeta doesn't exist at runtime) -- if the identity setters ever
		// started writing columnState.defaultValue to express the implied
		// hasDefault, every identity column would trip guard 4 and this table
		// would throw. The four misuse tests above only prove throwing
		// happens; only this positive control would catch that regression.
		const built = table(schema("app"), "widgets", {
			id: integer().generatedAlwaysAsIdentity(),
			seq: smallint().generatedByDefaultAsIdentity({ startWith: 1 }),
			total: numeric().generatedAlwaysAs(sql`1`),
			label: text(),
		});
		expect(built).toBeTruthy();

		const [idColumn, seqColumn] = getTableMeta(built).columns;
		expect(idColumn?.columnState.defaultValue).toBeNull();
		expect(idColumn?.columnState.notNull).toBe(false);
		expect(seqColumn?.columnState.defaultValue).toBeNull();
		expect(seqColumn?.columnState.notNull).toBe(false);
	});
});

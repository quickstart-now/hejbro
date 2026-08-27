import { bigint, numeric, schema, table } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { InsertInput } from "../../src/types/insert-input";
import type { ReturningRow } from "../../src/types/returning";
import type { SelectResult } from "../../src/types/select-result";

/**
 * #338's inline-inference collapse (`packages/core/test/inline-inference
 * .test.ts`, the **core frame** -- no nullability) propagates into every
 * user-facing surface that reads a table's own `TColumns` type parameter:
 * `SelectResult`, `ReturningRow` (whole-table path), and `InsertInput`
 * (the write-acceptance side). This file is the **query frame**:
 * `SelectResult<typeof t>["c"]` adds `| null` on top of the core frame's
 * own resolved type, unless the column is `notNull` -- the two frames are
 * never interchangeable, and mixing them in one table is exactly the
 * mistake hg2's own characterization matrix made (a broken row carrying
 * `| null`, a correct row missing it, read side by side as if comparable).
 *
 * One root cause (core's `bigint`/`numeric` factories), not three
 * independent bugs: a fix there must turn every assertion below green
 * together, with zero changes in this package. If only some go green,
 * the root cause wasn't singular -- stop and report immediately.
 *
 * Every `it` states whether it is expected red or green **before** this
 * task's fix lands.
 */

const app = schema("app");

describe("inline factory inference propagates through query's own surfaces (#338)", () => {
	describe("SelectResult (query frame -- includes nullability)", () => {
		it("inline, bare bigint() -- RED until fixed: bigint | null expected, collapses to string|number|bigint|null today", () => {
			const t = table(app, "t_select_bigint_bare", { c: bigint() });
			expectTypeOf<SelectResult<typeof t>["c"]>().toEqualTypeOf<
				bigint | null
			>();
		});

		it("inline, empty-object bigint({}) -- RED until fixed: same collapse as bare", () => {
			const t = table(app, "t_select_bigint_empty", { c: bigint({}) });
			expectTypeOf<SelectResult<typeof t>["c"]>().toEqualTypeOf<
				bigint | null
			>();
		});

		it("inline, bare numeric() -- RED until fixed: string | null expected, collapses today", () => {
			const t = table(app, "t_select_numeric_bare", { c: numeric() });
			expectTypeOf<SelectResult<typeof t>["c"]>().toEqualTypeOf<
				string | null
			>();
		});

		it("inline, empty-object numeric({}) -- RED until fixed: same collapse as bare", () => {
			const t = table(app, "t_select_numeric_empty", { c: numeric({}) });
			expectTypeOf<SelectResult<typeof t>["c"]>().toEqualTypeOf<
				string | null
			>();
		});

		it("const-first -- GREEN today, must stay green (no regression)", () => {
			const b = bigint();
			const t = table(app, "t_select_const_first", { c: b });
			expectTypeOf<SelectResult<typeof t>["c"]>().toEqualTypeOf<
				bigint | null
			>();
		});

		it("inline, chained .notNull() -- GREEN today, must stay green (hg2's own workaround shape); nullability itself must NOT be touched by the fix -- no | null here, exactly as today", () => {
			const t = table(app, "t_select_notnull", { c: bigint().notNull() });
			expectTypeOf<SelectResult<typeof t>["c"]>().toEqualTypeOf<bigint>();
		});

		it("inline, chained .unique() -- GREEN today, must stay green; pins that the fix does NOT accidentally narrow nullability on a non-notNull chained column (bigint | null, same as bare would be once fixed)", () => {
			const t = table(app, "t_select_unique", { c: bigint().unique() });
			expectTypeOf<SelectResult<typeof t>["c"]>().toEqualTypeOf<
				bigint | null
			>();
		});
	});

	describe("ReturningRow (whole-table path) -- propagation axis", () => {
		it("inline, bare -- RED until fixed", () => {
			const t = table(app, "t_returning_inline", { bigCol: bigint() });
			expectTypeOf<ReturningRow<typeof t, undefined>["bigCol"]>().toEqualTypeOf<
				bigint | null
			>();
		});
	});

	describe("InsertInput -- propagation axis", () => {
		it("inline, bare -- RED until fixed", () => {
			const t = table(app, "t_insert_inline", { numCol: numeric() });
			expectTypeOf<InsertInput<typeof t>["numCol"]>().toEqualTypeOf<
				string | null | undefined
			>();
		});
	});
});

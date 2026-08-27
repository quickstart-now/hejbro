import { bigint, numeric, schema, table } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { InsertInput } from "../../src/types/insert-input";
import type { ReturningRow } from "../../src/types/returning";
import type { SelectResult } from "../../src/types/select-result";

/**
 * #338's inline-inference collapse (`packages/core/test/inline-inference
 * .test.ts`) is a single root cause in `table()`'s own generic inference,
 * not three independent bugs -- it propagates structurally into every
 * user-facing surface that reads a table's own `TColumns` type parameter:
 * `SelectResult`, `ReturningRow` (whole-table path), and `InsertInput`
 * (the write-acceptance side). A fix at the root (`bigint`/`numeric`'s own
 * factories, core) must turn all three of these green together with no
 * change in this package at all -- if only some of them turn green, the
 * root cause wasn't actually singular and that's a signal to stop and
 * report, not to patch here too.
 */

const app = schema("app");

describe("inline factory inference propagates through query's own surfaces (#338)", () => {
	it("SelectResult -- RED until core's fix lands: bare inline bigint()/numeric() widen to the full NumericMode union today", () => {
		const t = table(app, "t_select_inline", {
			bigCol: bigint(),
			numCol: numeric(),
		});
		expectTypeOf<SelectResult<typeof t>["bigCol"]>().toEqualTypeOf<
			bigint | null
		>();
		expectTypeOf<SelectResult<typeof t>["numCol"]>().toEqualTypeOf<
			string | null
		>();
	});

	it("SelectResult -- GREEN today, must stay green (const-first/chained/explicit-mode all already correct)", () => {
		const bigCol = bigint();
		const t = table(app, "t_select_control", {
			bigCol,
			numCol: numeric().notNull(),
			bigExplicit: bigint({ mode: "bigint" }),
		});
		expectTypeOf<SelectResult<typeof t>["bigCol"]>().toEqualTypeOf<
			bigint | null
		>();
		expectTypeOf<SelectResult<typeof t>["numCol"]>().toEqualTypeOf<string>();
		expectTypeOf<SelectResult<typeof t>["bigExplicit"]>().toEqualTypeOf<
			bigint | null
		>();
	});

	it("ReturningRow (whole-table path) -- RED until core's fix lands", () => {
		const t = table(app, "t_returning_inline", { bigCol: bigint() });
		expectTypeOf<ReturningRow<typeof t, undefined>["bigCol"]>().toEqualTypeOf<
			bigint | null
		>();
	});

	it("InsertInput -- RED until core's fix lands", () => {
		const t = table(app, "t_insert_inline", { numCol: numeric() });
		expectTypeOf<InsertInput<typeof t>["numCol"]>().toEqualTypeOf<
			string | null | undefined
		>();
	});
});

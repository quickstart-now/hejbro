import { describe, expect, it } from "vitest";
/**
 * Type-only presence check for the query-layer surface the facade must
 * carry (task 7.9, group 7 decision ①) -- a `tsc` error at this import if
 * any name is missing, never a silent gap a runtime-only assertion could
 * catch (a `export type` name never produces a runtime binding).
 */
import type { Db, DbContext, ExecuteResult, ScopedDb, Tx } from "../src/index";
import * as hejbro from "../src/index";

/** Referenced so the type-only import block above isn't flagged unused. */
type _QueryTypesPresent = [Db, DbContext, ExecuteResult<never>, ScopedDb, Tx];

describe("hejbro facade (task 7.9)", () => {
	it("exports db from @hejbro/query", () => {
		expect(typeof hejbro.db).toBe("function");
	});

	it("exports exactly one sql -- the dual-use one from @hejbro/query, not core's own", () => {
		expect(typeof hejbro.sql).toBe("function");
		// query's dual-use `sql` carries `.identifier` (task 2.6/7.1) --
		// core's own `sql` (packages/core/src/expr/sql-template.ts) never
		// did. This is the one runtime-observable difference between the
		// two candidate `sql`s, so asserting it present is the same as
		// asserting the facade re-exports query's, not core's.
		expect(typeof hejbro.sql.identifier).toBe("function");
		expect(typeof hejbro.sql.raw).toBe("function");
	});

	it("fragment uses of the old sql still type-check -- index().on(sql`...`) and check(name, sql`...`)", () => {
		const app = hejbro.schema("app_exports_test");
		const members = hejbro.table(
			app,
			"members",
			{
				id: hejbro.uuid().primaryKey(),
				email: hejbro.text().notNull(),
			},
			(t) => ({
				indexes: [
					hejbro
						.index("members_email_lower_idx")
						.on(hejbro.sql`lower(${t.email})`),
				],
				checks: [
					hejbro.check(
						"members_email_not_blank",
						hejbro.sql`length(btrim(${t.email})) > 0`,
					),
				],
			}),
		);

		expect(members).toBeDefined();
	});
});

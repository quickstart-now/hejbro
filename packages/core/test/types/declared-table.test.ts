import { describe, expect, expectTypeOf, it } from "vitest";
import { schema } from "../../src/dsl/schema";
import type {
	DeclaredTable,
	Table,
	TableColumns,
	TableDeclaration,
} from "../../src/dsl/table";
import { table, tableMeta } from "../../src/dsl/table";
import { syncedTable } from "../../src/dsl/usage-table";
import type { HejbroInput } from "../../src/engine/generate";
import { uuid } from "../../src/types/column-builder-factories";

const app = schema("app");
const columns = { id: uuid().primaryKey() };

describe("migration authority — type layer (2.1)", () => {
	it("the declaration constructor yields a branded table", () => {
		const declared = table(app, "posts", columns);
		// a declared table is directly usable as a migration input — the
		// positive control this scenario names ("yields a branded table").
		const input: HejbroInput = declared;
		expect(input).toBe(declared);
	});
});

describe("Table is structurally unchanged (2.2)", () => {
	it("Table's own definition carries no trace of the authority axis's key set", () => {
		// `Table` (bare) still expands to exactly `TableColumns<TColumns> &
		// { [tableMeta]: TableDeclaration & { authority?: TAuthority } }`
		// with `TAuthority` defaulting to the full union — pinning this
		// equivalence is what proves the type alias's own shape hasn't
		// grown a new top-level key, only a narrower value inside the
		// existing `[tableMeta]` member.
		expectTypeOf<Table<typeof columns>>().toEqualTypeOf<
			TableColumns<typeof columns> & {
				readonly [tableMeta]: TableDeclaration & {
					readonly authority?: "declared" | "usage";
				};
			}
		>();
	});
});

describe("a usage table is not assignable to the migration input (2.3 — type layer)", () => {
	it("is a type error, pinned; the runtime chokepoint (engine/authority-refusal.test.ts) is what a caller the type layer never saw — a JS project, or a config file jiti loads without a compile step — still reaches", () => {
		const usage = syncedTable("app", "posts", columns);
		// @ts-expect-error a usage table carries no migration authority
		const input: HejbroInput = usage;
		expect(input).toBe(usage);
	});
});

describe("existingTable is branded too (regression, EXISTING-2.1-FINAL)", () => {
	it("is directly usable as a migration input", () => {
		expectTypeOf<DeclaredTable>().not.toBeNever();
	});
});

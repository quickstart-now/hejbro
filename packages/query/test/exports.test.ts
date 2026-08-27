import { describe, expect, it } from "vitest";
/**
 * Type-only import list (task 7.8's agreed export list) -- exists purely
 * so a missing/renamed type export is a `tsc` error at this very import
 * statement, not a silent gap a runtime-only assertion could never catch
 * (a `export type` name never produces a runtime binding `Object.keys`
 * could see). Every name here must resolve for this file to compile at
 * all; that's the presence half of "matches the agreed list".
 */
import type {
	ChainApi,
	CompileInput,
	CompileKind,
	CompileResult,
	Db,
	DbContext,
	DbOptions,
	Declarations,
	DeleteChainFilterable,
	DeleteChainFinal,
	DeleteChainReturnable,
	Driver,
	DriverCapabilities,
	DriverCapabilityKey,
	DriverRow,
	DriverSession,
	ExecuteResult,
	InsertChainConflictable,
	InsertChainFinal,
	InsertChainReturnable,
	ReturningRow,
	Schema,
	ScopedDb,
	SelectChainFiltered,
	SelectChainJoinable,
	SelectChainLimited,
	SelectChainOrdered,
	SelectResult,
	SqlExpr,
	Tx,
	UpdateChainFilterable,
	UpdateChainFinal,
	UpdateChainReturnable,
} from "../src/index";
import * as barrel from "../src/index";

/** Referenced so the type-only import block above isn't flagged unused -- every listed name is a real presence assertion, not decoration. */
type _AgreedTypesPresent = [
	ChainApi,
	CompileInput,
	CompileKind,
	CompileResult,
	Db,
	DbContext,
	DbOptions,
	Declarations,
	DeleteChainFilterable,
	DeleteChainFinal,
	DeleteChainReturnable,
	Driver,
	DriverCapabilities,
	DriverCapabilityKey,
	DriverRow,
	DriverSession,
	ExecuteResult<never>,
	InsertChainConflictable,
	InsertChainFinal,
	InsertChainReturnable,
	ReturningRow<never>,
	Schema,
	ScopedDb,
	SelectChainFiltered,
	SelectChainJoinable,
	SelectChainLimited,
	SelectChainOrdered,
	SelectResult<never>,
	SqlExpr,
	Tx,
	UpdateChainFilterable,
	UpdateChainFinal,
	UpdateChainReturnable,
];

// @ts-expect-error "ColumnPlanEntry" is db/convert.ts's test-only conversion internal -- must never reach the public barrel.
import type { ColumnPlanEntry } from "../src/index";

/** Gives the probe import above a real reference, so it reads as an assertion rather than dead code -- if `ColumnPlanEntry` ever did resolve, this alias would too, and the `@ts-expect-error` above would then report "unused directive" (checked during implementation, see the group's commit history). */
type _ColumnPlanEntryNeverReExported = ColumnPlanEntry;

describe("@hejbro/query public barrel (task 7.8)", () => {
	it("exposes exactly the agreed runtime value exports -- db, compile, sql", () => {
		expect(Object.keys(barrel).sort()).toEqual(["compile", "db", "sql"]);
	});

	it("never re-exports the test-only conversion internals (db/convert.ts)", () => {
		expect(barrel).not.toHaveProperty("resolveColumnState");
		expect(barrel).not.toHaveProperty("columnPlanForResult");
		expect(barrel).not.toHaveProperty("convertRow");
		// `ColumnPlanEntry` is a type (no runtime binding to probe here) --
		// its absence is the `@ts-expect-error` import above, checked by
		// `pnpm check-types`, not by this runtime assertion.
	});
});

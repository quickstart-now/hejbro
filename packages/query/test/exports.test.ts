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
	ContextProvider,
	ContextRendering,
	ContractColumnMeta,
	ContractForeignKeyMeta,
	ContractMetadata,
	ContractTableMeta,
	DatabaseShape,
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
	NameKeyedDb,
	NameKeyedTableClient,
	NameKeyedTables,
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
	WithChainTerminal,
} from "../src/index";
import * as barrel from "../src/index";

/** Referenced so the type-only import block above isn't flagged unused -- every listed name is a real presence assertion, not decoration. */
type _TestDatabaseShape = {
	readonly Tables: {
		readonly posts: {
			readonly Row: unknown;
			readonly Insert: unknown;
			readonly Update: unknown;
		};
	};
};

type _AgreedTypesPresent = [
	ChainApi,
	CompileInput,
	CompileKind,
	CompileResult,
	ContextProvider,
	ContextRendering,
	ContractColumnMeta,
	ContractForeignKeyMeta,
	ContractMetadata,
	ContractTableMeta,
	DatabaseShape,
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
	NameKeyedDb<_TestDatabaseShape>,
	NameKeyedTableClient<_TestDatabaseShape["Tables"]["posts"]>,
	NameKeyedTables<_TestDatabaseShape>,
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
	WithChainTerminal<never>,
];

// @ts-expect-error "ColumnPlanEntry" is db/convert.ts's test-only conversion internal -- must never reach the public barrel.
import type { ColumnPlanEntry } from "../src/index";

/** Gives the probe import above a real reference, so it reads as an assertion rather than dead code -- if `ColumnPlanEntry` ever did resolve, this alias would too, and the `@ts-expect-error` above would then report "unused directive" (checked during implementation, see the group's commit history). */
type _ColumnPlanEntryNeverReExported = ColumnPlanEntry;

/**
 * Assertion-spec cross-check (not just "this test binds something"):
 * `src/index.ts`'s own header comment states both halves this describe
 * block checks -- the agreed export list (chain types, `compile`, `sql`,
 * driver-contract types, `DbContext`/`ScopedDb`/`Tx`, result types) and
 * "the test-only conversion internals ... are never re-exported here".
 * The exact-match assertion below is `Object.keys(barrel)` against that
 * same three-name value list (`compile`/`db`/`sql`) the header and task
 * 7.8's own body name; the named absence checks are the header's second
 * sentence, spelled out per name rather than left implicit. Neither
 * assertion targets a behavior the implementation merely happens to have
 * -- both are the header's own words, restated as assertions.
 */
describe("@hejbro/query public barrel (task 7.8)", () => {
	it("exposes exactly the agreed runtime value exports -- db, compile, sql, throwMissingCapability, defaultContextRendering, createNameKeyedDb", () => {
		// Exact-set equality (not just "contains") -- the task's own
		// contract is "matches the agreed list": this fails just as hard
		// on an accidental future *addition* (e.g. a stray `convertRows`
		// leak) as it does on one of the agreed names going missing.
		expect(Object.keys(barrel).sort()).toEqual([
			"compile",
			"createNameKeyedDb",
			"db",
			"defaultContextRendering",
			"sql",
			"throwMissingCapability",
		]);
	});

	it("the default context rendering is exported (#554/#555 review F1 -- reachable by a driver package at the public entry, never a deep import)", () => {
		expect(typeof barrel.defaultContextRendering).toBe("function");
		// role-less input, no settings -- the empty-array shape a role-less
		// platform's own composed rendering depends on being able to see.
		expect(barrel.defaultContextRendering({})).toEqual([]);
	});

	it("the missing-capability thrower is exported (#490 -- presets construct, never copy, the user-facing text)", () => {
		expect(typeof barrel.throwMissingCapability).toBe("function");
		expect(() =>
			barrel.throwMissingCapability("session-state", "setupSession"),
		).toThrowError(/session-state/);
	});

	it("never re-exports the test-only conversion internals (db/convert.ts) -- named absence, redundant with the exact-match above on purpose (one loosening independently of the other still fails)", () => {
		expect(barrel).not.toHaveProperty("resolveColumnState");
		expect(barrel).not.toHaveProperty("columnPlanForResult");
		// singular `convertRow` (db/convert.ts:331) -- never `convertRows`
		// (db/convert.ts:344, the one `execute.ts` actually calls); the two
		// names differ by one letter and only the singular is the task's
		// named test-only internal.
		expect(barrel).not.toHaveProperty("convertRow");
		// `ColumnPlanEntry` is a type (no runtime binding to probe here) --
		// its absence is the `@ts-expect-error` import above, checked by
		// `pnpm check-types`, not by this runtime assertion (two-layer
		// probe: value layer here, type layer there -- confirmed by
		// reverse-mutating all four independently, see commit history).
	});
});

/**
 * Public entry surface for `@hejbro/query` (task 7.8) — settles the
 * provisional judgment this file carried while groups 5/6 needed the bare
 * minimum to resolve this package: `db`, every chain member's own stage
 * types, `compile()`, the dual-use `sql` escape hatch (new here — group 7
 * decision ①, the `hejbro` facade re-exports this one, task 7.9), driver
 * contract types, `DbContext`/`ScopedDb`/`Tx`, the result-row types every
 * one of them resolves through, and `throwMissingCapability` (#490 — the
 * driver contract's own missing-capability failure, so a driver package
 * constructs it instead of copying its message text). The test-only
 * conversion internals
 * (`resolveColumnState`/`columnPlanForResult`/`convertRow`/
 * `ColumnPlanEntry`, `db/convert.ts`) are never re-exported here —
 * `test/exports.test.ts` pins both halves.
 */

export type {
	CompileInput,
	CompileKind,
	CompileResult,
} from "./compile/compile";
export { compile } from "./compile/compile";
export type {
	ChainApi,
	DeleteChainFilterable,
	DeleteChainFinal,
	DeleteChainReturnable,
	InsertChainConflictable,
	InsertChainFinal,
	InsertChainReturnable,
	SelectChainFiltered,
	SelectChainJoinable,
	SelectChainLimited,
	SelectChainOrdered,
	UpdateChainFilterable,
	UpdateChainFinal,
	UpdateChainReturnable,
	WithChainTerminal,
} from "./db/chain";
export type { DbContext, ScopedDb } from "./db/context";
export type {
	Db,
	DbOptions,
	Declarations,
	ExecuteResult,
	Schema,
} from "./db/db";
export { db } from "./db/db";
export type { Tx } from "./db/transaction";
export type {
	Driver,
	DriverCapabilities,
	DriverCapabilityKey,
	DriverRow,
	DriverSession,
} from "./driver/contract";
export { throwMissingCapability } from "./driver/errors";
export type { SqlExpr } from "./sql";
export { sql } from "./sql";
export type { ReturningRow } from "./types/returning";
export type { SelectResult } from "./types/select-result";

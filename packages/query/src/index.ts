/**
 * Public entry surface for `@hejbro/query` (task 7.8) — settles the
 * provisional judgment this file carried while groups 5/6 needed the bare
 * minimum to resolve this package: `db`, every chain member's own stage
 * types, `compile()`, the dual-use `sql` escape hatch (new here — group 7
 * decision ①, the `hejbro` facade re-exports this one, task 7.9), driver
 * contract types, `DbContext`/`ScopedDb`/`Tx`, the result-row types every
 * one of them resolves through, `throwMissingCapability` (#490 — the
 * driver contract's own missing-capability failure, so a driver package
 * constructs it instead of copying its message text),
 * `preparedStatementName` (task 1.5, #891 — the one statement-name
 * derivation every driver declaring `"prepared-statements"` calls,
 * so `@hejbro/pg` and `@hejbro/neon` hold no byte-identical copy of
 * their own), `lastRows`/`QueryResultLike` (task 1.6, #892 — the one
 * fold from a possibly multi-command node-postgres-shaped result to
 * the rows a caller sees, the last command's, that both drivers call
 * instead of each reimplementing it), and
 * `defaultContextRendering`/`ContextRendering` (#554/#555 review F1 —
 * the default rendering's own spec requirement, "reachable by a driver
 * package", needs a public-entry export; a module-level `export const`
 * one file down is not reachability across the package boundary), and
 * `createNameKeyedDb`/`NameKeyedDb`/`NameKeyedTableClient`/
 * `NameKeyedTables`/`DatabaseShape`/the `Contract*` metadata types
 * (R2-G6): the polyrepo consumer's own client, keyed by name rather than
 * by a declared `Table` value, plus the runtime shape it reads
 * (`hejbro`'s `contract/emit.ts` writes exactly this shape into every
 * vendored contract's `contractMetadata` constant — a structural, not
 * imported, contract between the two packages, `AGENTS.md`'s own repo
 * map). The test-only
 * conversion internals
 * (`resolveColumnState`/`columnPlanForResult`/`convertRow`/
 * `ColumnPlanEntry`, `db/convert.ts`) are never re-exported here —
 * `test/exports.test.ts` pins both halves.
 */

export type {
	ContractColumnMeta,
	ContractForeignKeyMeta,
	ContractMetadata,
	ContractTableMeta,
} from "./client/contract-types";
export type {
	DatabaseShape,
	NameKeyedDb,
	NameKeyedTableClient,
	NameKeyedTables,
} from "./client/name-keyed-db";
export { createNameKeyedDb } from "./client/name-keyed-db";
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
export type { ContextProvider, DbContext, ScopedDb } from "./db/context";
export { defaultContextRendering } from "./db/context";
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
	ContextRendering,
	Driver,
	DriverCapabilities,
	DriverCapabilityKey,
	DriverRow,
	DriverSession,
} from "./driver/contract";
export { throwMissingCapability } from "./driver/errors";
export type { QueryResultLike } from "./driver/result-rows";
export { lastRows } from "./driver/result-rows";
export { preparedStatementName } from "./driver/statement-name";
export type { SqlExpr } from "./sql";
export { sql } from "./sql";
export type { ReturningRow } from "./types/returning";
export type { SelectResult } from "./types/select-result";

/**
 * Provisional entry surface for `@hejbro/query` — the minimum groups 5/6
 * (the `@hejbro/pg` and Supabase drivers) need to resolve this package
 * while it is still `private`. The *public* export list is task 7.1's
 * [design] decision; that task replaces this file's judgment wholesale
 * rather than extending it ad hoc. Two standing rules already bind it:
 * the test-only conversion exports (`resolveColumnState`,
 * `columnPlanForResult`, `convertRow`, `ColumnPlanEntry`) are never
 * re-exported here, and `sql` stays out until 7.1 settles which barrel
 * carries it.
 */

export type {
	CompileInput,
	CompileKind,
	CompileResult,
} from "./compile/compile";
export { compile } from "./compile/compile";
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

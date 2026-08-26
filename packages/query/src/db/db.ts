import type { FunctionDeclaration, Table } from "@hejbro/core";
import type { CompileInput } from "../compile/compile";
import { compile } from "../compile/compile";
import type { Driver, DriverRow } from "../driver/contract";

/**
 * Everything a `db()` handle needs to know about the declared schema,
 * keyed the way the caller's own module already keys it (`{ tables: {
 * posts, comments } }`) — a plain shorthand-property object, the same
 * "record keyed by export name" reading owner decision ③ settles for
 * `db.fn` (task 4.9): JS can't introspect an export binding's name at
 * runtime, so the record's own keys stand in for it.
 *
 * `tables` is required (every table any statement can reach — including a
 * joined table never named directly by the caller's own `select()`/
 * `returning()` call — has to be resolvable here; task 4.4's single
 * column-meta resolver depends on this being complete, not just "the
 * tables this one query happens to mention"). `functions` is optional:
 * only `db.fn.*` (task 4.9) reads it, and not every declared schema
 * exposes callable functions.
 */
export type Declarations = {
	readonly tables: Readonly<Record<string, Table>>;
	readonly functions?: Readonly<Record<string, FunctionDeclaration>>;
};

/**
 * A `db()` handle: the declarations it was built with, the driver it
 * executes against, and `execute` — the passthrough every other db
 * operation (4.4's conversion, 4.6's transaction, 4.7's context, 4.9's
 * `db.fn`) is built on top of, in their own files, by taking this handle
 * as a parameter rather than this module growing new members for each of
 * them.
 */
export type Db = {
	readonly declarations: Declarations;
	readonly driver: Driver;
	execute(statement: CompileInput): Promise<ReadonlyArray<DriverRow>>;
};

/**
 * Builds a `db()` handle bound to `driver`. `execute` hands `driver` the
 * exact {@link CompileResult} `compile()` itself would preview for the
 * same statement — `sql`, `params`, and `kind` together, never `sql`/
 * `params` unpacked into separate arguments — so `kind` reaches the
 * driver boundary unchanged (task 4.3).
 */
export const db = (declarations: Declarations, driver: Driver): Db => ({
	declarations,
	driver,
	execute: (statement) => driver.execute(compile(statement)),
});

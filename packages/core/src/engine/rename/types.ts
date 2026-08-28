import type { HejbroError } from "../../error";
import type { KindChange } from "../../kind/object-kind";
import type { Snapshot } from "../../snapshot/snapshot";

/** A `--rename <schema>.<table>.<old>=<new>` (column) flag, parsed into pure data. */
export type ColumnRenameSpec = {
	readonly target: "column";
	readonly schemaName: string;
	readonly tableName: string;
	readonly oldName: string;
	readonly newName: string;
};

/** A `--rename <schema>.<old>=<new>` (table) flag, parsed into pure data. */
export type TableRenameSpec = {
	readonly target: "table";
	readonly schemaName: string;
	readonly oldName: string;
	readonly newName: string;
};

/** @see ColumnRenameSpec, TableRenameSpec */
export type RenameSpec = ColumnRenameSpec | TableRenameSpec;

/** A `--confirm-drop` flag (column- or table-level), parsed into pure data. */
export type ConfirmDropSpec =
	| {
			readonly target: "column";
			readonly schemaName: string;
			readonly tableName: string;
			readonly columnName: string;
	  }
	| {
			readonly target: "table";
			readonly schemaName: string;
			readonly tableName: string;
	  };

/**
 * A residual same-table (`kind: "column"`) or same-schema (`kind: "table"`)
 * drop+add pair rule A couldn't resolve — the structured counterpart of an
 * `errors` entry with code `ambiguous-column-rename`/`ambiguous-table
 * -rename` (1:1, same order). `dropped`/`added` are the *residual* sets
 * (after valid `--rename`/`--confirm-drop` specs already consumed their
 * share) — a caller building a rerun suggestion from these, rather than
 * recomputing from the raw snapshot diff, is what keeps the suggested
 * flags scoped to what's still ambiguous as flags are added run over run.
 */
export type ColumnRenameAmbiguity = {
	readonly kind: "column";
	readonly schemaName: string;
	readonly tableName: string;
	/** `schema.table` */
	readonly identity: string;
	readonly dropped: ReadonlyArray<string>;
	readonly added: ReadonlyArray<string>;
	readonly declaredAt: string | null;
};

/** @see ColumnRenameAmbiguity — the schema-level table-drop+create counterpart. */
export type TableRenameAmbiguity = {
	readonly kind: "table";
	readonly schemaName: string;
	readonly droppedTables: ReadonlyArray<string>;
	readonly createdTables: ReadonlyArray<string>;
	readonly declaredAt: string | null;
};

/** @see ColumnRenameAmbiguity, TableRenameAmbiguity */
export type RenameAmbiguity = ColumnRenameAmbiguity | TableRenameAmbiguity;

/** The result of resolving a set of `--rename`/`--confirm-drop` flags against a previous→next snapshot pair (decision D32/rule A). */
export type RenamePlan = {
	/** previous snapshot with confirmed renames applied (old→new names) */
	readonly rewrittenPrevious: Snapshot;
	/** `alter table … rename …` statements, identity-ordered, emitted first */
	readonly renameStatements: ReadonlyArray<string>;
	/** synthetic banner-only changes, e.g. `~ table app.posts [column slug renamed to handle]` */
	readonly renameChanges: ReadonlyArray<KindChange>;
	/** batch-collected diagnostics; non-empty ⇒ caller must not emit SQL */
	readonly errors: ReadonlyArray<HejbroError>;
	/** the `ambiguous-*` subset of `errors`, structured (1:1, same order) — a diagnostic renderer builds rerun-command suggestions from this instead of reparsing flat text. */
	readonly ambiguities: ReadonlyArray<RenameAmbiguity>;
};

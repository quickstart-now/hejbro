import type {
	ColumnBuilder,
	ColumnState,
	ForeignKeyDeclaration,
	Table,
	TableDeclaration,
} from "@hejbro/core";
import { columnRef, tableMeta } from "@hejbro/core";
import type { ContractTableMeta } from "./contract-types";

/** `{ notNullElements: true }` when the column is one, else `{}` (`ColumnState`'s own compact convention: absent means `false`). */
const notNullElementsField = (
	notNullElements: boolean,
): Pick<ColumnState, "notNullElements"> => {
	if (notNullElements) {
		return { notNullElements: true };
	}
	return {};
};

/**
 * Reconstructs one column's `ColumnState` from its vendored facts —
 * `notNull`/`primaryKey`/`unique`/`defaultValue` are hardcoded rather
 * than carried in the contract, because none of them is ever read by
 * `@hejbro/query`'s own runtime (`db/convert.ts`'s row conversion reads
 * only `typeNode`/`mode`/`notNullElements` — confirmed by reading that
 * file directly, R2-G6 6.1, planner condition ④): a query only ever
 * touches columns this repository doesn't declare, so nothing here
 * needs to answer "is this column required" or "does it have a
 * default" — the contract's own static `Insert`/`Update` TS types
 * already answer that at the caller's own call site, from the emitted
 * source text, not from this runtime reconstruction.
 */
const synthesizeColumnState = (
	column: ContractTableMeta["columns"][string],
): ColumnState => ({
	typeNode: column.typeNode,
	mode: column.mode,
	// Never read at runtime by this package (see this function's own
	// doc comment) -- a plain, honest `false`/`null`, not a guess.
	notNull: false,
	primaryKey: false,
	unique: false,
	defaultValue: null,
	...notNullElementsField(column.notNullElements),
});

const synthesizeForeignKey = (
	foreignKey: ContractTableMeta["foreignKeys"][number],
): ForeignKeyDeclaration => ({
	columns: foreignKey.columns,
	references: {
		schemaName: foreignKey.referencesSchema,
		tableName: foreignKey.referencesTable,
		columns: foreignKey.referencedColumns,
	},
	// DDL-only facts (`ForeignKeyDeclaration`'s own required fields) --
	// never read by `db/related.ts`'s relation-following, which matches
	// purely on `references.schemaName`/`.tableName`/`.columns` (planner
	// condition ④, the same "reads nothing beyond what's needed" rule
	// applied to the foreign-key half of the metadata).
	onDelete: null,
	onUpdate: null,
});

/**
 * Builds a real, queryable `Table` value from one table's vendored
 * metadata (R2-G6 6.1) — the same public mechanism `@hejbro/core`'s own
 * `existingTable()` uses for "a table this repository does not own"
 * (`tableMeta` is a `Symbol.for` global-registry symbol precisely so a
 * value built outside `@hejbro/core`'s own package is still recognized
 * by `getTableMeta`/`isTable`, confirmed against `@hejbro/supabase`'s
 * `authUsers` as a real precedent). Tagged `authority: "usage"` (add-
 * unmanaged-objects, J3) — a query-time reconstruction is never migration
 * authority, whether or not the table it mirrors is itself declared
 * existing in the schema repository; `HejbroInput`'s own type-level
 * narrowing rejects it, and `resolveTableDeclarations`'s `"usage"` guard
 * (`engine/generate.ts`) refuses it at runtime for the caller the type
 * layer never saw (a JS/jiti caller with no compile step).
 *
 * Unlike `existingTable()`, this carries real `foreignKeys` (built from
 * the contract's own vendored relations) — `existingTable()` hardcodes
 * `foreignKeys: []` because its own use case (referencing a table this
 * repository does not own, e.g. Supabase's `auth.users`) never needs
 * that table's *own* outgoing edges; a vendored contract's whole point
 * is being queried, including its relations, so this function is not a
 * call to `existingTable()` but a sibling built from the same public
 * primitives (`columnRef`, `tableMeta`, the plain `TableDeclaration`
 * shape) since `existingTable()`'s own column/ref-building internals
 * are not part of `@hejbro/core`'s public surface.
 */
export const synthesizeTable = (
	meta: ContractTableMeta,
): Table<Record<string, ColumnBuilder>, "usage"> => {
	const declaration: TableDeclaration = {
		declarationKind: "table",
		schema: { declarationKind: "schema", schemaName: meta.schema },
		tableName: meta.name,
		columns: Object.entries(meta.columns).map(([tsKey, column]) => ({
			columnKey: tsKey,
			columnName: column.sqlName,
			columnState: synthesizeColumnState(column),
		})),
		indexes: [],
		foreignKeys: meta.foreignKeys.map(synthesizeForeignKey),
		checks: [],
		rls: null,
		existing: true,
		authority: "usage",
		declaredAt: null,
	};
	const refsObject = Object.fromEntries(
		Object.entries(meta.columns).map(([tsKey, column]) => [
			tsKey,
			columnRef(meta.schema, meta.name, column.sqlName, column.typeNode),
		]),
	);
	return Object.assign(refsObject, {
		[tableMeta]: declaration,
	}) as Table<Record<string, ColumnBuilder>, "usage">;
};

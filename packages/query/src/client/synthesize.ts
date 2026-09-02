import type {
	ColumnState,
	DeclaredTable,
	ForeignKeyDeclaration,
	FunctionDeclaration,
	TableDeclaration,
} from "@hejbro/core";
import { columnRef, tableMeta } from "@hejbro/core";
import type { ContractFunctionMeta, ContractTableMeta } from "./contract-types";

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
 * `authUsers` as a real precedent). Tagged `existing: true` — a second,
 * independent refusal if this value were ever handed to
 * `generateMigration` (`hejbro`'s own `loader.ts` check, R2-G5 5.12, is
 * the first layer; this is the query-execution layer's own).
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
export const synthesizeTable = (meta: ContractTableMeta): DeclaredTable => {
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
		authority: "declared",
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
	}) as DeclaredTable;
};

/** `ContractFunctionMeta["returns"]`'s own `kind` reads as `FunctionDeclaration["returns"]`'s own `returnsKind` union — never `"trigger"`, since `contract/functions.ts`'s own `computeFunctions` already drops a trigger-synthesized function before it ever reaches a vendored contract (schema-vendoring delta, "A synthesized trigger function is absent"), so there is no vendored fact to reconstruct that variant from. */
const synthesizeReturns = (
	returns: ContractFunctionMeta["returns"],
): FunctionDeclaration["returns"] => {
	if (returns.kind === "scalar") {
		return {
			returnsKind: "scalar",
			typeNode: returns.typeNode,
			mode: returns.mode,
		};
	}
	return {
		returnsKind: "setofTable",
		schemaName: returns.schema,
		tableName: returns.name,
	};
};

/**
 * Builds a real, callable `FunctionDeclaration` from one function's
 * vendored metadata (#587/G3) — the same reconstruction role
 * {@link synthesizeTable} plays for a table, reused unchanged by
 * `db()`/`db.fn` (`createFnApi` reads only `schemaName`/`functionName`/
 * `args[].key`/`.argName`/`.typeNode`/`.mode`/`.notNullElements`/
 * `returns.*`, confirmed by reading `fn.ts` directly — none of the fields
 * below this comment ever reach a query). `security`/`body`/`declaredAt`
 * are honest, least-committal placeholders (the same convention
 * `synthesizeColumnState` already uses for a column's own unread DDL
 * facts) — a real declaration's `security` is never read at query time,
 * and there is no real plpgsql body behind a vendored fact, only the
 * type and call shape the contract actually carries.
 *
 * **Deliberately no new rejection marker, and this is a narrower
 * guarantee than `synthesizeTable`'s `existing: true`, not the same one
 * relabeled** — `FunctionDeclaration` has no `existing`/`authority` field
 * at all (core has no "existing function" concept the way it has an
 * "existing table" one for `@hejbro/supabase`'s `authUsers`), so there is
 * no marker to reuse and nothing here refuses a synthesized function
 * handed to `generateMigration` — measured directly: it accepts one
 * silently and would emit a migration creating a function with an empty
 * plpgsql body. The actual boundary is structural, not an active guard:
 * `@hejbro/query` never imports `generateMigration` at all, so no code
 * path *this package* owns can reach that outcome — `no-fn-leak.test.ts`
 * proves the narrower, real claim (the client's public `fn` surface
 * carries no `FunctionDeclaration` shape), not migration-refusal.
 */
export const synthesizeFunction = (
	meta: ContractFunctionMeta,
): FunctionDeclaration => ({
	declarationKind: "function",
	schemaName: meta.schema,
	functionName: meta.name,
	args: meta.args.map((arg) => ({
		key: arg.key,
		argName: arg.sqlName,
		typeNode: arg.typeNode,
		mode: arg.mode,
		notNullElements: arg.notNullElements,
	})),
	returns: synthesizeReturns(meta.returns),
	security: "invoker",
	body: { declarations: [], statements: [] },
	declaredAt: null,
});

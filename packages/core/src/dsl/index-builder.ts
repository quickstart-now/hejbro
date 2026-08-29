import { throwHejbroError } from "../error";
import type { ColumnRef, Expr } from "../expr/ast";
import { isExpr } from "../expr/ast";
import { renderExpr } from "../expr/render-sql";
import { assertSqlName } from "../sql/identifier-rules";
import type {
	IndexColumnDeclaration,
	IndexDeclaration,
	IndexMethod,
	IndexNulls,
} from "./table";
import { indexMethods } from "./table";

/** One column of an ordered index: a column ref or any expression (R5, e.g. `sql\`lower(${t.email})\``), its sort direction, an optional explicit nulls placement (D51), and an optional operator class (R4). */
export type IndexColumn = {
	readonly column: ColumnRef | Expr;
	readonly desc: boolean;
	readonly nulls: IndexNulls | null;
	readonly opclass: string | null;
};

/** What `.on(...)` accepts per column: a bare `ColumnRef`, a bare expression (R5), or an `asc(...)`/`desc(...)`/`op(...)`-wrapped {@link IndexColumn} — the three wrappers compose in any order (R4). */
export type IndexColumnInput = ColumnRef | Expr | IndexColumn;

const isIndexColumn = (input: IndexColumnInput): input is IndexColumn =>
	"column" in input && isExpr(input.column);

/** A `ColumnRef` carries `sqlName`; a bare expression (`sql\`...\``, R5) doesn't — the one runtime distinction {@link toDeclarationColumn} needs to pick its `name` vs `expression` branch (same technique `query/mutate.ts`'s own `isColumnRef` uses). */
const isColumnRef = (column: ColumnRef | Expr): column is ColumnRef =>
	"sqlName" in column;

/** Resolves an `IndexColumnInput` to its full {@link IndexColumn} shape — a bare ref/expression defaults to ascending/no-opclass; an already-wrapped entry keeps its own fields, for its caller (`asc`/`desc`/`op`) to override just the one it owns. */
const resolveIndexColumn = (input: IndexColumnInput): IndexColumn => {
	if (isIndexColumn(input)) {
		return input;
	}
	return { column: input, desc: false, nulls: null, opclass: null };
};

const orderedColumn =
	(desc: boolean) =>
	(
		input: IndexColumnInput,
		options?: { readonly nulls?: IndexNulls },
	): IndexColumn => ({
		...resolveIndexColumn(input),
		desc,
		nulls: options?.nulls ?? null,
	});

/** Ascending index column, optionally with an explicit nulls placement — composes with `op(...)` in either order (R4). */
export const asc = orderedColumn(false);
/** Descending index column, optionally with an explicit nulls placement (`desc(t.publishedAt, { nulls: "first" })`) — composes with `op(...)` in either order (R4). */
export const desc = orderedColumn(true);

/** Wraps an index column with an operator class (R4, e.g. `op(t.data, "jsonb_path_ops")`) — composes with `asc(...)`/`desc(...)` in either order. `opclass` is a D36 identifier (`invalid-sql-name` when it isn't; catalog existence is Postgres' job, #220). */
export const op = (input: IndexColumnInput, opclass: string): IndexColumn => ({
	...resolveIndexColumn(input),
	opclass: assertSqlName(opclass, "operator class", null),
});

/** `{ name }` for a `ColumnRef` input, `{ expression: ExprNode }` for any other expression (R5) — {@link toDeclarationColumn}'s own field. */
const declarationColumnSelf = (
	column: ColumnRef | Expr,
): { readonly name: string } | { readonly expression: Expr["exprNode"] } => {
	if (isColumnRef(column)) {
		if (column.exprNode.schemaName === null) {
			// add-ctes task 1.2d: `.on()` has no table-ownership check at
			// all (a pre-existing gap out of this change's scope, #TBD) --
			// but a CTE column reference is new with this change, so
			// closing that one case here is this change's own exposure to
			// close, joining 1.2c's foreign-column-ref family rather than
			// letting it through as a bare, unowned column name.
			return throwHejbroError(
				"foreign-column-ref",
				`index column references a column of the CTE "${column.exprNode.tableName}" — a CTE is statement-local and cannot back an index column. Next: pass one of the table's own columns instead.`,
			);
		}
		return { name: column.sqlName };
	}
	return { expression: column.exprNode };
};

const toDeclarationColumn = (
	input: IndexColumnInput,
): IndexDeclaration["columns"][number] => {
	const resolved = resolveIndexColumn(input);
	return {
		...declarationColumnSelf(resolved.column),
		desc: resolved.desc,
		nulls: resolved.nulls,
		opclass: resolved.opclass,
	};
};

/** `.using()`'s runtime guard against untyped callers (R2) — reuses `indexMethods` (`./table`, D85) rather than re-listing the eight names, the same way `foreignKeyActions` is its own single source of truth. */
const isIndexMethod = (value: string): value is IndexMethod =>
	(indexMethods as ReadonlyArray<string>).includes(value);

/** Validates `method` against the closed set (`unknown-index-method`), then normalizes `"btree"` — Postgres' own default — to `null` so it's never recorded (SC-004, R2). */
const normalizeIndexMethod = (method: IndexMethod): IndexMethod | null => {
	if (!isIndexMethod(method)) {
		throwHejbroError(
			"unknown-index-method",
			`index access method "${method}" is not one hejbro accepts — supported: btree, hash, gin, gist, spgist, brin, hnsw, ivfflat. Next: pick one of those (extension methods are added on request).`,
		);
	}
	if (method === "btree") {
		return null;
	}
	return method;
};

/** One column's short description for {@link uniqueIndexMethodClause}'s unnamed-index fallback: a quoted column name, or a parenthesised rendering of an expression entry (R5) — same shape `@hejbro/supabase`'s `indexDescription` uses. */
const uniqueIndexMethodColumnDescription = (
	column: IndexColumnDeclaration,
): string => {
	if ("name" in column) {
		return `"${column.name}"`;
	}
	return `(${renderExpr(column.expression)})`;
};

/** The `unique-index-method` message's opening clause (main-decided wording, #284): a named index states its own uniqueness (`index "<name>" is unique and uses "<m>"`), while an unnamed one is described by its column list, which already reads as unique (`the unique index on (...) uses "<m>"`) — same column-quoting convention `@hejbro/supabase`'s `indexDescription` uses. */
const uniqueIndexMethodClause = (
	indexName: string | null,
	method: IndexMethod,
	columns: ReadonlyArray<IndexColumnDeclaration>,
): string => {
	if (indexName !== null) {
		return `index "${indexName}" is unique and uses "${method}"`;
	}
	const columnList = columns.map(uniqueIndexMethodColumnDescription).join(", ");
	return `the unique index on (${columnList}) uses "${method}"`;
};

/** Rejects `unique` combined with a non-btree `method` (Postgres: "Only B-tree indexes can be declared unique", R3) — both flags are known at `.on()`, so this fails at declaration time with no table context needed. */
const assertUniqueIndexMethod = (
	unique: boolean,
	method: IndexMethod | null,
	indexName: string | null,
	columns: ReadonlyArray<IndexColumnDeclaration>,
): void => {
	if (!unique || method === null) {
		return;
	}
	throwHejbroError(
		"unique-index-method",
		`${uniqueIndexMethodClause(indexName, method, columns)} — Postgres supports unique only on btree indexes. Next: drop .unique() or drop .using("${method}").`,
	);
};

/** An index declaration once `.on(...)` has run — still chainable with `.where(predicate)` for a partial index. */
export type IndexDeclarationBuilder = IndexDeclaration & {
	where(predicate: Expr<"boolean"> | Expr<"unknown">): IndexDeclaration;
};

/** An immutable chainable builder for a table index (spec §5.1: `index().on(t.publishedAt)`); `.using(method)`/`.unique()` compose in either order, `.on(...)` accepts bare column refs or `asc(...)`/`desc(...)`, and the result can chain `.where(predicate)` for a partial index (D51). */
export type IndexBuilder = {
	unique(): IndexBuilder;
	using(method: IndexMethod): IndexBuilder;
	on(...columns: ReadonlyArray<IndexColumnInput>): IndexDeclarationBuilder;
};

const createIndexBuilder = (
	indexName: string | null,
	unique: boolean,
	method: IndexMethod | null,
): IndexBuilder => ({
	unique: () => createIndexBuilder(indexName, true, method),
	using: (rawMethod) =>
		createIndexBuilder(indexName, unique, normalizeIndexMethod(rawMethod)),
	on: (...columns) => {
		const declarationColumns = columns.map(toDeclarationColumn);
		assertUniqueIndexMethod(unique, method, indexName, declarationColumns);
		const declaration: IndexDeclaration = {
			columns: declarationColumns,
			unique,
			indexName,
			predicate: null,
			method,
		};
		return {
			...declaration,
			where: (predicate) => ({
				...declaration,
				predicate: predicate.exprNode,
			}),
		};
	},
});

/** Resolves an optional index name: `undefined` stays `null` (derive later), else validated per D36. */
const resolveIndexName = (indexName: string | undefined): string | null => {
	if (indexName === undefined) {
		return null;
	}
	return assertSqlName(indexName, "index", null);
};

/** Starts an index declaration, optionally named (validated per D36) — chain `.unique()`/`.using(method)` in either order, finish with `.on(...columns)`, optionally `.where(predicate)`. */
export const index = (indexName?: string): IndexBuilder =>
	createIndexBuilder(resolveIndexName(indexName), false, null);

import type { ColumnRef, Expr } from "../expr/ast";
import { isExpr } from "../expr/ast";
import { assertSqlName } from "../sql/identifier-rules";
import type { IndexDeclaration, IndexNulls } from "./table";

/** One column of an ordered index: the column ref, its sort direction, and an optional explicit nulls placement (D51). */
export type IndexColumn = {
	readonly column: ColumnRef;
	readonly desc: boolean;
	readonly nulls: IndexNulls | null;
};

/** What `.on(...)` accepts per column: a bare `ColumnRef` (ascending, default nulls) or an `asc(...)`/`desc(...)`-wrapped {@link IndexColumn}. */
export type IndexColumnInput = ColumnRef | IndexColumn;

const isIndexColumn = (input: IndexColumnInput): input is IndexColumn =>
	"column" in input && isExpr(input.column);

const orderedColumn =
	(desc: boolean) =>
	(
		column: ColumnRef,
		options?: { readonly nulls?: IndexNulls },
	): IndexColumn => ({
		column,
		desc,
		nulls: options?.nulls ?? null,
	});

/** Ascending index column, optionally with an explicit nulls placement. */
export const asc = orderedColumn(false);
/** Descending index column, optionally with an explicit nulls placement (`desc(t.publishedAt, { nulls: "first" })`). */
export const desc = orderedColumn(true);

const toDeclarationColumn = (
	input: IndexColumnInput,
): IndexDeclaration["columns"][number] => {
	if (isIndexColumn(input)) {
		return { name: input.column.sqlName, desc: input.desc, nulls: input.nulls };
	}
	return { name: input.sqlName, desc: false, nulls: null };
};

/** An index declaration once `.on(...)` has run — still chainable with `.where(predicate)` for a partial index. */
export type IndexDeclarationBuilder = IndexDeclaration & {
	where(predicate: Expr<"boolean"> | Expr<"unknown">): IndexDeclaration;
};

/** An immutable chainable builder for a table index (spec §5.1: `index().on(t.publishedAt)`); `.on(...)` accepts bare column refs or `asc(...)`/`desc(...)`, and the result can chain `.where(predicate)` for a partial index (D51). */
export type IndexBuilder = {
	unique(): IndexBuilder;
	on(...columns: ReadonlyArray<IndexColumnInput>): IndexDeclarationBuilder;
};

const createIndexBuilder = (
	indexName: string | null,
	unique: boolean,
): IndexBuilder => ({
	unique: () => createIndexBuilder(indexName, true),
	on: (...columns) => {
		const declaration: IndexDeclaration = {
			columns: columns.map(toDeclarationColumn),
			unique,
			indexName,
			predicate: null,
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

/** Starts an index declaration, optionally named (validated per D36) — chain `.unique()`, finish with `.on(...columns)`, optionally `.where(predicate)`. */
export const index = (indexName?: string): IndexBuilder =>
	createIndexBuilder(resolveIndexName(indexName), false);

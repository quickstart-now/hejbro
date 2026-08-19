import type { ColumnRef } from "../expr/ast";
import type { IndexDeclaration } from "./table";

/** An immutable chainable builder for a table index (spec §5.1: `index().on(t.publishedAt)`). */
export type IndexBuilder = {
	unique(): IndexBuilder;
	on(...columns: ReadonlyArray<ColumnRef>): IndexDeclaration;
};

const createIndexBuilder = (
	indexName: string | null,
	unique: boolean,
): IndexBuilder => ({
	unique: () => createIndexBuilder(indexName, true),
	on: (...columns) => ({
		columns: columns.map((column) => column.sqlName),
		unique,
		indexName,
	}),
});

/** Starts an index declaration, optionally named — chain `.unique()` and finish with `.on(...columns)`. */
export const index = (indexName?: string): IndexBuilder =>
	createIndexBuilder(indexName ?? null, false);

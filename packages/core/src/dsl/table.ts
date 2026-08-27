import { captureDeclarationSite } from "../declaration-site";
import { throwHejbroError } from "../error";
import type { ColumnRef, Expr, ExprNode } from "../expr/ast";
import { columnRef, expr } from "../expr/ast";
import { isNull } from "../expr/operators";
import { collectColumnRefs } from "../expr/render-sql";
import { someExprNode } from "../expr/walk";
import {
	deriveForeignKeyName,
	deriveIndexName,
	namedIndexColumnNames,
} from "../kinds/table-kind";
import { assertSqlName } from "../sql/identifier-rules";
import type {
	BuilderFamily,
	ColumnBuilder,
	ColumnState,
} from "../types/column-builder";
import type { CheckDeclaration } from "./check";
import { check } from "./check";
import type { RlsDeclaration, RlsInput } from "./rls";
import { bindRls } from "./rls";
import type { SchemaDeclaration } from "./schema";

/** The referential actions Postgres supports for `on delete` and `on update`. */
export const foreignKeyActions = [
	"cascade",
	"restrict",
	"set null",
	"set default",
	"no action",
] as const;

/** @see foreignKeyActions */
export type ForeignKeyAction = (typeof foreignKeyActions)[number];

/** Where an ordered index column places SQL nulls relative to its sort order. */
export type IndexNulls = "first" | "last";

/** Postgres access methods hejbro accepts (D85, closed) — built-in six plus pgvector's two. `"btree"` is Postgres' own default and is never recorded in a declaration or snapshot (SC-004): see {@link IndexDeclaration.method}. */
export const indexMethods = [
	"btree",
	"hash",
	"gin",
	"gist",
	"spgist",
	"brin",
	"hnsw",
	"ivfflat",
] as const;

/** @see indexMethods */
export type IndexMethod = (typeof indexMethods)[number];

/**
 * One entry of an index's column list after `table()` resolves it (D51):
 * a plain column (`name`) or an expression column (`expression`, a
 * structured node reused from the partial-predicate machinery, D46) —
 * exactly one of the two — plus its sort direction, nulls placement, and
 * optional operator class (R4/R5).
 */
export type IndexColumnDeclaration = (
	| { readonly name: string }
	| { readonly expression: ExprNode }
) & {
	readonly desc: boolean;
	readonly nulls: IndexNulls | null;
	readonly opclass: string | null;
};

/** A declared index on one or more (already snake_cased) columns, each with its sort direction and nulls placement, plus an optional partial-index predicate (D51) and access method (R1/R2; `null` means Postgres' default, `btree`). */
export type IndexDeclaration = {
	readonly columns: ReadonlyArray<IndexColumnDeclaration>;
	readonly unique: boolean;
	readonly indexName: string | null;
	readonly predicate: ExprNode | null;
	readonly method: IndexMethod | null;
};

/** The table a foreign key references, resolved to its identity parts (D52) — derived from the referenced columns' own refs, not carried as a live `TableDeclaration`. */
export type ForeignKeyReferenceTarget = {
	readonly schemaName: string;
	readonly tableName: string;
	readonly columns: ReadonlyArray<string>;
};

/** A declared foreign key from local (already snake_cased) columns to another table's columns. */
export type ForeignKeyDeclaration = {
	readonly columns: ReadonlyArray<string>;
	readonly references: ForeignKeyReferenceTarget;
	readonly onDelete: ForeignKeyAction | null;
	readonly onUpdate: ForeignKeyAction | null;
};

/** A declared table: its columns (in declaration order), indexes, and foreign keys. */
export type TableDeclaration = {
	readonly declarationKind: "table";
	readonly schema: SchemaDeclaration;
	readonly tableName: string;
	readonly columns: ReadonlyArray<{
		/** The declared TypeScript key — the name result rows are keyed by (#339); TS-only meta, never serialized (snapshot nodes carry `columnName`). */
		readonly columnKey: string;
		readonly columnName: string;
		readonly columnState: ColumnState;
	}>;
	readonly indexes: ReadonlyArray<IndexDeclaration>;
	readonly foreignKeys: ReadonlyArray<ForeignKeyDeclaration>;
	readonly checks: ReadonlyArray<CheckDeclaration>;
	readonly rls: RlsDeclaration | null;
	/** `true` for an {@link existingTable} reference (D41) — reference-only, never passed to `generateMigration`, never diffed, never emitted. `table()` always sets `false`. */
	readonly existing: boolean;
	readonly declaredAt: string | null;
};

/**
 * Hides a {@link Table}'s declaration metadata behind a unique symbol,
 * keeping the object's own enumerable keys limited to its columns (D15).
 *
 * `Symbol.for` (the global symbol registry), not `Symbol(...)`: two
 * installed copies of `@hejbro/core` (a real, if rare, package-manager
 * outcome — e.g. a version-conflict-driven nested install) would
 * otherwise mint two different `Symbol()` values sharing this
 * description, and every cross-instance check (`isTable`, `getTableMeta`,
 * a foreign key's `references.table` cross-check, the CLI loader's
 * declaration collection) would silently disagree about a table's
 * identity — confirmed empirically (phase8-symbol-for, #138): a foreign
 * key referencing an `existingTable` built by a different core instance
 * (the shape `@hejbro/supabase`'s `authUsers` is used in) crashed with a
 * raw `TypeError`, not a diagnostic. `Symbol.for` makes the identity
 * global-registry-backed instead of per-module, so it survives being
 * installed twice. Public export (`core/src/index.ts`), so this is
 * pre-publication-only cost — free now, breaking after (D61/D65).
 */
export const tableMeta: unique symbol = Symbol.for("hejbro:table-meta");

/** Maps a table's column builders to the typed {@link ColumnRef}s exposed at the top level of the built {@link Table}. */
export type TableColumns<TColumns extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TColumns]: ColumnRef<BuilderFamily<TColumns[K]>>;
};

/** A drizzle-style table object (D15): columns as top-level typed refs, declaration metadata hidden behind {@link tableMeta}. */
export type Table<
	TColumns extends Record<string, ColumnBuilder> = Record<
		string,
		ColumnBuilder
	>,
> = TableColumns<TColumns> & { readonly [tableMeta]: TableDeclaration };

/** Reads a {@link Table}'s hidden declaration metadata. */
export const getTableMeta = (tableObject: Table): TableDeclaration =>
	tableObject[tableMeta];

/** Guards that `value` is a {@link Table} built by {@link table}. */
export const isTable = (value: unknown): value is Table =>
	typeof value === "object" && value !== null && tableMeta in value;

/** A local foreign key column list plus the table+columns it references, as passed to a table's `extras` callback. */
export type ForeignKeyInput = {
	readonly columns: ReadonlyArray<ColumnRef>;
	readonly references: {
		/** Optional since D52 — derived from `columns` when omitted, cross-checked when given. */
		readonly table?: Table;
		readonly columns: ReadonlyArray<ColumnRef>;
	};
	readonly onDelete?: ForeignKeyAction;
	readonly onUpdate?: ForeignKeyAction;
};

/** The optional indexes/foreign keys/checks a table's `extras` callback may return. */
export type TableExtras = {
	readonly indexes?: ReadonlyArray<IndexDeclaration>;
	readonly foreignKeys?: ReadonlyArray<ForeignKeyInput>;
	readonly checks?: ReadonlyArray<CheckDeclaration>;
	readonly rls?: RlsInput;
};

/** Converts a camelCase TypeScript identifier to a snake_case SQL name (`publishedAt` → `published_at`). */
export const toSnakeCase = (name: string): string =>
	name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

type ColumnEntry = {
	readonly columnKey: string;
	readonly columnName: string;
	readonly columnState: ColumnState;
};

/** Snake-cases and validates a table's column builders into {@link ColumnEntry}s (shared by {@link table} and `existingTable`). */
export const buildColumnEntries = <
	TColumns extends Record<string, ColumnBuilder>,
>(
	tableName: string,
	columns: TColumns,
): ReadonlyArray<ColumnEntry> => {
	const columnEntries = Object.entries(columns).map(
		([columnKey, columnBuilder]) => ({
			columnKey,
			columnName: assertSqlName(toSnakeCase(columnKey), "column", null),
			columnState: columnBuilder.columnState,
		}),
	);

	const duplicateColumnName = columnEntries
		.map((entry) => entry.columnName)
		.find(
			(columnName, index, allNames) => allNames.indexOf(columnName) !== index,
		);

	if (duplicateColumnName !== undefined) {
		throwHejbroError(
			"duplicate-column",
			`table "${tableName}" has duplicate column name "${duplicateColumnName}" after snake_casing. Next: rename one of the conflicting TypeScript properties.`,
		);
	}

	return columnEntries;
};

/**
 * Builds the `TableColumns<TColumns>` refs object exposed at the top level
 * of a `Table`. `columnEntries` is derived generically from `TColumns` via
 * `buildColumnEntries`, so TypeScript can't trace the per-key literal
 * family back through it — this cast is the one place that mapped type
 * meets the runtime object (Task 7 design note).
 */
export const buildColumnRefs = <TColumns extends Record<string, ColumnBuilder>>(
	owner: SchemaDeclaration,
	tableName: string,
	columnEntries: ReadonlyArray<ColumnEntry>,
): TableColumns<TColumns> =>
	Object.fromEntries(
		columnEntries.map((entry) => [
			entry.columnKey,
			columnRef(
				owner.schemaName,
				tableName,
				entry.columnName,
				entry.columnState.typeNode,
			),
		]),
	) as TableColumns<TColumns>;

const validateColumnRefs = (
	tableName: string,
	knownColumnNames: ReadonlySet<string>,
	indexes: ReadonlyArray<IndexDeclaration>,
	foreignKeys: ReadonlyArray<ForeignKeyDeclaration>,
): void => {
	const badIndexColumn = indexes
		.flatMap((index) => namedIndexColumnNames(index.columns))
		.find((columnName) => !knownColumnNames.has(columnName));
	if (badIndexColumn !== undefined) {
		throwHejbroError(
			"unknown-index-column",
			`table "${tableName}" declares an index referencing unknown column "${badIndexColumn}". Next: use one of this table's own declared column names in the index() call — this is usually a typo in "${badIndexColumn}".`,
		);
	}

	const badForeignKeyColumn = foreignKeys
		.flatMap((foreignKey) => foreignKey.columns)
		.find((columnName) => !knownColumnNames.has(columnName));
	if (badForeignKeyColumn !== undefined) {
		throwHejbroError(
			"unknown-foreign-key-column",
			`table "${tableName}" declares a foreign key referencing unknown column "${badForeignKeyColumn}". Next: use one of this table's own declared column names in the foreign key's columns array — this is usually a typo in "${badForeignKeyColumn}".`,
		);
	}
};

const firstDuplicate = (names: ReadonlyArray<string>): string | undefined =>
	names.find((name, index, allNames) => allNames.indexOf(name) !== index);

/** Rejects two indexes or two foreign keys that would resolve to the same derived or explicit name (D51) — Postgres constraint/index names are unique per table. */
const validateDuplicateNames = (
	tableName: string,
	indexes: ReadonlyArray<IndexDeclaration>,
	foreignKeys: ReadonlyArray<ForeignKeyDeclaration>,
): void => {
	const indexNames = indexes.map(
		(index) =>
			index.indexName ??
			deriveIndexName(tableName, namedIndexColumnNames(index.columns)),
	);
	const duplicateIndex = firstDuplicate(indexNames);
	if (duplicateIndex !== undefined) {
		throwHejbroError(
			"duplicate-index-name",
			`table "${tableName}" declares two indexes named "${duplicateIndex}" (unnamed indexes default to "<table>_<columns>_idx"). Next: give one of them an explicit name — index("...").`,
		);
	}

	const foreignKeyNames = foreignKeys.map((foreignKey) =>
		deriveForeignKeyName(tableName, foreignKey.columns),
	);
	const duplicateForeignKey = firstDuplicate(foreignKeyNames);
	if (duplicateForeignKey !== undefined) {
		throwHejbroError(
			"duplicate-foreign-key-name",
			`table "${tableName}" declares two foreign keys on the same local columns (both would be named "${duplicateForeignKey}") — a column set can only reference one table. Next: merge them into one foreign key, or remove one.`,
		);
	}
};

type IndexExpressionEntry = {
	readonly indexName: string;
	readonly expression: ExprNode;
};

/** `[column.expression]` for an expression entry, else `[]` — the `flatMap` step of {@link indexExpressions}. */
const indexColumnExpressionOrEmpty = (
	column: IndexColumnDeclaration,
): ReadonlyArray<ExprNode> => {
	if ("expression" in column) {
		return [column.expression];
	}
	return [];
};

/** An index's own expression-column nodes, in declaration order (R5). */
const indexExpressions = (index: IndexDeclaration): ReadonlyArray<ExprNode> =>
	index.columns.flatMap(indexColumnExpressionOrEmpty);

/** The column refs `collectColumnRefs` finds inside `expressions`, `.columnName`s only, in encounter order — {@link proposeExpressionIndexName}'s own input (R6). */
const expressionColumnNames = (
	expressions: ReadonlyArray<ExprNode>,
): ReadonlyArray<string> =>
	expressions.flatMap((expression) =>
		collectColumnRefs(expression).map((ref) => ref.columnName),
	);

/** Proposes a name for an unnamed expression index (D86/R6): `<table>_<cols>_idx` from the columns its expressions reference, or `<table>_expr_idx` when they reference none. */
const proposeExpressionIndexName = (
	tableName: string,
	expressions: ReadonlyArray<ExprNode>,
): string => {
	const columnNames = expressionColumnNames(expressions);
	if (columnNames.length === 0) {
		return `${tableName}_expr_idx`;
	}
	return deriveIndexName(tableName, columnNames);
};

/** Rejects an unnamed index with at least one expression column (D86/R6) — hejbro can't derive a name from an expression the way it derives one from plain columns, so it proposes one instead. */
const assertIndexExpressionsAreNamed = (
	tableName: string,
	indexes: ReadonlyArray<IndexDeclaration>,
): void => {
	const unnamed = indexes.find(
		(index) => index.indexName === null && indexExpressions(index).length > 0,
	);
	if (unnamed === undefined) {
		return;
	}
	const proposedName = proposeExpressionIndexName(
		tableName,
		indexExpressions(unnamed),
	);
	throwHejbroError(
		"index-expression-requires-name",
		`table "${tableName}" declares an index over an expression without a name — hejbro cannot derive a name from an expression. Next: name it — index("${proposedName}").`,
	);
};

/**
 * Every named index's expression columns, paired with the index's own
 * name — {@link assertNoIndexExpressionSubquery}/
 * {@link assertNoForeignIndexExpressionColumn}'s shared scan input
 * (mirrors {@link indexPredicateEntries}). By validation order
 * (`assertIndexExpressionsAreNamed` runs first), every index reaching
 * here that has an expression column is already named.
 */
const indexExpressionEntries = (
	indexes: ReadonlyArray<IndexDeclaration>,
): ReadonlyArray<IndexExpressionEntry> =>
	indexes.flatMap((index) => {
		const { indexName } = index;
		if (indexName === null) {
			return [];
		}
		return indexExpressions(index).map((expression) => ({
			indexName,
			expression,
		}));
	});

/** Rejects an index expression containing a subquery — Postgres forbids subqueries in index expressions, mirroring {@link validateChecks}'s check-subquery guard. */
const assertNoIndexExpressionSubquery = (
	tableName: string,
	indexes: ReadonlyArray<IndexDeclaration>,
): void => {
	const subquery = indexExpressionEntries(indexes).find((entry) =>
		someExprNode(entry.expression, (node) => node.nodeKind === "exists"),
	);
	if (subquery !== undefined) {
		throwHejbroError(
			"index-expression-subquery",
			`index "${subquery.indexName}" on table "${tableName}" contains a subquery in an index expression — Postgres forbids subqueries in index expressions. Next: express the column over this table's own columns, or index the plain column and filter elsewhere.`,
		);
	}
};

/** Rejects an index expression referencing another table's column, mirroring {@link validateChecks}'s check-foreign-column-ref guard. */
const assertNoForeignIndexExpressionColumn = (
	owner: SchemaDeclaration,
	tableName: string,
	indexes: ReadonlyArray<IndexDeclaration>,
): void => {
	const foreign = indexExpressionEntries(indexes)
		.flatMap((entry) =>
			collectColumnRefs(entry.expression).map((ref) => ({
				indexName: entry.indexName,
				ref,
			})),
		)
		.find(
			({ ref }) =>
				ref.schemaName !== owner.schemaName || ref.tableName !== tableName,
		);
	if (foreign !== undefined) {
		throwHejbroError(
			"index-expression-foreign-column-ref",
			`index "${foreign.indexName}" on table "${tableName}" references column "${foreign.ref.schemaName}.${foreign.ref.tableName}.${foreign.ref.columnName}" in an index expression — an index expression can only see this table's own columns. Next: use this table's own columns (the callback's \`t\`).`,
		);
	}
};

/** Rejects an unnamed expression index, then a subquery inside an index expression, then an index expression referencing another table's column, in that order (D86/R6/R7). */
const validateIndexExpressions = (
	owner: SchemaDeclaration,
	tableName: string,
	indexes: ReadonlyArray<IndexDeclaration>,
): void => {
	assertIndexExpressionsAreNamed(tableName, indexes);
	assertNoIndexExpressionSubquery(tableName, indexes);
	assertNoForeignIndexExpressionColumn(owner, tableName, indexes);
};

/**
 * The first column carrying `columnState.notNullElements` while not itself
 * an `.array()` column, if any (add-array-ergonomics design decision 3):
 * `.notNullElements()` on the builder never throws — a bare builder has no
 * column name yet to name in an error — so `table()`, the first point a
 * column actually has a name, is where misuse is caught.
 */
const findInvalidNotNullElementsColumn = (
	columnEntries: ReadonlyArray<ColumnEntry>,
): ColumnEntry | undefined =>
	columnEntries.find(
		(entry) =>
			entry.columnState.notNullElements === true &&
			entry.columnState.typeNode.typeName !== "array",
	);

/** Rejects a `.notNullElements()` column that isn't actually an `.array()` column, naming the column (design decision 3) — see {@link findInvalidNotNullElementsColumn}. */
const assertNotNullElementsOnArrayColumns = (
	tableName: string,
	columnEntries: ReadonlyArray<ColumnEntry>,
): void => {
	const invalid = findInvalidNotNullElementsColumn(columnEntries);
	if (invalid === undefined) {
		return;
	}
	throwHejbroError(
		"invalid-not-null-elements",
		`table "${tableName}" column "${invalid.columnName}" calls .notNullElements() but is declared "${invalid.columnState.typeNode.typeName}", not an .array() column. Next: only an .array() column holds elements — call .array() before .notNullElements(), or drop .notNullElements() from "${invalid.columnName}".`,
	);
};

/**
 * `array_position("<schema>"."<table>"."<column>", null) is null`, as a
 * structured expression (a `columnRef` + `functionCall` + null `literal`,
 * wrapped in the existing `isNull` operator's `nullTest`) — never a
 * `rawSql`/`sqlTemplate` fragment: `retarget.ts`'s rename machinery only
 * updates a `columnRef` node's own `columnName`, so a raw-text fragment
 * would silently go stale across a column rename while every other part
 * of the check machinery (name, snapshot) tracks the rename correctly.
 * `isNull`/`expr` are the same house helpers `check()`'s own callers use
 * for every hand-written check (`check.test.ts`), so the derived check is
 * built exactly the way a user would build it by hand.
 */
const notNullElementsCheckExpression = (
	owner: SchemaDeclaration,
	tableName: string,
	columnName: string,
): Expr<"boolean"> =>
	isNull(
		expr("unknown", {
			nodeKind: "functionCall",
			schemaName: null,
			functionName: "array_position",
			args: [
				{
					nodeKind: "columnRef",
					schemaName: owner.schemaName,
					tableName,
					columnName,
				},
				{ nodeKind: "literal", literal: { literalKind: "null" } },
			],
		}),
	);

/**
 * `[check(...)]` for a column declared `.array().notNullElements()`, else
 * `[]` — {@link deriveNotNullElementsChecks}'s own `flatMap` step
 * (add-array-ergonomics design decision 1: the CHECK is derived at
 * `table()` build time into the declaration's own checks list, so it
 * rides the existing check machinery — diff/removal/collision detection
 * come free). Name is owner-settled: `<column>_no_null_elements`.
 */
const notNullElementsCheckOrEmpty = (
	owner: SchemaDeclaration,
	tableName: string,
	entry: ColumnEntry,
): ReadonlyArray<CheckDeclaration> => {
	if (!entry.columnState.notNullElements) {
		return [];
	}
	return [
		check(
			`${entry.columnName}_no_null_elements`,
			notNullElementsCheckExpression(owner, tableName, entry.columnName),
		),
	];
};

/** Every `.notNullElements()` column's derived CHECK, in column declaration order — see {@link notNullElementsCheckOrEmpty}. */
const deriveNotNullElementsChecks = (
	owner: SchemaDeclaration,
	tableName: string,
	columnEntries: ReadonlyArray<ColumnEntry>,
): ReadonlyArray<CheckDeclaration> =>
	columnEntries.flatMap((entry) =>
		notNullElementsCheckOrEmpty(owner, tableName, entry),
	);

/** Rejects duplicate CHECK names, subqueries, and cross-table column refs, in that order (D50). */
const validateChecks = (
	owner: SchemaDeclaration,
	tableName: string,
	checks: ReadonlyArray<CheckDeclaration>,
): void => {
	const duplicate = checks
		.map((entry) => entry.checkName)
		.find((name, index, allNames) => allNames.indexOf(name) !== index);
	if (duplicate !== undefined) {
		throwHejbroError(
			"duplicate-check-name",
			`table "${tableName}" declares two check constraints named "${duplicate}" — Postgres requires unique constraint names per table. Next: rename one of them.`,
		);
	}

	const subquery = checks.find((entry) =>
		someExprNode(entry.expression, (node) => node.nodeKind === "exists"),
	);
	if (subquery !== undefined) {
		throwHejbroError(
			"check-subquery",
			`check "${subquery.checkName}" on table "${tableName}" contains a subquery — Postgres forbids subqueries in CHECK constraints. Next: express the rule over this row's own columns, or enforce it with a trigger (defineTrigger).`,
		);
	}

	const foreign = checks
		.flatMap((entry) =>
			collectColumnRefs(entry.expression).map((ref) => ({
				check: entry,
				ref,
			})),
		)
		.find(
			({ ref }) =>
				ref.schemaName !== owner.schemaName || ref.tableName !== tableName,
		);
	if (foreign !== undefined) {
		throwHejbroError(
			"check-foreign-column-ref",
			`check "${foreign.check.checkName}" on table "${tableName}" references column "${foreign.ref.schemaName}.${foreign.ref.tableName}.${foreign.ref.columnName}" — a CHECK can only see the row being written. Next: use this table's own columns (the callback's \`t\`), or enforce cross-table rules with a trigger (defineTrigger).`,
		);
	}
};

type IndexPredicateEntry = {
	readonly name: string;
	readonly predicate: ExprNode;
};

/** Every index that declares a `.where(...)` predicate, named (deriving the default index name when none was given) and paired with that predicate — the input `validateIndexPredicates`'s own two rejection checks both scan (#154 ratchet-5: split out so the conditional-`flatMap` construction reads as its own step, separate from what it's built for). */
const indexPredicateEntries = (
	tableName: string,
	indexes: ReadonlyArray<IndexDeclaration>,
): ReadonlyArray<IndexPredicateEntry> =>
	indexes.flatMap((index) => {
		if (index.predicate === null) {
			return [];
		}
		return [
			{
				name:
					index.indexName ??
					deriveIndexName(tableName, namedIndexColumnNames(index.columns)),
				predicate: index.predicate,
			},
		];
	});

/** Rejects a partial index `.where(...)` predicate that contains a subquery or references another table's column, mirroring {@link validateChecks} (D50/D51). */
const validateIndexPredicates = (
	owner: SchemaDeclaration,
	tableName: string,
	indexes: ReadonlyArray<IndexDeclaration>,
): void => {
	const withPredicate = indexPredicateEntries(tableName, indexes);

	const subquery = withPredicate.find((entry) =>
		someExprNode(entry.predicate, (node) => node.nodeKind === "exists"),
	);
	if (subquery !== undefined) {
		throwHejbroError(
			"index-predicate-subquery",
			`index "${subquery.name}"'s where predicate on table "${tableName}" contains a subquery — Postgres forbids subqueries in a partial index's WHERE clause. Next: express the predicate over this table's own columns, or drop the predicate and filter elsewhere.`,
		);
	}

	const foreign = withPredicate
		.flatMap((entry) =>
			collectColumnRefs(entry.predicate).map((ref) => ({
				name: entry.name,
				ref,
			})),
		)
		.find(
			({ ref }) =>
				ref.schemaName !== owner.schemaName || ref.tableName !== tableName,
		);
	if (foreign !== undefined) {
		throwHejbroError(
			"index-predicate-foreign-column-ref",
			`index "${foreign.name}"'s where predicate on table "${tableName}" references column "${foreign.ref.schemaName}.${foreign.ref.tableName}.${foreign.ref.columnName}" — a partial index predicate can only see this table's own columns. Next: use this table's own columns (the callback's \`t\`), or drop the predicate.`,
		);
	}
};

const findForeignColumnRef = (
	owner: SchemaDeclaration,
	tableName: string,
	refs: ReadonlyArray<ColumnRef>,
): ColumnRef | undefined =>
	refs.find(
		(ref) =>
			ref.exprNode.schemaName !== owner.schemaName ||
			ref.exprNode.tableName !== tableName,
	);

type ReferencedTable = {
	readonly schemaName: string;
	readonly tableName: string;
};

/** The first referenced column, or throws when `references.columns` is empty (#154 ratchet-5: split out of resolveReferenceTarget so each of its three sequential checks reads as its own guard). */
const firstReferencedColumnOrThrow = (
	tableName: string,
	columns: ForeignKeyInput["references"]["columns"],
): ColumnRef => {
	const [first] = columns;
	if (first === undefined) {
		return throwHejbroError(
			"foreign-key-empty-references",
			`table "${tableName}" declares a foreign key with no referenced columns (references.columns is empty). Next: list at least one referenced column, e.g. references: { columns: [posts.id] }.`,
		);
	}
	return first;
};

/** Rejects a `references.columns` list spanning more than one table — every column after the first must name the same table `derived` was read from (#154 ratchet-5, see firstReferencedColumnOrThrow). */
const assertSingleReferencedTable = (
	tableName: string,
	derived: ReferencedTable,
	rest: ReadonlyArray<ColumnRef>,
): void => {
	const stray = rest.find(
		(ref) =>
			ref.exprNode.schemaName !== derived.schemaName ||
			ref.exprNode.tableName !== derived.tableName,
	);
	if (stray !== undefined) {
		throwHejbroError(
			"foreign-key-mixed-reference-tables",
			`table "${tableName}" declares a foreign key referencing columns of both "${derived.schemaName}"."${derived.tableName}" and "${stray.exprNode.schemaName}"."${stray.exprNode.tableName}" — a foreign key can only target one table. Next: split it into one foreign key per referenced table.`,
		);
	}
};

/** Rejects an explicit `references.table` that disagrees with the table `references.columns` actually named (#154 ratchet-5, see firstReferencedColumnOrThrow). A no-op when `table` wasn't given at all — inferring it from the columns is the common case. */
const assertReferencesTableMatches = (
	tableName: string,
	derived: ReferencedTable,
	table: ForeignKeyInput["references"]["table"],
): void => {
	if (table === undefined) {
		return;
	}
	const meta = getTableMeta(table);
	if (
		meta.schema.schemaName !== derived.schemaName ||
		meta.tableName !== derived.tableName
	) {
		throwHejbroError(
			"foreign-key-table-mismatch",
			`table "${tableName}" declares a foreign key whose references.columns point at "${derived.schemaName}"."${derived.tableName}" but references.table names "${meta.schema.schemaName}"."${meta.tableName}". Next: drop references.table (it's inferred from the columns) or point both at the same table.`,
		);
	}
};

/** Resolves a foreign key's `references` to its identity parts (D52): the referenced table is derived from the referenced columns' own `exprNode`s, and cross-checked against an explicit `table` when one is given — see the three guards above for each of this function's sequential checks. */
const resolveReferenceTarget = (
	tableName: string,
	references: ForeignKeyInput["references"],
): ForeignKeyReferenceTarget => {
	const first = firstReferencedColumnOrThrow(tableName, references.columns);
	const [, ...rest] = references.columns;
	const derived: ReferencedTable = {
		schemaName: first.exprNode.schemaName,
		tableName: first.exprNode.tableName,
	};
	assertSingleReferencedTable(tableName, derived, rest);
	assertReferencesTableMatches(tableName, derived, references.table);
	return {
		...derived,
		columns: references.columns.map((column) => column.sqlName),
	};
};

/** Narrows an `index()` builder result to exactly `IndexDeclaration`'s own fields — `.on(...)` returns the declaration plus a non-declaration `where(...)` chaining method (D51), which must not leak into the stored declaration. */
const resolveIndex = (input: IndexDeclaration): IndexDeclaration => ({
	columns: input.columns,
	unique: input.unique,
	indexName: input.indexName,
	predicate: input.predicate,
	method: input.method,
});

const resolveForeignKey = (
	owner: SchemaDeclaration,
	tableName: string,
	input: ForeignKeyInput,
): ForeignKeyDeclaration => {
	const foreignRef = findForeignColumnRef(owner, tableName, input.columns);
	if (foreignRef !== undefined) {
		return throwHejbroError(
			"foreign-column-ref",
			`table "${tableName}" received a column of "${foreignRef.exprNode.schemaName}.${foreignRef.exprNode.tableName}" — indexes and local fk columns must use this table's own columns. Next: pass one of "${tableName}"'s own columns instead — to reference "${foreignRef.exprNode.schemaName}.${foreignRef.exprNode.tableName}", use it as a references.table target on a foreign key, not as a local column.`,
		);
	}
	return {
		columns: input.columns.map((column) => column.sqlName),
		references: resolveReferenceTarget(tableName, input.references),
		onDelete: input.onDelete ?? null,
		onUpdate: input.onUpdate ?? null,
	};
};

/** Binds `extras.rls` to its owning table (D25), or `null` when a table declares none — an `if` helper so `table()` never needs a ternary. */
const resolveRls = (
	owner: SchemaDeclaration,
	tableName: string,
	rlsInput: RlsInput | undefined,
): RlsDeclaration | null => {
	if (rlsInput === undefined) {
		return null;
	}
	return bindRls(owner.schemaName, tableName, rlsInput);
};

/**
 * Declares a table under `owner`. Column keys are camelCase in TypeScript
 * and snake_cased in the generated SQL. `extras` receives this table's own
 * columns as typed `ColumnRef`s to build indexes (`index().on(t.column)`),
 * foreign keys, and row-level security (`rls.enabled({...})`).
 */
export const table = <TColumns extends Record<string, ColumnBuilder>>(
	owner: SchemaDeclaration,
	tableName: string,
	columns: TColumns,
	extras?: (t: TableColumns<TColumns>) => TableExtras,
): Table<TColumns> => {
	const declaredAt = captureDeclarationSite();
	assertSqlName(tableName, "table", null);
	const columnEntries = buildColumnEntries(tableName, columns);
	assertNotNullElementsOnArrayColumns(tableName, columnEntries);
	const refsObject = buildColumnRefs<TColumns>(owner, tableName, columnEntries);

	const resolvedExtras = extras?.(refsObject) ?? {};
	const indexes = (resolvedExtras.indexes ?? []).map(resolveIndex);
	const foreignKeys = (resolvedExtras.foreignKeys ?? []).map((input) =>
		resolveForeignKey(owner, tableName, input),
	);
	const checks = [
		...(resolvedExtras.checks ?? []),
		...deriveNotNullElementsChecks(owner, tableName, columnEntries),
	];

	const knownColumnNames = new Set(
		columnEntries.map((entry) => entry.columnName),
	);
	validateColumnRefs(tableName, knownColumnNames, indexes, foreignKeys);
	validateDuplicateNames(tableName, indexes, foreignKeys);
	validateIndexExpressions(owner, tableName, indexes);
	validateChecks(owner, tableName, checks);
	validateIndexPredicates(owner, tableName, indexes);

	const rls = resolveRls(owner, tableName, resolvedExtras.rls);

	const declaration: TableDeclaration = {
		declarationKind: "table",
		schema: owner,
		tableName,
		columns: columnEntries.map((entry) => ({
			columnKey: entry.columnKey,
			columnName: entry.columnName,
			columnState: entry.columnState,
		})),
		indexes,
		foreignKeys,
		checks,
		rls,
		existing: false,
		declaredAt,
	};

	return Object.assign(refsObject, { [tableMeta]: declaration });
};

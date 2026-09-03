import type {
	ColumnBuilder,
	ColumnRef,
	DeclaredTable,
	HejbroInput,
	IndexBuilder,
	IndexColumnInput,
	IndexMethod,
	SchemaDeclaration,
	Table,
} from "@hejbro/core";
import {
	asc,
	check,
	desc,
	existingTable,
	index,
	indexMethods,
	isSqlName,
	op,
	sql,
	table,
	text,
	throwHejbroError,
} from "@hejbro/core";
import { inferColumnKeys } from "./column-keys";
import type {
	ColumnDeclarationResult,
	ColumnLoss,
	InferredColumnFacts,
} from "./columns";
import { inferColumnDeclaration } from "./columns";

export type InferredTableColumn = {
	readonly sqlName: string;
	readonly tsKey: string;
	readonly facts: InferredColumnFacts;
	readonly isPrimaryKey: boolean;
};

export type InferredCheck = {
	readonly name: string;
	readonly expression: string;
};

export type InferredIndexColumn = {
	/** The `pg_attribute` name, when this position is a real column -- `null` for an expression element (`text` carries its raw SQL instead). */
	readonly column: string | null;
	readonly text: string;
	readonly opclass: string;
	readonly opclassIsDefault: boolean;
	readonly descending: boolean;
	readonly nullsFirst: boolean;
};

export type InferredIndex = {
	readonly name: string;
	readonly isUnique: boolean;
	readonly method: string;
	readonly predicate: string | null;
	readonly columns: ReadonlyArray<InferredIndexColumn>;
};

/**
 * One target column of a foreign key, carried with enough of its own
 * facts (1.3's input shape) to pick a matching builder for a reference
 * handle -- never a full column declaration, since the handle this
 * builds (`existingTable`, D41) is never emitted.
 */
export type InferredForeignKeyTargetColumn = {
	readonly sqlName: string;
	readonly facts: InferredColumnFacts;
};

/**
 * A foreign key from this table to `targetSchema`.`targetTable` (the
 * same table, for a self-reference). Built via `existingTable` (D41,
 * CI-G1-R1-06) when the target is a different table: a reference-only
 * handle, never passed to `generateMigration`, never emitted -- so
 * building one table's foreign keys never needs another table's real
 * object to already exist, in either direction of an A/B cycle.
 */
export type InferredForeignKey = {
	/** The catalog's own constraint name (D106 R3-B3) -- declared explicitly when it round-trips through the DSL's own name rule (D36), else approximated by letting it derive; see `foreignKeyNameApproximation`. */
	readonly name: string;
	readonly sourceColumns: ReadonlyArray<string>;
	readonly targetSchema: string;
	readonly targetTable: string;
	readonly targetColumns: ReadonlyArray<InferredForeignKeyTargetColumn>;
	/** Raw `confdeltype`/`confupdtype` char -- `"a"` (no action) is Postgres's own default and is never rendered. */
	readonly onDelete: string;
	readonly onUpdate: string;
};

export type InferredTableFacts = {
	readonly schema: SchemaDeclaration;
	readonly tableName: string;
	readonly columns: ReadonlyArray<InferredTableColumn>;
	readonly foreignKeys: ReadonlyArray<InferredForeignKey>;
	readonly checks: ReadonlyArray<InferredCheck>;
	readonly indexes: ReadonlyArray<InferredIndex>;
};

/** An index or check constraint omitted from its table's own declaration because its catalog name is not a valid hejbro SQL identifier (D106 R4-B1) -- costs that one object, never the table it lives on. */
export type OmittedTableMember = {
	readonly schema: string;
	readonly table: string;
	readonly sqlName: string;
};

export type InferredTableResult = {
	readonly table: HejbroInput;
	readonly losses: ReadonlyArray<ColumnLoss>;
	readonly omittedChecks: ReadonlyArray<OmittedTableMember>;
	readonly omittedIndexes: ReadonlyArray<OmittedTableMember>;
};

const FOREIGN_KEY_ACTION_TOKEN: Readonly<
	Record<string, "cascade" | "restrict" | "set null" | "set default">
> = {
	c: "cascade",
	r: "restrict",
	n: "set null",
	d: "set default",
};

/** Builds `{ [key]: value }`, or `{}` when `value` is `undefined` -- `exactOptionalPropertyTypes` (tsconfig) treats an explicit `key: undefined` as different from the key being absent, and `ForeignKeyInput`'s optional actions require the latter. */
const optionalEntry = <K extends string, V>(
	key: K,
	value: V | undefined,
): Partial<Record<K, V>> => {
	if (value === undefined) {
		return {};
	}
	return { [key]: value } as Partial<Record<K, V>>;
};

/** A raw `pg_am.amname` to `@hejbro/core`'s own `IndexMethod` union -- every access method this module has ever observed (btree/gin, B6) is a member; an unrecognized one is a coded failure rather than a silent misreport. */
const asIndexMethod = (raw: string): IndexMethod => {
	const found = indexMethods.find((method) => method === raw);
	if (found !== undefined) {
		return found;
	}
	return throwHejbroError(
		"infer-index-method-unsupported",
		`hejbro import/pull could not declare an index using access method "${raw}": no column builder DSL supports it. Next: create this index by hand after importing, or open an issue naming the access method.`,
	);
};

/** `undefined` (omit) for `"a"` (no action, Postgres's own default) or any code this map doesn't carry -- declaration-is-truth: only a real, non-default action is ever declared. */
const foreignKeyAction = (
	code: string,
): "cascade" | "restrict" | "set null" | "set default" | undefined =>
	FOREIGN_KEY_ACTION_TOKEN[code];

/**
 * Whether `name` round-trips through the DSL's own D36 rule -- asks
 * `@hejbro/core`'s own `isSqlName` directly, the one predicate for that
 * question, rather than restating its pattern. Shared by every
 * catalog-inference call site that must omit an object rather than let
 * `assertSqlName` abort the whole reading (D106 R4-B1) -- a table,
 * schema, index or check whose catalog name Postgres allowed but hejbro
 * cannot express. A foreign key's own name is the one exception: it
 * keeps its round-trip-or-derive fallback
 * ({@link isExpressibleForeignKeyName}) rather than omission, since a
 * constraint's name is a label on a relation that still exists, while a
 * table/schema/index/check name is the object's own identity.
 */
export const isExpressibleName = isSqlName;

/**
 * D106 R3-B3: whether a foreign key's own catalog name round-trips
 * through the DSL's own D36 rule -- delegates to {@link isExpressibleName},
 * kept as its own named predicate because `infer/loss-report.ts`'s
 * `detectForeignKeyNameApproximations` is this same check's report-side
 * caller, so the two can never drift.
 */
export const isExpressibleForeignKeyName = isExpressibleName;

/**
 * D106 R3-B3: the catalog's own foreign key name, when it round-trips
 * through the DSL's own D36 rule -- `undefined` (omit) otherwise, so
 * `resolveForeignKey` derives instead of throwing `invalid-sql-name` on
 * a database hejbro did not create.
 */
const expressibleForeignKeyName = (name: string): string | undefined => {
	if (isExpressibleForeignKeyName(name)) {
		return name;
	}
	return undefined;
};

/** Postgres's own default nulls placement for a direction -- ASC sorts nulls last, DESC sorts nulls first; only a placement that disagrees with its own direction's default is ever declared explicitly. */
const nullsOverride = (
	descending: boolean,
	nullsFirst: boolean,
): "first" | "last" | undefined => {
	const isDefaultForDirection = descending === nullsFirst;
	if (isDefaultForDirection) {
		return undefined;
	}
	if (nullsFirst) {
		return "first";
	}
	return "last";
};

const bareIndexColumn = (
	column: InferredIndexColumn,
	columnRefBySqlName: ReadonlyMap<string, ColumnRef>,
): ColumnRef | ReturnType<typeof sql.raw> => {
	if (column.column === null) {
		return sql.raw(column.text);
	}
	const ref = columnRefBySqlName.get(column.column);
	if (ref !== undefined) {
		return ref;
	}
	return sql.raw(column.text);
};

const withOpclass = (
	bare: ColumnRef | ReturnType<typeof sql.raw>,
	column: InferredIndexColumn,
): ColumnRef | ReturnType<typeof sql.raw> | ReturnType<typeof op> => {
	if (column.opclassIsDefault) {
		return bare;
	}
	return op(bare, column.opclass);
};

/** `index(name)` with `.unique()`/`.using(method)` applied only when the fact disagrees with Postgres's own default (compact-snapshot rule: btree, non-unique are never rendered). */
const namedIndexWithMethod = (idx: InferredIndex): IndexBuilder => {
	const named = index(idx.name);
	if (idx.isUnique && idx.method === "btree") {
		return named.unique();
	}
	if (idx.isUnique) {
		return named.unique().using(asIndexMethod(idx.method));
	}
	if (idx.method === "btree") {
		return named;
	}
	return named.using(asIndexMethod(idx.method));
};

/** A builder for a never-emitted `existingTable` handle column -- the real type when 1.3 resolves one, `text()` as a harmless stand-in otherwise (the handle is a reference target only; its own column types are never rendered). */
const builderForExistingColumn = (
	facts: InferredColumnFacts,
): ColumnBuilder => {
	const result = inferColumnDeclaration(facts);
	if (result.kind === "declared") {
		return result.builder;
	}
	return text();
};

/**
 * One `existingTable` handle (D41), shared by every foreign key in this
 * run that targets the same identity -- {@link columnKeyBySqlName} lets
 * a caller holding only one foreign key's own (smaller) column subset
 * find its `ColumnRef`s on the shared handle, which was built from the
 * *union* every such foreign key contributes (D106 R6-B1 commit 5.5).
 */
export type ExistingTableHandle = {
	readonly table: DeclaredTable;
	readonly columnKeyBySqlName: ReadonlyMap<string, string>;
};

/**
 * Builds one `existingTable` handle for `targetSchema`.`targetTable`
 * from `columns` (the union of every referencing foreign key's own
 * `targetColumns`, already deduplicated by SQL name) -- ordered here by
 * SQL column name, deterministically, so the same target's columns
 * arrive in the same order regardless of which foreign key's own catalog
 * row happened to list one first (D106 R6-B1 commit 5.5: two import
 * runs, or import and pull over the same database, must mint the same
 * handle).
 */
export const buildExistingTableHandle = (
	targetSchema: string,
	targetTable: string,
	columns: ReadonlyArray<InferredForeignKeyTargetColumn>,
): ExistingTableHandle => {
	const orderedColumns = [...columns].sort((a, b) =>
		a.sqlName.localeCompare(b.sqlName),
	);
	const targetKeys = inferColumnKeys(
		orderedColumns.map((column) => column.sqlName),
	);
	const columnsRecord: Record<string, ColumnBuilder> = Object.fromEntries(
		orderedColumns.map((column, position) => [
			targetKeys[position],
			builderForExistingColumn(column.facts),
		]),
	);
	const table = existingTable(targetSchema, targetTable, columnsRecord);
	const columnKeyBySqlName = new Map(
		orderedColumns.map((column, position) => [
			column.sqlName,
			targetKeys[position] as string,
		]),
	);
	return { table, columnKeyBySqlName };
};

/**
 * The `references` half of a foreign key: this table's own `t` for a
 * self-reference (`table` omitted, core's own D52 rule); the *shared*
 * handle `existingHandles` already built for this target's identity
 * when one exists (D106 R6-B1 commit 5.5: a target this run never read,
 * so the object a foreign key references has to *be* the object
 * `compose.ts` separately declares, or the snapshot would carry two
 * disagreeing nodes for the same identity); a fresh, on-demand
 * `existingTable` reference-only handle (D41) otherwise -- the ordinary
 * case, an in-scope target that is separately declared as a real table
 * elsewhere, where this table's own construction must not wait on it.
 */
const referencesFor = (
	fk: InferredForeignKey,
	facts: InferredTableFacts,
	columnRefBySqlName: ReadonlyMap<string, ColumnRef>,
	existingHandles: ReadonlyMap<string, ExistingTableHandle>,
): { readonly table?: Table; readonly columns: ReadonlyArray<ColumnRef> } => {
	const isSelf =
		fk.targetSchema === facts.schema.schemaName &&
		fk.targetTable === facts.tableName;
	if (isSelf) {
		return {
			columns: fk.targetColumns.map(
				(col) => columnRefBySqlName.get(col.sqlName) as ColumnRef,
			),
		};
	}
	const shared = existingHandles.get(`${fk.targetSchema}.${fk.targetTable}`);
	if (shared !== undefined) {
		const sharedRefs = shared.table as unknown as Record<string, ColumnRef>;
		return {
			table: shared.table,
			columns: fk.targetColumns.map((col) => {
				const key = shared.columnKeyBySqlName.get(col.sqlName) as string;
				return sharedRefs[key] as ColumnRef;
			}),
		};
	}
	const targetKeys = inferColumnKeys(
		fk.targetColumns.map((col) => col.sqlName),
	);
	const targetColumnsRecord: Record<string, ColumnBuilder> = Object.fromEntries(
		fk.targetColumns.map((col, position) => [
			targetKeys[position],
			builderForExistingColumn(col.facts),
		]),
	);
	const handle = existingTable(
		fk.targetSchema,
		fk.targetTable,
		targetColumnsRecord,
	);
	const handleRefs = handle as unknown as Record<string, ColumnRef>;
	return {
		table: handle,
		columns: targetKeys.map((key) => handleRefs[key] as ColumnRef),
	};
};

const indexColumnInput = (
	column: InferredIndexColumn,
	columnRefBySqlName: ReadonlyMap<string, ColumnRef>,
): IndexColumnInput => {
	const opclassed = withOpclass(
		bareIndexColumn(column, columnRefBySqlName),
		column,
	);
	const nulls = nullsOverride(column.descending, column.nullsFirst);
	if (column.descending) {
		if (nulls === undefined) {
			return desc(opclassed);
		}
		return desc(opclassed, { nulls });
	}
	if (nulls !== undefined) {
		return asc(opclassed, { nulls });
	}
	return opclassed;
};

/**
 * Assembles one table's declaration from already-inferred facts (1.1-1.3's
 * output, merged per table): primary key, self-referencing foreign keys,
 * checks and indexes. A column whose type no builder expresses is dropped
 * from the table and reported as a loss (catalog-inference delta) rather
 * than failing the whole table.
 */
export const inferTable = (
	facts: InferredTableFacts,
	existingHandles: ReadonlyMap<string, ExistingTableHandle> = new Map(),
): InferredTableResult => {
	const declarations: ReadonlyArray<{
		readonly column: InferredTableColumn;
		readonly result: ColumnDeclarationResult;
	}> = facts.columns.map((column) => ({
		column,
		result: inferColumnDeclaration(column.facts),
	}));
	const losses = declarations
		.filter((entry) => entry.result.kind === "loss")
		.map((entry) => (entry.result as { readonly loss: ColumnLoss }).loss);
	const declaredEntries = declarations.filter(
		(
			entry,
		): entry is typeof entry & {
			readonly result: {
				readonly kind: "declared";
				readonly builder: ColumnBuilder;
			};
		} => entry.result.kind === "declared",
	);
	const withPrimaryKey = (
		entry: (typeof declaredEntries)[number],
	): ColumnBuilder => {
		if (entry.column.isPrimaryKey) {
			return entry.result.builder.primaryKey();
		}
		return entry.result.builder;
	};
	const columnsRecord: Record<string, ColumnBuilder> = Object.fromEntries(
		declaredEntries.map((entry) => [entry.column.tsKey, withPrimaryKey(entry)]),
	);
	const sqlNameToTsKey = new Map(
		declaredEntries.map((entry) => [entry.column.sqlName, entry.column.tsKey]),
	);

	// D106 R4-B1: a check/index whose own catalog name Postgres allowed but
	// hejbro cannot express (D36) costs that one object, never the table --
	// filtered here, outside the builder callback below, since `check()`/
	// `index()` would otherwise throw `invalid-sql-name` and abort the
	// whole table (unlike a foreign key's name, which falls back to a
	// derived one instead of being omitted).
	const expressibleChecks = facts.checks.filter((c) =>
		isExpressibleName(c.name),
	);
	const omittedChecks: ReadonlyArray<OmittedTableMember> = facts.checks
		.filter((c) => !isExpressibleName(c.name))
		.map((c) => ({
			schema: facts.schema.schemaName,
			table: facts.tableName,
			sqlName: c.name,
		}));
	const expressibleIndexes = facts.indexes.filter((idx) =>
		isExpressibleName(idx.name),
	);
	const omittedIndexes: ReadonlyArray<OmittedTableMember> = facts.indexes
		.filter((idx) => !isExpressibleName(idx.name))
		.map((idx) => ({
			schema: facts.schema.schemaName,
			table: facts.tableName,
			sqlName: idx.name,
		}));

	const builtTable = table(
		facts.schema,
		facts.tableName,
		columnsRecord,
		(t) => {
			const columnRefBySqlName = new Map(
				[...sqlNameToTsKey.entries()].map(([sqlName, tsKey]) => [
					sqlName,
					(t as unknown as Record<string, ColumnRef>)[tsKey] as ColumnRef,
				]),
			);
			const foreignKeys = facts.foreignKeys.map((fk) => ({
				columns: fk.sourceColumns.map(
					(name) => columnRefBySqlName.get(name) as ColumnRef,
				),
				references: referencesFor(
					fk,
					facts,
					columnRefBySqlName,
					existingHandles,
				),
				// D106 R3-B3: the catalog's own name, when expressible --
				// omitted (derives) otherwise, same `exactOptionalPropertyTypes`
				// shape the actions below already use.
				...optionalEntry("name", expressibleForeignKeyName(fk.name)),
				// `exactOptionalPropertyTypes`: an action key is omitted entirely
				// (never set to `undefined`) when Postgres's own default applies.
				...optionalEntry("onDelete", foreignKeyAction(fk.onDelete)),
				...optionalEntry("onUpdate", foreignKeyAction(fk.onUpdate)),
			}));
			const checks = expressibleChecks.map((c) =>
				check(c.name, sql.raw(c.expression)),
			);
			const indexes = expressibleIndexes.map((idx) => {
				const columns = idx.columns.map((column) =>
					indexColumnInput(column, columnRefBySqlName),
				);
				const withMethod = namedIndexWithMethod(idx);
				const onColumns = withMethod.on(...columns);
				if (idx.predicate !== null) {
					return onColumns.where(sql.raw(idx.predicate));
				}
				return onColumns;
			});
			return { foreignKeys, checks, indexes };
		},
	);

	return { table: builtTable, losses, omittedChecks, omittedIndexes };
};

import type {
	ColumnBuilder,
	ColumnRef,
	HejbroInput,
	IndexBuilder,
	IndexColumnInput,
	IndexMethod,
	SchemaDeclaration,
} from "@hejbro/core";
import {
	asc,
	check,
	desc,
	index,
	indexMethods,
	op,
	sql,
	table,
	throwHejbroError,
} from "@hejbro/core";
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
 * A foreign key targeting this same table -- the only kind this module
 * builds (CI-G1-R1-05): a non-self foreign key needs the target table's
 * already-built `ColumnRef`s, which crosses tables built in some order
 * this module does not own (open question, reported alongside this
 * group rather than decided here).
 */
export type InferredSelfForeignKey = {
	readonly sourceColumns: ReadonlyArray<string>;
	readonly targetColumns: ReadonlyArray<string>;
	/** Raw `confdeltype`/`confupdtype` char -- `"a"` (no action) is Postgres's own default and is never rendered. */
	readonly onDelete: string;
	readonly onUpdate: string;
};

export type InferredTableFacts = {
	readonly schema: SchemaDeclaration;
	readonly tableName: string;
	readonly columns: ReadonlyArray<InferredTableColumn>;
	readonly selfForeignKeys: ReadonlyArray<InferredSelfForeignKey>;
	readonly checks: ReadonlyArray<InferredCheck>;
	readonly indexes: ReadonlyArray<InferredIndex>;
};

export type InferredTableResult = {
	readonly table: HejbroInput;
	readonly losses: ReadonlyArray<ColumnLoss>;
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
export const inferTable = (facts: InferredTableFacts): InferredTableResult => {
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
			const foreignKeys = facts.selfForeignKeys.map((fk) => ({
				columns: fk.sourceColumns.map(
					(name) => columnRefBySqlName.get(name) as ColumnRef,
				),
				references: {
					columns: fk.targetColumns.map(
						(name) => columnRefBySqlName.get(name) as ColumnRef,
					),
				},
				// `exactOptionalPropertyTypes`: an action key is omitted entirely
				// (never set to `undefined`) when Postgres's own default applies.
				...optionalEntry("onDelete", foreignKeyAction(fk.onDelete)),
				...optionalEntry("onUpdate", foreignKeyAction(fk.onUpdate)),
			}));
			const checks = facts.checks.map((c) =>
				check(c.name, sql.raw(c.expression)),
			);
			const indexes = facts.indexes.map((idx) => {
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

	return { table: builtTable, losses };
};

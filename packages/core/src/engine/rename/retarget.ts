import type { SelectNode, SetOpNode, WithNode } from "../../expr/ast";
import { decodeExprNode, encodeExprNode } from "../../expr/codec";
import type { RenameTarget } from "../../expr/retarget";
import {
	retargetExprNode,
	retargetSelectNode,
	retargetSetOpNode,
	retargetWithNode,
} from "../../expr/retarget";
import type { KindChange } from "../../kind/object-kind";
import type { PolicySnapshot } from "../../kinds/policy-kind";
import type { RlsSnapshot } from "../../kinds/rls-kind";
import type { SequenceSnapshot } from "../../kinds/sequence-kind";
import {
	deriveForeignKeyName,
	deriveIndexName,
	derivePrimaryKeyName,
	deriveSequenceName,
	deriveUniqueName,
	namedIndexColumnNames,
} from "../../kinds/table-kind";
import type {
	ColumnSnapshot,
	ForeignKeySnapshot,
	IndexColumnSnapshot,
	IndexSnapshot,
	TableSnapshot,
} from "../../kinds/table-snapshot";
import {
	asTableSnapshot,
	columnUniqueName,
	isExpressionIndexColumn,
	tableIdentity,
	tablePrimaryKeyName,
} from "../../kinds/table-snapshot";
import type { TriggerSnapshot } from "../../kinds/trigger-kind";
import type { ViewSnapshot } from "../../kinds/view-kind";
import {
	decodeViewQueryNode,
	encodeViewQueryNode,
	projectionColumns,
	viewQueryColumns,
} from "../../kinds/view-kind";
import type { JsonValue } from "../../snapshot/stable-json";
import { compareKeys } from "../../sort";
import {
	renderForeignKeyConstraintRename,
	renderIndexRename,
	renderSequenceRename,
} from "../../sql/rename-sql";
import type { ObjectsRecord } from "./snapshot-sets";
import {
	entriesWithPrefix,
	POLICY_PREFIX,
	RLS_PREFIX,
	SEQUENCE_PREFIX,
	TABLE_PREFIX,
	TRIGGER_PREFIX,
	VIEW_PREFIX,
} from "./snapshot-sets";

/**
 * A view query is a select, a set operation (add-set-operations), or a
 * `WITH` statement (add-ctes, task 4.3) — retarget dispatches on the
 * stored kind, descending through the wrapper via {@link retargetWithNode}
 * for the last case.
 */
const retargetViewQuery = (
	query: SelectNode | SetOpNode | WithNode,
	target: RenameTarget,
): SelectNode | SetOpNode | WithNode => {
	if (query.queryKind === "with") {
		return retargetWithNode(query, target);
	}
	if (query.queryKind === "setOp") {
		return retargetSetOpNode(query, target);
	}
	return retargetSelectNode(query, target);
};

export type RewriteState = {
	readonly objects: ObjectsRecord;
	readonly statements: ReadonlyArray<string>;
	readonly changes: ReadonlyArray<KindChange>;
	/** `schema.oldName` → current name, accumulated across applied table renames. */
	readonly tableNameByOldKey: ReadonlyMap<string, string>;
};

export const getObject = (
	objects: ObjectsRecord,
	key: string,
): JsonValue | undefined => objects[key];

export const withoutKey = (
	objects: ObjectsRecord,
	key: string,
): ObjectsRecord => {
	const { [key]: _removed, ...rest } = objects;
	return rest;
};

export const setKey = (
	objects: ObjectsRecord,
	key: string,
	value: JsonValue,
): ObjectsRecord => ({
	...objects,
	[key]: value,
});

/** Renames the trailing `schema.oldTable` occurrence in a `rls`/`policy`/`trigger` key to `schema.newTable`. */
export const rekeyTableScopedIdentity = (
	key: string,
	prefix: string,
	schemaName: string,
	oldTableName: string,
	newTableName: string,
): string | null => {
	const oldPrefix = `${prefix}${tableIdentity(schemaName, oldTableName)}`;
	if (key !== oldPrefix && !key.startsWith(`${oldPrefix}.`)) {
		return null;
	}
	return `${prefix}${tableIdentity(schemaName, newTableName)}${key.slice(oldPrefix.length)}`;
};

export type DependentKind = {
	readonly prefix: string;
	readonly setTable: (node: JsonValue, table: string) => JsonValue;
};

export const dependentKinds: ReadonlyArray<DependentKind> = [
	{
		prefix: RLS_PREFIX,
		setTable: (node, table) => ({ ...(node as RlsSnapshot), table }),
	},
	{
		prefix: POLICY_PREFIX,
		setTable: (node, table) => ({ ...(node as PolicySnapshot), table }),
	},
	{
		prefix: TRIGGER_PREFIX,
		setTable: (node, table) => ({ ...(node as TriggerSnapshot), table }),
	},
];

/** Re-keys every `rls`/`policy`/`trigger` entry scoped to the renamed table, updating both its objects key and its `table` field. */
export const rekeyDependentIdentities = (
	objects: ObjectsRecord,
	schemaName: string,
	oldTableName: string,
	newTableName: string,
): ObjectsRecord =>
	dependentKinds.reduce((acc, dependent) => {
		const matches = entriesWithPrefix(acc, dependent.prefix).flatMap(
			([key, node]) => {
				const newKey = rekeyTableScopedIdentity(
					key,
					dependent.prefix,
					schemaName,
					oldTableName,
					newTableName,
				);
				if (newKey === null) {
					return [];
				}
				return [{ oldKey: key, newKey, node }];
			},
		);
		return matches.reduce(
			(inner, match) =>
				setKey(
					withoutKey(inner, match.oldKey),
					match.newKey,
					dependent.setTable(match.node, newTableName),
				),
			acc,
		);
	}, objects);

export const renameIfMatches = (
	value: string,
	oldName: string,
	newName: string,
): string => {
	if (value !== oldName) {
		return value;
	}
	return newName;
};

export const retargetForeignKey = (
	foreignKey: ForeignKeySnapshot,
	oldIdentity: string,
	newIdentity: string,
): ForeignKeySnapshot => {
	if (foreignKey.referencesTable !== oldIdentity) {
		return foreignKey;
	}
	return { ...foreignKey, referencesTable: newIdentity };
};

/** Rewrites every other table's foreign keys pointing at `oldIdentity` to point at `newIdentity` (node only — Postgres tracks FK targets by OID). */
export const rewriteForeignKeyTargets = (
	objects: ObjectsRecord,
	oldIdentity: string,
	newIdentity: string,
): ObjectsRecord =>
	entriesWithPrefix(objects, TABLE_PREFIX).reduce((acc, [key, node]) => {
		const tableSnapshot = asTableSnapshot(node);
		const hasMatch = tableSnapshot.foreignKeys.some(
			(foreignKey) => foreignKey.referencesTable === oldIdentity,
		);
		if (!hasMatch) {
			return acc;
		}
		const rewrittenForeignKeys = tableSnapshot.foreignKeys.map((foreignKey) =>
			retargetForeignKey(foreignKey, oldIdentity, newIdentity),
		);
		return setKey(acc, key, {
			...tableSnapshot,
			foreignKeys: rewrittenForeignKeys,
		});
	}, objects);

export const retargetForeignKeyReferenceColumn = (
	foreignKey: ForeignKeySnapshot,
	identity: string,
	oldColumnName: string,
	newColumnName: string,
): ForeignKeySnapshot => {
	if (foreignKey.referencesTable !== identity) {
		return foreignKey;
	}
	if (!foreignKey.referencesColumns.includes(oldColumnName)) {
		return foreignKey;
	}
	return {
		...foreignKey,
		referencesColumns: foreignKey.referencesColumns.map((column) =>
			renameIfMatches(column, oldColumnName, newColumnName),
		),
	};
};

/** Rewrites every other table's foreign keys' `referencesColumns` entry for a renamed column of `identity`. */
export const rewriteForeignKeyReferenceColumn = (
	objects: ObjectsRecord,
	identity: string,
	oldColumnName: string,
	newColumnName: string,
): ObjectsRecord =>
	entriesWithPrefix(objects, TABLE_PREFIX).reduce((acc, [key, node]) => {
		const tableSnapshot = asTableSnapshot(node);
		const hasMatch = tableSnapshot.foreignKeys.some(
			(foreignKey) =>
				foreignKey.referencesTable === identity &&
				foreignKey.referencesColumns.includes(oldColumnName),
		);
		if (!hasMatch) {
			return acc;
		}
		const rewrittenForeignKeys = tableSnapshot.foreignKeys.map((foreignKey) =>
			retargetForeignKeyReferenceColumn(
				foreignKey,
				identity,
				oldColumnName,
				newColumnName,
			),
		);
		return setKey(acc, key, {
			...tableSnapshot,
			foreignKeys: rewrittenForeignKeys,
		});
	}, objects);

/** `null` when `field` is absent (nothing to retarget) or unaffected (retargeting was a no-op) — `retargetExprNode` returns the exact same reference in that case, so this never re-encodes a node that didn't actually change. */
export const retargetField = (
	field: JsonValue | undefined,
	target: RenameTarget,
): JsonValue | null => {
	if (field === undefined) {
		return null;
	}
	const decoded = decodeExprNode(field);
	const retargeted = retargetExprNode(decoded, target);
	if (retargeted === decoded) {
		return null;
	}
	return encodeExprNode(retargeted);
};

export const applyRetargetedDefault = (
	column: TableSnapshot["columns"][number],
	retargeted: JsonValue | null,
): TableSnapshot["columns"][number] => {
	if (retargeted === null) {
		return column;
	}
	return { ...column, default: retargeted };
};

export const applyRetargetedWhere = (
	index: TableSnapshot["indexes"][number],
	retargeted: JsonValue | null,
): TableSnapshot["indexes"][number] => {
	if (retargeted === null) {
		return index;
	}
	return { ...index, where: retargeted };
};

/** Retargets one index column's `expression` for `target` (R5/R10a) — `null` for a plain (`name`) entry or a no-op retarget, the same convention {@link retargetField} itself uses. */
export const retargetIndexColumnExpression = (
	column: IndexColumnSnapshot,
	target: RenameTarget,
): JsonValue | null => {
	if (!isExpressionIndexColumn(column)) {
		return null;
	}
	return retargetField(column.expression, target);
};

/** Did any of an index's own column expressions actually change? */
export const anyIndexColumnChanged = (
	results: ReadonlyArray<JsonValue | null>,
): boolean => results.some((retargeted) => retargeted !== null);

export const applyRetargetedIndexColumn = (
	column: IndexColumnSnapshot,
	retargeted: JsonValue | null,
): IndexColumnSnapshot => {
	if (retargeted === null || !isExpressionIndexColumn(column)) {
		return column;
	}
	return { ...column, expression: retargeted };
};

/** {@link retargetTableFields}'s fourth field family (R10a): each index column's `expression` retargeted by node, rebuilding the index's `columns` only when at least one actually changed — a no-op index (all `null`s) keeps its exact original object reference, the same short-circuit {@link applyRetargetedWhere} gets from {@link retargetField} returning `null`. */
export const applyRetargetedIndexColumns = (
	index: TableSnapshot["indexes"][number],
	results: ReadonlyArray<JsonValue | null>,
): TableSnapshot["indexes"][number] => {
	if (!anyIndexColumnChanged(results)) {
		return index;
	}
	return {
		...index,
		columns: index.columns.map((column, columnIndex) =>
			applyRetargetedIndexColumn(column, results[columnIndex] ?? null),
		),
	};
};

export const applyRetargetedCheckExpression = (
	check: NonNullable<TableSnapshot["checks"]>[number],
	retargeted: JsonValue | null,
): NonNullable<TableSnapshot["checks"]>[number] => {
	if (retargeted === null) {
		return check;
	}
	return { ...check, expression: retargeted };
};

export type ColumnRetargetResult = readonly [
	TableSnapshot["columns"][number],
	JsonValue | null,
];
export type IndexRetargetResult = readonly [
	TableSnapshot["indexes"][number],
	JsonValue | null,
	ReadonlyArray<JsonValue | null>,
];
export type CheckRetargetResult = readonly [
	NonNullable<TableSnapshot["checks"]>[number],
	JsonValue | null,
];

/** Did retargeting `tableSnapshot`'s columns, indexes (their own `where` or any column's `expression`, R10a), or checks for `target` actually change any of them? */
export const anyFieldChanged = (
	columnResults: ReadonlyArray<ColumnRetargetResult>,
	indexResults: ReadonlyArray<IndexRetargetResult>,
	checkResults: ReadonlyArray<CheckRetargetResult>,
): boolean =>
	columnResults.some(([, retargeted]) => retargeted !== null) ||
	indexResults.some(
		([, whereRetargeted, columnResults]) =>
			whereRetargeted !== null || anyIndexColumnChanged(columnResults),
	) ||
	checkResults.some(([, retargeted]) => retargeted !== null);

/**
 * {@link retargetTableFields}'s `checks` field — `{}` (D33 compact
 * snapshot: an absent key stays absent) when `tableSnapshot` never had a
 * `checks` field to begin with, otherwise the retargeted list. Extracted
 * to module scope (not a nested closure) the same way #154 PR2's
 * `plpgsql/body-context.ts` closures were, so its own `if` doesn't fold
 * into {@link retargetTableFields}'s complexity.
 */
export const checksPatch = (
	tableSnapshot: TableSnapshot,
	checkResults: ReadonlyArray<CheckRetargetResult>,
): Pick<TableSnapshot, "checks"> | Record<string, never> => {
	if (tableSnapshot.checks === undefined) {
		return {};
	}
	return {
		checks: checkResults.map(([check, retargeted]) =>
			applyRetargetedCheckExpression(check, retargeted),
		),
	};
};

export const retargetTableFields = (
	tableSnapshot: TableSnapshot,
	target: RenameTarget,
): TableSnapshot | null => {
	const columnResults = tableSnapshot.columns.map(
		(column) => [column, retargetField(column.default, target)] as const,
	);
	const indexResults = tableSnapshot.indexes.map(
		(index) =>
			[
				index,
				retargetField(index.where, target),
				index.columns.map((column) =>
					retargetIndexColumnExpression(column, target),
				),
			] as const,
	);
	const checkResults = (tableSnapshot.checks ?? []).map(
		(check) => [check, retargetField(check.expression, target)] as const,
	);
	if (!anyFieldChanged(columnResults, indexResults, checkResults)) {
		return null;
	}
	return {
		...tableSnapshot,
		columns: columnResults.map(([column, retargeted]) =>
			applyRetargetedDefault(column, retargeted),
		),
		indexes: indexResults.map(([index, whereRetargeted, columnResults]) =>
			applyRetargetedIndexColumns(
				applyRetargetedWhere(index, whereRetargeted),
				columnResults,
			),
		),
		...checksPatch(tableSnapshot, checkResults),
	};
};

export const usingPatch = (
	using: JsonValue | null,
): Pick<PolicySnapshot, "using"> | Record<string, never> => {
	if (using === null) {
		return {};
	}
	return { using };
};

export const withCheckPatch = (
	withCheck: JsonValue | null,
): Pick<PolicySnapshot, "withCheck"> | Record<string, never> => {
	if (withCheck === null) {
		return {};
	}
	return { withCheck };
};

export const retargetPolicyFields = (
	policySnapshot: PolicySnapshot,
	target: RenameTarget,
): PolicySnapshot | null => {
	const using = retargetField(policySnapshot.using, target);
	const withCheck = retargetField(policySnapshot.withCheck, target);
	if (using === null && withCheck === null) {
		return null;
	}
	return {
		...policySnapshot,
		...usingPatch(using),
		...withCheckPatch(withCheck),
	};
};

/**
 * @see retargetTableFields, retargetPolicyFields — the view counterpart.
 * The view's `query` is a whole {@link SelectNode}, not an `ExprNode`
 * wrapped one like `default`/`where`/`using`/`withCheck` are, so this
 * decodes/retargets/encodes it directly rather than going through
 * {@link retargetField} (#157/D72).
 * Two fields, not one: `query` (the structured node itself) and
 * `columns` (D27's denormalized column-name list, derived from the
 * query's projection at `serialize` time) — a column rename that touches
 * an `allColumns` projection's `columnNames` must recompute `columns`
 * the same way `serialize` derived it the first time
 * ({@link projectionColumns}), or it goes stale and the D27 prefix-rule
 * diff compares an old name against a new one.
 */
export const retargetViewFields = (
	viewSnapshot: ViewSnapshot,
	target: RenameTarget,
): ViewSnapshot | null => {
	const decoded = decodeViewQueryNode(viewSnapshot.query);
	const retargeted = retargetViewQuery(decoded, target);
	if (retargeted === decoded) {
		return null;
	}
	return {
		...viewSnapshot,
		columns: viewQueryColumns(retargeted),
		query: encodeViewQueryNode(retargeted),
	};
};

/**
 * Retargets every stored expression node (D67/D70) that mentions the
 * renamed table/column — column default, CHECK expression, partial index
 * `where`, **an index column's own `expression` (R5/R10a — a rename
 * touching only an expression index is recognised as a reference, not a
 * drop + add)**, every table's policies' `using`/`withCheck`, and every
 * view's `query` (#157/D72) — across the *whole* snapshot, not just the
 * renamed table's own node. This is the point of storing expressions
 * structurally
 * instead of as rendered text: without it, a rename leaves stale
 * identifiers behind wherever an expression mentioned the old name.
 *
 * Full-scan, mirroring {@link rewriteForeignKeyTargets}'s established
 * pattern (this codebase already accepts that cost for foreign keys) --
 * a `using`/`withCheck` clause can `exists()` into *another* table
 * (rls.ts's own validator message teaches exactly this: "reach other
 * tables through exists()"), so a table rename can affect a policy
 * declared on a completely different table. Confirmed unreachable any
 * other way by direct reproduction before this function existed (#110
 * item 18) -- renaming the exists()-referenced table left the other
 * table's policy pointing at the old name, with nothing else catching it.
 * A view's `from`/`joins` reach another table *directly* (not just
 * through `exists()`), so the same full-scan is needed there too, not
 * just for whichever table the view happens to be declared "on" (a view
 * has no such notion — its only table references are whatever its query
 * selects from).
 *
 * Only entries with an actual match are rewritten (a `hasMatch`-style
 * short-circuit, same shape as {@link rewriteForeignKeyTargets}) — an
 * unaffected table, policy, or view keeps its exact original object
 * reference.
 */
export const rewriteExpressionReferences = (
	objects: ObjectsRecord,
	target: RenameTarget,
): ObjectsRecord => {
	const withRetargetedTables = entriesWithPrefix(objects, TABLE_PREFIX).reduce(
		(acc, [key, node]) => {
			const retargeted = retargetTableFields(asTableSnapshot(node), target);
			if (retargeted === null) {
				return acc;
			}
			return setKey(acc, key, retargeted);
		},
		objects,
	);

	const withRetargetedViews = entriesWithPrefix(
		withRetargetedTables,
		VIEW_PREFIX,
	).reduce((acc, [key, node]) => {
		const retargeted = retargetViewFields(node as ViewSnapshot, target);
		if (retargeted === null) {
			return acc;
		}
		return setKey(acc, key, retargeted);
	}, withRetargetedTables);

	return entriesWithPrefix(withRetargetedViews, POLICY_PREFIX).reduce(
		(acc, [key, node]) => {
			const retargeted = retargetPolicyFields(node as PolicySnapshot, target);
			if (retargeted === null) {
				return acc;
			}
			return setKey(acc, key, retargeted);
		},
		withRetargetedViews,
	);
};

// --- table-node level index/FK rewriting -------------------------------

export const renameColumnInList = (
	columns: ReadonlyArray<string>,
	oldName: string,
	newName: string,
): ReadonlyArray<string> =>
	columns.map((column) => renameIfMatches(column, oldName, newName));

/** `entry.columns` renamed for a column-rename spec, or unchanged for a table-rename spec (`oldColumnName`/`newColumnName` both `null`). */
export const resolveRenamedColumns = (
	columns: ReadonlyArray<string>,
	oldColumnName: string | null,
	newColumnName: string | null,
): ReadonlyArray<string> => {
	if (oldColumnName === null || newColumnName === null) {
		return columns;
	}
	return renameColumnInList(columns, oldColumnName, newColumnName);
};

/** Renames each `name` entry of an index's column list for a column-rename spec; an expression entry (R5) is retargeted by node (`applyRetargetedIndexColumns`), not renamed by name, so it passes through unchanged here. */
export const renameNamedIndexColumns = (
	columns: ReadonlyArray<IndexColumnSnapshot>,
	oldColumnName: string | null,
	newColumnName: string | null,
): ReadonlyArray<IndexColumnSnapshot> =>
	columns.map((column) => {
		if (!("name" in column)) {
			return column;
		}
		const [renamed] = resolveRenamedColumns(
			[column.name],
			oldColumnName,
			newColumnName,
		);
		return { ...column, name: renamed ?? column.name };
	});

/** Rewrites one table's indexes for either a table rename (new table name, unchanged columns) or a column rename (unchanged table name, one renamed column) — synthesizing derived-name rename statements only for names that were actually `derive(...)`-generated (algorithm step 4). An expression entry (R5) names no column of its own, so it's excluded from derived-name recomputation (R10b) — see {@link renameNamedIndexColumns} for its own (node-level) retargeting. */
export const rewriteIndexesForRename = (
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	oldColumnName: string | null,
	newColumnName: string | null,
	indexes: ReadonlyArray<IndexSnapshot>,
): {
	readonly indexes: ReadonlyArray<IndexSnapshot>;
	readonly statements: ReadonlyArray<string>;
} => {
	const sorted = [...indexes].sort((a, b) => compareKeys(a.name, b.name));
	const rewritten = sorted.map((entry) => {
		const oldDerivedName = deriveIndexName(
			oldTableName,
			namedIndexColumnNames(entry.columns),
		);
		const newColumns = renameNamedIndexColumns(
			entry.columns,
			oldColumnName,
			newColumnName,
		);
		const wasDerived = entry.name === oldDerivedName;
		if (!wasDerived) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		const newDerivedName = deriveIndexName(
			newTableName,
			namedIndexColumnNames(newColumns),
		);
		if (newDerivedName === entry.name) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		return {
			entry: { ...entry, name: newDerivedName, columns: newColumns },
			statement: renderIndexRename(schemaName, entry.name, newDerivedName),
		};
	});
	return {
		indexes: rewritten.map((r) => r.entry),
		statements: rewritten
			.map((r) => r.statement)
			.filter((s): s is string => s !== null),
	};
};

/** @see rewriteIndexesForRename — the foreign-key counterpart (`rename constraint`, current/new table name). */
export const rewriteForeignKeysForRename = (
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	oldColumnName: string | null,
	newColumnName: string | null,
	foreignKeys: ReadonlyArray<ForeignKeySnapshot>,
): {
	readonly foreignKeys: ReadonlyArray<ForeignKeySnapshot>;
	readonly statements: ReadonlyArray<string>;
} => {
	const sorted = [...foreignKeys].sort((a, b) => compareKeys(a.name, b.name));
	const rewritten = sorted.map((entry) => {
		const oldDerivedName = deriveForeignKeyName(oldTableName, entry.columns);
		const newColumns = resolveRenamedColumns(
			entry.columns,
			oldColumnName,
			newColumnName,
		);
		const wasDerived = entry.name === oldDerivedName;
		if (!wasDerived) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		const newDerivedName = deriveForeignKeyName(newTableName, newColumns);
		if (newDerivedName === entry.name) {
			return { entry: { ...entry, columns: newColumns }, statement: null };
		}
		return {
			entry: { ...entry, name: newDerivedName, columns: newColumns },
			statement: renderForeignKeyConstraintRename(
				schemaName,
				newTableName,
				entry.name,
				newDerivedName,
			),
		};
	});
	return {
		foreignKeys: rewritten.map((r) => r.entry),
		statements: rewritten
			.map((r) => r.statement)
			.filter((s): s is string => s !== null),
	};
};

/**
 * @see rewriteIndexesForRename, rewriteForeignKeysForRename — the primary
 * key counterpart (#24), with one structural difference in the *other*
 * direction from `rewriteSequencesForRename`'s: a table has at most one
 * primary key, a single optional field on the table's own node
 * (`TableSnapshot.primaryKeyName`), never an array to `.map` over.
 *
 * `derivePrimaryKeyName` depends only on the table name, never the member
 * columns (measured against `pg_dump`: renaming a table's primary-key
 * columns never renames its `<table>_pkey` constraint on its own, but
 * neither does the constraint's name have anything to say about *which*
 * columns it covers). A **column** rename therefore never changes this
 * name — callers only need this on the table-rename path (`oldColumnName`/
 * `newColumnName` both `null` in that call; `applyColumnRename` doesn't
 * call this at all, unlike the index/FK/unique cases).
 */
/** `[]` for `null`, `[maybeStatement]` otherwise — `applyTableRename`'s statements array `...spread`s a possibly-absent rename statement the same way it spreads every array-sourced one. */
export const statementStringOrEmpty = (
	maybeStatement: string | null,
): ReadonlyArray<string> => {
	if (maybeStatement === null) {
		return [];
	}
	return [maybeStatement];
};

/** `{ ...node, primaryKeyName: name }` when `name` is given, else `node` unchanged — `rewritePrimaryKeyForRename` only omits `primaryKeyName` from its result when the table never had one, so `undefined` here always means "leave absent," never "clear an existing value." */
export const withPrimaryKeyName = (
	node: TableSnapshot,
	name: string | undefined,
): TableSnapshot => {
	if (name === undefined) {
		return node;
	}
	return { ...node, primaryKeyName: name };
};

export const rewritePrimaryKeyForRename = (
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	table: TableSnapshot,
): { readonly primaryKeyName?: string; readonly statement: string | null } => {
	const previousName = tablePrimaryKeyName(table);
	if (previousName === null) {
		return { statement: null };
	}
	const oldDerivedName = derivePrimaryKeyName(oldTableName);
	const wasDerived = previousName === oldDerivedName;
	if (!wasDerived) {
		return { primaryKeyName: previousName, statement: null };
	}
	const newDerivedName = derivePrimaryKeyName(newTableName);
	if (newDerivedName === previousName) {
		return { primaryKeyName: previousName, statement: null };
	}
	return {
		primaryKeyName: newDerivedName,
		statement: renderForeignKeyConstraintRename(
			schemaName,
			newTableName,
			previousName,
			newDerivedName,
		),
	};
};

/**
 * @see rewriteIndexesForRename, rewriteForeignKeysForRename — the
 * `ColumnSnapshot.uniqueName` counterpart (#24): unlike the primary key,
 * `deriveUniqueName` depends on *both* the table name and the column's own
 * name, the same shape as index/FK, so both the table-rename and the
 * column-rename paths need this (mirrors those two exactly, down to the
 * per-entry `wasDerived` check — a column whose recorded `uniqueName`
 * doesn't match `deriveUniqueName(oldTableName, oldColumnName)` was never
 * following the derivation in the first place, today only reachable
 * through a hand-edited or round-tripped snapshot, D33, since there is no
 * DSL surface to author a custom unique-constraint name). UNIQUE's own
 * *emission* stays out of scope this wave (`table-kind-emit.ts`'s
 * surviving `unsupported-column-alter` guard) — this only keeps the
 * recorded name from drifting out from under a rename.
 */
export const rewriteUniqueNamesForRename = (
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	oldColumnName: string | null,
	newColumnName: string | null,
	columns: ReadonlyArray<ColumnSnapshot>,
): {
	readonly columns: ReadonlyArray<ColumnSnapshot>;
	readonly statements: ReadonlyArray<string>;
} => {
	const rewritten = columns.map((column) => {
		// Every column's own `name` field is renamed here, unconditionally
		// (matching `oldColumnName` if given), the same way
		// rewriteIndexesForRename/rewriteForeignKeysForRename rename their
		// own nested column-name arrays -- callers pass this function's
		// `columns` result on, rather than separately renaming columns
		// themselves, so the rename happens exactly once.
		const newName =
			resolveRenamedColumns([column.name], oldColumnName, newColumnName)[0] ??
			column.name;
		const previousUniqueName = columnUniqueName(column);
		if (previousUniqueName === null) {
			return { entry: { ...column, name: newName }, statement: null };
		}
		const oldDerivedName = deriveUniqueName(oldTableName, column.name);
		const wasDerived = previousUniqueName === oldDerivedName;
		if (!wasDerived) {
			return { entry: { ...column, name: newName }, statement: null };
		}
		const newDerivedName = deriveUniqueName(newTableName, newName);
		if (newDerivedName === previousUniqueName) {
			return { entry: { ...column, name: newName }, statement: null };
		}
		return {
			entry: { ...column, name: newName, uniqueName: newDerivedName },
			statement: renderForeignKeyConstraintRename(
				schemaName,
				newTableName,
				previousUniqueName,
				newDerivedName,
			),
		};
	});
	return {
		columns: rewritten.map((r) => r.entry),
		statements: rewritten
			.map((r) => r.statement)
			.filter((s): s is string => s !== null),
	};
};

/**
 * @see rewriteIndexesForRename, rewriteForeignKeysForRename — the
 * `sequence` counterpart (#23/D66), with one structural difference: a
 * sequence is its own top-level snapshot object (`sequence:<schema>.
 * <name>`), not a nested array inside the owning table's own node, so
 * renaming it (when its stored name was actually `deriveSequenceName(...)`
 * — the same `wasDerived` guard the index/FK case uses, never touching a
 * name reachable today through a hand-edited or round-tripped snapshot
 * (D33) — there is no DSL surface to author one directly, but D33 makes a
 * snapshot on disk the ground truth regardless) means re-keying its `objects`
 * entry, not just editing a field in place. Operates on the whole
 * `objects` record directly (mirroring `rewriteForeignKeyTargets`'s
 * full-scan style) rather than on one table's own nested arrays, since
 * that is where a top-level kind's entries live.
 */
/** Does `sequence` belong to the table/column {@link rewriteSequencesForRename} is renaming? */
export const matchesSequenceRename = (
	sequence: SequenceSnapshot,
	schemaName: string,
	oldTableName: string,
	oldColumnName: string | null,
): boolean =>
	sequence.schema === schemaName &&
	sequence.table === oldTableName &&
	(oldColumnName === null || sequence.column === oldColumnName);

export type SequenceRewriteAcc = {
	readonly objects: ObjectsRecord;
	readonly statements: ReadonlyArray<string>;
};

/**
 * {@link rewriteSequencesForRename}'s own `.reduce()` step, one matching
 * sequence at a time — extracted to module scope (not a nested closure)
 * so its own if/else cascade doesn't fold into the calling function's
 * complexity, the same de-nesting #154 PR2 already applied to
 * `plpgsql/body-context.ts`'s recording closures.
 */
export const rewriteSequenceEntry = (
	acc: SequenceRewriteAcc,
	[oldKey, sequence]: readonly [string, SequenceSnapshot],
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	oldColumnName: string | null,
	newColumnName: string | null,
): SequenceRewriteAcc => {
	const newColumn = resolveRenamedColumns(
		[sequence.column],
		oldColumnName,
		newColumnName,
	)[0];
	if (newColumn === undefined) {
		return acc;
	}
	const oldDerivedName = deriveSequenceName(oldTableName, sequence.column);
	const wasDerived = sequence.name === oldDerivedName;
	if (!wasDerived) {
		const updated: SequenceSnapshot = {
			...sequence,
			table: newTableName,
			column: newColumn,
		};
		return {
			objects: setKey(acc.objects, oldKey, updated),
			statements: acc.statements,
		};
	}
	const newDerivedName = deriveSequenceName(newTableName, newColumn);
	const updated: SequenceSnapshot = {
		...sequence,
		name: newDerivedName,
		table: newTableName,
		column: newColumn,
	};
	const newKey = `${SEQUENCE_PREFIX}${schemaName}.${newDerivedName}`;
	const withRekeyed = setKey(withoutKey(acc.objects, oldKey), newKey, updated);
	if (newDerivedName === sequence.name) {
		return { objects: withRekeyed, statements: acc.statements };
	}
	return {
		objects: withRekeyed,
		statements: [
			...acc.statements,
			renderSequenceRename(schemaName, sequence.name, newDerivedName),
		],
	};
};

export const rewriteSequencesForRename = (
	objects: ObjectsRecord,
	schemaName: string,
	oldTableName: string,
	newTableName: string,
	oldColumnName: string | null,
	newColumnName: string | null,
): {
	readonly objects: ObjectsRecord;
	readonly statements: ReadonlyArray<string>;
} => {
	const matches = entriesWithPrefix(objects, SEQUENCE_PREFIX)
		.map(([key, node]) => [key, node as SequenceSnapshot] as const)
		.filter(([, sequence]) =>
			matchesSequenceRename(sequence, schemaName, oldTableName, oldColumnName),
		)
		.sort(([, a], [, b]) => compareKeys(a.name, b.name));

	return matches.reduce(
		(acc, entry) =>
			rewriteSequenceEntry(
				acc,
				entry,
				schemaName,
				oldTableName,
				newTableName,
				oldColumnName,
				newColumnName,
			),
		{ objects, statements: [] as ReadonlyArray<string> },
	);
};

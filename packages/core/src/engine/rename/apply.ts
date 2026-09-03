import type { KindChange } from "../../kind/object-kind";
import type { TableSnapshot } from "../../kinds/table-snapshot";
import { asTableSnapshot, tableIdentity } from "../../kinds/table-snapshot";
import { compareKeys } from "../../sort";
import { renderColumnRename, renderTableRename } from "../../sql/rename-sql";
import type { RewriteState } from "./retarget";
import {
	getObject,
	rekeyDependentIdentities,
	rewriteExpressionReferences,
	rewriteForeignKeyReferenceColumn,
	rewriteForeignKeysForRename,
	rewriteForeignKeyTargets,
	rewriteIndexesForRename,
	rewritePrimaryKeyForRename,
	rewriteSequencesForRename,
	rewriteUniqueNamesForRename,
	setKey,
	statementStringOrEmpty,
	withoutKey,
	withPrimaryKeyName,
} from "./retarget";
import type { ObjectsRecord } from "./snapshot-sets";
import { TABLE_PREFIX } from "./snapshot-sets";
import type { ColumnRenameSpec, RenameSpec, TableRenameSpec } from "./types";

export const applyTableRename = (
	state: RewriteState,
	spec: TableRenameSpec,
): RewriteState => {
	const oldIdentity = tableIdentity(spec.schemaName, spec.oldName);
	const newIdentity = tableIdentity(spec.schemaName, spec.newName);
	const oldKey = `${TABLE_PREFIX}${oldIdentity}`;
	const raw = getObject(state.objects, oldKey);
	if (raw === undefined) {
		return state;
	}
	const tableSnapshot = asTableSnapshot(raw);

	const indexResult = rewriteIndexesForRename(
		spec.schemaName,
		spec.oldName,
		spec.newName,
		null,
		null,
		tableSnapshot.indexes,
	);
	const foreignKeyResult = rewriteForeignKeysForRename(
		spec.schemaName,
		spec.oldName,
		spec.newName,
		null,
		null,
		tableSnapshot.foreignKeys,
	);
	const primaryKeyResult = rewritePrimaryKeyForRename(
		spec.schemaName,
		spec.oldName,
		spec.newName,
		tableSnapshot,
	);
	const uniqueNameResult = rewriteUniqueNamesForRename(
		spec.schemaName,
		spec.oldName,
		spec.newName,
		null,
		null,
		tableSnapshot.columns,
	);

	const renamedNode: TableSnapshot = withPrimaryKeyName(
		{
			...tableSnapshot,
			name: spec.newName,
			columns: uniqueNameResult.columns,
			indexes: indexResult.indexes,
			foreignKeys: foreignKeyResult.foreignKeys,
		},
		primaryKeyResult.primaryKeyName,
	);

	const withoutOld = withoutKey(state.objects, oldKey);
	const withNewTable = setKey(
		withoutOld,
		`${TABLE_PREFIX}${newIdentity}`,
		renamedNode,
	);
	const withDependents = rekeyDependentIdentities(
		withNewTable,
		spec.schemaName,
		spec.oldName,
		spec.newName,
	);
	const withForeignKeyTargets = rewriteForeignKeyTargets(
		withDependents,
		oldIdentity,
		newIdentity,
	);
	const withExpressionReferences = rewriteExpressionReferences(
		withForeignKeyTargets,
		{
			oldSchema: spec.schemaName,
			oldTable: spec.oldName,
			newSchema: spec.schemaName,
			newTable: spec.newName,
			oldColumn: null,
			newColumn: null,
		},
	);
	const sequenceResult = rewriteSequencesForRename(
		withExpressionReferences,
		spec.schemaName,
		spec.oldName,
		spec.newName,
		null,
		null,
	);

	const change: KindChange = {
		kind: "table",
		operation: "alter",
		identity: oldIdentity,
		previous: null,
		next: null,
		notes: [`renamed to "${spec.newName}"`],
	};

	return {
		objects: sequenceResult.objects,
		statements: [
			...state.statements,
			renderTableRename(spec),
			...indexResult.statements,
			...foreignKeyResult.statements,
			...statementStringOrEmpty(primaryKeyResult.statement),
			...uniqueNameResult.statements,
			...sequenceResult.statements,
		],
		changes: [...state.changes, change],
		tableNameByOldKey: new Map([
			...state.tableNameByOldKey,
			[oldIdentity, spec.newName],
		]),
	};
};

export const applyColumnRename = (
	state: RewriteState,
	spec: ColumnRenameSpec,
): RewriteState => {
	const effectiveTableName =
		state.tableNameByOldKey.get(
			tableIdentity(spec.schemaName, spec.tableName),
		) ?? spec.tableName;
	const identity = tableIdentity(spec.schemaName, effectiveTableName);
	const key = `${TABLE_PREFIX}${identity}`;
	const raw = getObject(state.objects, key);
	if (raw === undefined) {
		return state;
	}
	const tableSnapshot = asTableSnapshot(raw);

	const indexResult = rewriteIndexesForRename(
		spec.schemaName,
		effectiveTableName,
		effectiveTableName,
		spec.oldName,
		spec.newName,
		tableSnapshot.indexes,
	);
	const foreignKeyResult = rewriteForeignKeysForRename(
		spec.schemaName,
		effectiveTableName,
		effectiveTableName,
		spec.oldName,
		spec.newName,
		tableSnapshot.foreignKeys,
	);
	// derivePrimaryKeyName is column-name-independent (rewritePrimaryKeyForRename's
	// own doc comment) -- a column rename never touches it, so there is no
	// call here, unlike the index/FK/unique cases right above and below.
	const uniqueNameResult = rewriteUniqueNamesForRename(
		spec.schemaName,
		effectiveTableName,
		effectiveTableName,
		spec.oldName,
		spec.newName,
		tableSnapshot.columns,
	);

	const renamedNode: TableSnapshot = {
		...tableSnapshot,
		columns: uniqueNameResult.columns,
		indexes: indexResult.indexes,
		foreignKeys: foreignKeyResult.foreignKeys,
	};

	const withTable = setKey(state.objects, key, renamedNode);
	const withForeignKeyReferences = rewriteForeignKeyReferenceColumn(
		withTable,
		identity,
		spec.oldName,
		spec.newName,
	);
	const withExpressionReferences = rewriteExpressionReferences(
		withForeignKeyReferences,
		{
			oldSchema: spec.schemaName,
			oldTable: effectiveTableName,
			newSchema: spec.schemaName,
			newTable: effectiveTableName,
			oldColumn: spec.oldName,
			newColumn: spec.newName,
		},
	);
	const sequenceResult = rewriteSequencesForRename(
		withExpressionReferences,
		spec.schemaName,
		effectiveTableName,
		effectiveTableName,
		spec.oldName,
		spec.newName,
	);

	const change: KindChange = {
		kind: "table",
		operation: "alter",
		identity,
		previous: null,
		next: null,
		notes: [`column "${spec.oldName}" renamed to "${spec.newName}"`],
	};

	return {
		objects: sequenceResult.objects,
		statements: [
			...state.statements,
			renderColumnRename({ ...spec, tableName: effectiveTableName }),
			...indexResult.statements,
			...foreignKeyResult.statements,
			...uniqueNameResult.statements,
			...sequenceResult.statements,
		],
		changes: [...state.changes, change],
		tableNameByOldKey: state.tableNameByOldKey,
	};
};

/** A rename spec's target identity, for deterministic (compareKeys) ordering — independent of argv input order. */
export const renameSpecTargetIdentity = (spec: RenameSpec): string => {
	if (spec.target === "table") {
		return `${tableIdentity(spec.schemaName, spec.oldName)}`;
	}
	return `${tableIdentity(spec.schemaName, spec.tableName)}.${spec.oldName}`;
};

export const applyRenameSpecs = (
	objects: ObjectsRecord,
	validSpecs: ReadonlyArray<RenameSpec>,
): {
	readonly objects: ObjectsRecord;
	readonly statements: ReadonlyArray<string>;
	readonly changes: ReadonlyArray<KindChange>;
} => {
	const byTargetIdentity = (a: RenameSpec, b: RenameSpec): number =>
		compareKeys(renameSpecTargetIdentity(a), renameSpecTargetIdentity(b));
	const tableRenames = validSpecs
		.filter((spec): spec is TableRenameSpec => spec.target === "table")
		.sort(byTargetIdentity);
	const columnRenames = validSpecs
		.filter((spec): spec is ColumnRenameSpec => spec.target === "column")
		.sort(byTargetIdentity);

	const initial: RewriteState = {
		objects,
		statements: [],
		changes: [],
		tableNameByOldKey: new Map(),
	};

	const afterTableRenames = tableRenames.reduce(applyTableRename, initial);
	const afterColumnRenames = columnRenames.reduce(
		applyColumnRename,
		afterTableRenames,
	);

	return {
		objects: afterColumnRenames.objects,
		statements: afterColumnRenames.statements,
		changes: afterColumnRenames.changes,
	};
};

// --- Step 5: residual ambiguity ----------------------------------------

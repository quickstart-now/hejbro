import { assertNever, throwHejbroError } from "../error";
import { diffByKey, sameJson } from "../kind/diff-helpers";
import type { KindChange } from "../kind/object-kind";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import type { SqlStatement } from "../sql/statement";
import { deferredStatement, statement } from "../sql/statement";
import type { TypeNode } from "../types/type-node";
import { renderTypeNode } from "../types/type-node";
import {
	addCheckConstraintSql,
	addForeignKeyConstraintSql,
	createIndexSql,
	createTableSql,
	dropConstraintSql,
	renderColumnDefinition,
} from "./table-kind-emit-sql";
import type { ColumnSnapshot, TableSnapshot } from "./table-snapshot";
import {
	asTableSnapshot,
	columnDefault,
	columnNotNull,
	columnPrimaryKey,
	columnUnique,
	tableChecks,
} from "./table-snapshot";

const emitCreate = (next: TableSnapshot): ReadonlyArray<SqlStatement> => [
	statement(createTableSql(next)),
	...next.indexes.map((index) =>
		statement(createIndexSql(next.schema, next.name, index)),
	),
	...next.foreignKeys.map((foreignKey) =>
		deferredStatement(
			addForeignKeyConstraintSql(next.schema, next.name, foreignKey),
		),
	),
];

const emitDrop = (previous: TableSnapshot): ReadonlyArray<SqlStatement> => [
	statement(`drop table ${qualifyName(previous.schema, previous.name)};`),
];

const typeAlterStatements = (
	schema: string,
	tableName: string,
	key: string,
	changed: boolean,
	nextTypeNode: TypeNode,
): ReadonlyArray<SqlStatement> => {
	if (!changed) {
		return [];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} type ${renderTypeNode(nextTypeNode)};`,
		),
	];
};

const notNullAlterStatements = (
	schema: string,
	tableName: string,
	key: string,
	changed: boolean,
	nextNotNull: boolean,
): ReadonlyArray<SqlStatement> => {
	if (!changed) {
		return [];
	}
	if (nextNotNull) {
		return [
			statement(
				`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} set not null;`,
			),
		];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} drop not null;`,
		),
	];
};

const defaultAlterStatements = (
	schema: string,
	tableName: string,
	key: string,
	changed: boolean,
	nextDefault: string | null,
): ReadonlyArray<SqlStatement> => {
	if (!changed) {
		return [];
	}
	if (nextDefault === null) {
		return [
			statement(
				`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} drop default;`,
			),
		];
	}
	return [
		statement(
			`alter table ${qualifyName(schema, tableName)} alter column ${quoteIdentifier(key)} set default ${nextDefault};`,
		),
	];
};

const alterColumnStatements = (
	schema: string,
	tableName: string,
	entry: {
		readonly key: string;
		readonly previous: ColumnSnapshot;
		readonly next: ColumnSnapshot;
	},
): ReadonlyArray<SqlStatement> => {
	const typeChanged = !sameJson(entry.previous.typeNode, entry.next.typeNode);
	const notNullChanged =
		columnNotNull(entry.previous) !== columnNotNull(entry.next);
	const defaultChanged = !sameJson(
		columnDefault(entry.previous),
		columnDefault(entry.next),
	);
	const uniqueChanged =
		columnUnique(entry.previous) !== columnUnique(entry.next);
	const primaryKeyChanged =
		columnPrimaryKey(entry.previous) !== columnPrimaryKey(entry.next);

	if (primaryKeyChanged) {
		return throwHejbroError(
			"unsupported-column-alter",
			`column "${entry.key}" on table "${tableName}" changed its primary key status — hejbro does not support in-place primary key alters in Phase 1 (primary key changes are not expressible as a single alter column); recreate the table, or drop and re-add the column/constraint manually.`,
		);
	}
	if (uniqueChanged) {
		return throwHejbroError(
			"unsupported-column-alter",
			`column "${entry.key}" on table "${tableName}" changed its unique flag — hejbro does not emit sql for that in Phase 1; add/drop the column, or add/drop a unique constraint manually.`,
		);
	}

	return [
		...typeAlterStatements(
			schema,
			tableName,
			entry.key,
			typeChanged,
			entry.next.typeNode,
		),
		...notNullAlterStatements(
			schema,
			tableName,
			entry.key,
			notNullChanged,
			columnNotNull(entry.next),
		),
		...defaultAlterStatements(
			schema,
			tableName,
			entry.key,
			defaultChanged,
			columnDefault(entry.next),
		),
	];
};

const emitAlter = (
	previous: TableSnapshot,
	next: TableSnapshot,
): ReadonlyArray<SqlStatement> => {
	const columnDiff = diffByKey(
		previous.columns.map((column) => ({ key: column.name, value: column })),
		next.columns.map((column) => ({ key: column.name, value: column })),
	);
	const indexDiff = diffByKey(
		previous.indexes.map((index) => ({ key: index.name, value: index })),
		next.indexes.map((index) => ({ key: index.name, value: index })),
	);
	const foreignKeyDiff = diffByKey(
		previous.foreignKeys.map((foreignKey) => ({
			key: foreignKey.name,
			value: foreignKey,
		})),
		next.foreignKeys.map((foreignKey) => ({
			key: foreignKey.name,
			value: foreignKey,
		})),
	);
	const checkDiff = diffByKey(
		tableChecks(previous).map((check) => ({ key: check.name, value: check })),
		tableChecks(next).map((check) => ({ key: check.name, value: check })),
	);

	const foreignKeysToDrop = [
		...foreignKeyDiff.removed.map((entry) => entry.key),
		...foreignKeyDiff.changed.map((entry) => entry.key),
	];
	const foreignKeysToAdd = [
		...foreignKeyDiff.added.map((entry) => entry.value),
		...foreignKeyDiff.changed.map((entry) => entry.next),
	];
	const checksToDrop = [
		...checkDiff.removed.map((entry) => entry.key),
		...checkDiff.changed.map((entry) => entry.key),
	];
	const checksToAdd = [
		...checkDiff.added.map((entry) => entry.value),
		...checkDiff.changed.map((entry) => entry.next),
	];
	const indexesToDrop = [
		...indexDiff.removed.map((entry) => entry.key),
		...indexDiff.changed.map((entry) => entry.key),
	];
	const indexesToAdd = [
		...indexDiff.added.map((entry) => entry.value),
		...indexDiff.changed.map((entry) => entry.next),
	];

	return [
		...foreignKeysToDrop.map((name) =>
			statement(dropConstraintSql(next.schema, next.name, name)),
		),
		...checksToDrop.map((name) =>
			statement(dropConstraintSql(next.schema, next.name, name)),
		),
		...indexesToDrop.map((name) =>
			statement(`drop index ${qualifyName(next.schema, name)};`),
		),
		...columnDiff.removed.map((entry) =>
			statement(
				`alter table ${qualifyName(next.schema, next.name)} drop column ${quoteIdentifier(entry.key)};`,
			),
		),
		...columnDiff.added.map((entry) =>
			statement(
				`alter table ${qualifyName(next.schema, next.name)} add column ${renderColumnDefinition(entry.value)};`,
			),
		),
		...columnDiff.changed.flatMap((entry) =>
			alterColumnStatements(next.schema, next.name, entry),
		),
		...indexesToAdd.map((index) =>
			statement(createIndexSql(next.schema, next.name, index)),
		),
		...checksToAdd.map((check) =>
			statement(addCheckConstraintSql(next.schema, next.name, check)),
		),
		...foreignKeysToAdd.map((foreignKey) =>
			deferredStatement(
				addForeignKeyConstraintSql(next.schema, next.name, foreignKey),
			),
		),
	];
};

/**
 * Emits SQL for a table {@link KindChange}: `create table` (+ indexes +
 * deferred FK constraints) for creates, `drop table` for drops, and
 * targeted `alter table` statements for survivors.
 */
export const emitTableSql = (
	change: KindChange,
): ReadonlyArray<SqlStatement> => {
	switch (change.operation) {
		case "create": {
			if (change.next === null) {
				return throwHejbroError(
					"invalid-kind-change",
					"table create change is missing its next snapshot.",
				);
			}
			return emitCreate(asTableSnapshot(change.next));
		}
		case "drop": {
			if (change.previous === null) {
				return throwHejbroError(
					"invalid-kind-change",
					"table drop change is missing its previous snapshot.",
				);
			}
			return emitDrop(asTableSnapshot(change.previous));
		}
		case "alter": {
			if (change.previous === null || change.next === null) {
				return throwHejbroError(
					"invalid-kind-change",
					"table alter change is missing its previous or next snapshot.",
				);
			}
			return emitAlter(
				asTableSnapshot(change.previous),
				asTableSnapshot(change.next),
			);
		}
		default:
			return assertNever(change.operation);
	}
};

import type {
	Expr,
	ForeignKeyDeclaration,
	Table,
	TableDeclaration,
} from "@hejbro/core";
import {
	select as coreSelect,
	eq,
	getTableMeta,
	jsonArrayFrom,
	jsonObjectFrom,
	throwHejbroError,
} from "@hejbro/core";

/**
 * Runtime relation derivation for `related()` (D102, add-relational-reads
 * task 3.3) — reads the SAME `ForeignKeyDeclaration`s the DDL emits (one
 * truth, two readers; the type layer derives from the `TMeta` edges the
 * same declarations carry). Produces exactly the projection the explicit
 * `jsonArrayFrom`/`jsonObjectFrom` formulation would build, so the
 * compiled statement is identical by construction.
 */

/** `ownerId` → `owner` — the runtime twin of the type-level strip. */
const stripId = (key: string): string => {
	if (key.length > 2 && key.endsWith("Id")) {
		return key.slice(0, -2);
	}
	return key;
};

/** A table's column ref for one SQL column name, via its declaration. */
const refForSqlName = (
	tableObject: Table,
	meta: TableDeclaration,
	sqlName: string,
): Expr => {
	const entry = meta.columns.find((column) => column.columnName === sqlName);
	if (entry === undefined) {
		return throwHejbroError(
			"unknown-relation",
			`table "${meta.tableName}" has no column "${sqlName}" to correlate a relation on. Next: check the foreign key declaration.`,
		);
	}
	return (tableObject as unknown as Record<string, Expr>)[
		entry.columnKey
	] as Expr;
};

const identityMatches = (
	references: ForeignKeyDeclaration["references"],
	meta: TableDeclaration,
): boolean =>
	references.schemaName === meta.schema.schemaName &&
	references.tableName === meta.tableName;

/** The forward edge for `key` (an own FK column whose stripped name matches), or undefined. */
const forwardEdge = (
	meta: TableDeclaration,
	key: string,
): ForeignKeyDeclaration | undefined =>
	meta.foreignKeys.find((foreignKey) => {
		if (foreignKey.columns.length !== 1) {
			return false;
		}
		const entry = meta.columns.find(
			(column) => column.columnName === foreignKey.columns[0],
		);
		return entry !== undefined && stripId(entry.columnKey) === key;
	});

const buildForward = (
	parent: Table,
	parentMeta: TableDeclaration,
	foreignKey: ForeignKeyDeclaration,
	tables: Readonly<Record<string, Table>>,
): Expr => {
	const target = Object.values(tables).find((candidate) =>
		identityMatches(foreignKey.references, getTableMeta(candidate)),
	);
	if (target === undefined) {
		return throwHejbroError(
			"unknown-relation",
			`the foreign key on "${parentMeta.tableName}" references "${foreignKey.references.schemaName}"."${foreignKey.references.tableName}", which is not in this db()'s schema map. Next: pass the referenced table to db(), or write the read explicitly with jsonObjectFrom().`,
		);
	}
	const targetMeta = getTableMeta(target);
	const targetRef = refForSqlName(
		target,
		targetMeta,
		foreignKey.references.columns[0] ?? "",
	);
	const parentRef = refForSqlName(
		parent,
		parentMeta,
		foreignKey.columns[0] ?? "",
	);
	return jsonObjectFrom(coreSelect(target).where(eq(targetRef, parentRef)));
};

const buildReverse = (
	parent: Table,
	parentMeta: TableDeclaration,
	child: Table,
): Expr | undefined => {
	const childMeta = getTableMeta(child);
	const foreignKey = childMeta.foreignKeys.find(
		(candidate) =>
			candidate.columns.length === 1 &&
			identityMatches(candidate.references, parentMeta),
	);
	if (foreignKey === undefined) {
		return undefined;
	}
	const childRef = refForSqlName(child, childMeta, foreignKey.columns[0] ?? "");
	const parentRef = refForSqlName(
		parent,
		parentMeta,
		foreignKey.references.columns[0] ?? "",
	);
	return jsonArrayFrom(coreSelect(child).where(eq(childRef, parentRef)));
};

const deriveOne = (
	parent: Table,
	parentMeta: TableDeclaration,
	key: string,
	tables: Readonly<Record<string, Table>>,
): Expr => {
	const forward = forwardEdge(parentMeta, key);
	if (forward !== undefined) {
		return buildForward(parent, parentMeta, forward, tables);
	}
	const child = tables[key];
	if (child !== undefined) {
		const reverse = buildReverse(parent, parentMeta, child);
		if (reverse !== undefined) {
			return reverse;
		}
	}
	return throwHejbroError(
		"unknown-relation",
		`"${key}" is not a derivable relation of "${parentMeta.tableName}" — no own foreign-key column strips to it and no schema-map table of that name references "${parentMeta.tableName}". Next: declare the edge with .references(), or write the read explicitly with jsonArrayFrom()/jsonObjectFrom().`,
	);
};

/** The full object projection `related(spec)` compiles: every parent column ref, then one nested read per requested key — exactly the explicit formulation. */
export const buildRelatedProjection = (
	parent: Table,
	spec: Readonly<Record<string, true>>,
	tables: Readonly<Record<string, Table>>,
): Record<string, Expr> => {
	const parentMeta = getTableMeta(parent);
	const parentRefs = parentMeta.columns.map((column) => [
		column.columnKey,
		(parent as unknown as Record<string, Expr>)[column.columnKey],
	]);
	const nested = Object.keys(spec).map((key) => [
		key,
		deriveOne(parent, parentMeta, key, tables),
	]);
	return Object.fromEntries([...parentRefs, ...nested]);
};

import type {
	Diagnostic,
	ExprNode,
	IndexColumnDeclaration,
	IndexDeclaration,
	TableDeclaration,
	Validator,
} from "@hejbro/core";
import { diagnostic, renderExpr, someDeepExprNode } from "@hejbro/core";
import { declaredAtOf, isTableDeclaration } from "./schema-of";

/** The two `auth` schema functions with an initPlan-cached form (#97) — same set {@link ../validators/rls-uncached-auth-call} covers, opposite direction. */
type CachableAuthFunctionName = "uid" | "jwt";

/** `authUidCached()`/`authJwtCached()`'s exact rendered `rawSql` text (see `packages/supabase/src/auth.ts`) — the only way to identify a helper-produced node today: it has no marker distinguishing it from `sql.raw()` text a user wrote by hand (#141). Matching on it is deliberate, not an oversight: a hand-written `sql.raw("(select auth.uid())")` has the exact same illegal-scalar-subquery problem this validator exists to catch, so treating it identically is correct, not a false positive. */
const cachedRawSqlByFunction: Record<CachableAuthFunctionName, string> = {
	uid: "(select auth.uid())",
	jwt: "(select auth.jwt())",
};

const plainFormFor: Record<CachableAuthFunctionName, string> = {
	uid: "authUid()",
	jwt: "authJwt()",
};

const functionNameOfCachedCall = (
	node: ExprNode,
): CachableAuthFunctionName | null => {
	if (node.nodeKind !== "rawSql") {
		return null;
	}
	if (node.sql === cachedRawSqlByFunction.uid) {
		return "uid";
	}
	if (node.sql === cachedRawSqlByFunction.jwt) {
		return "jwt";
	}
	return null;
};

const isCachedCallFor =
	(functionName: CachableAuthFunctionName) =>
	(candidate: ExprNode): boolean =>
		functionNameOfCachedCall(candidate) === functionName;

/** Which cached-form call (if either) appears anywhere in `node`'s tree, including inside `exists(...)` subqueries. Checks "uid" and "jwt" as two separate deep walks rather than one walk with a mutable accumulator -- there are only two possibilities, and each walk's predicate stays a pure boolean function. */
const findCachedAuthCall = (
	node: ExprNode,
): CachableAuthFunctionName | null => {
	if (someDeepExprNode(node, isCachedCallFor("uid"))) {
		return "uid";
	}
	if (someDeepExprNode(node, isCachedCallFor("jwt"))) {
		return "jwt";
	}
	return null;
};

/** One column's short description for {@link indexDescription}'s unnamed-index fallback: a quoted column name, or a parenthesised rendering of an expression entry (R5) — same shape `contracts/sql.md` uses for an expression index column. */
const indexColumnDescription = (column: IndexColumnDeclaration): string => {
	if ("name" in column) {
		return `"${column.name}"`;
	}
	return `(${renderExpr(column.expression)})`;
};

/** `index.indexName`, or a description by column list when it's still `null` at validator time (auto-derivation, `deriveIndexName` in `packages/core/src/kinds/table-kind.ts`, is internal to core and not part of the public extension interface). */
const indexDescription = (index: IndexDeclaration): string => {
	if (index.indexName !== null) {
		return `index "${index.indexName}"`;
	}
	const columnList = index.columns.map(indexColumnDescription).join(", ");
	return `the index on (${columnList})`;
};

const cachedFormFor: Record<CachableAuthFunctionName, string> = {
	uid: "authUidCached()",
	jwt: "authJwtCached()",
};

const cachedAuthCallMessage = (
	location: string,
	functionName: CachableAuthFunctionName,
): string =>
	`${location} calls ${cachedFormFor[functionName]} — a scalar subquery is illegal here. Next: use ${plainFormFor[functionName]} here, or move the check into a policy.`;

const columnDefaultDiagnostics = (
	table: TableDeclaration,
): ReadonlyArray<Diagnostic> =>
	table.columns.flatMap(({ columnName, columnState }) => {
		if (columnState.defaultValue === null) {
			return [];
		}
		const functionName = findCachedAuthCall(columnState.defaultValue);
		if (functionName === null) {
			return [];
		}
		return [
			diagnostic(
				"error",
				"rls-cached-auth-outside-rls",
				cachedAuthCallMessage(
					`column "${table.schema.schemaName}"."${table.tableName}"."${columnName}"'s default`,
					functionName,
				),
				declaredAtOf(table),
			),
		];
	});

const checkDiagnostics = (table: TableDeclaration): ReadonlyArray<Diagnostic> =>
	table.checks.flatMap((check) => {
		const functionName = findCachedAuthCall(check.expression);
		if (functionName === null) {
			return [];
		}
		return [
			diagnostic(
				"error",
				"rls-cached-auth-outside-rls",
				cachedAuthCallMessage(
					`check "${check.checkName}" on table "${table.schema.schemaName}"."${table.tableName}"`,
					functionName,
				),
				declaredAtOf(table),
			),
		];
	});

const indexPredicateDiagnostics = (
	table: TableDeclaration,
): ReadonlyArray<Diagnostic> =>
	table.indexes.flatMap((index) => {
		if (index.predicate === null) {
			return [];
		}
		const functionName = findCachedAuthCall(index.predicate);
		if (functionName === null) {
			return [];
		}
		return [
			diagnostic(
				"error",
				"rls-cached-auth-outside-rls",
				cachedAuthCallMessage(
					`${indexDescription(index)} on table "${table.schema.schemaName}"."${table.tableName}"`,
					functionName,
				),
				declaredAtOf(table),
			),
		];
	});

/**
 * Errors when a column `default`, a CHECK, or a partial-index predicate
 * calls `authUidCached()`/`authJwtCached()` (#141) — both render a scalar
 * subquery (`(select auth.uid())`/`(select auth.jwt())`), which Postgres
 * forbids outside RLS (`check-subquery` already hard-errors on a
 * user-written subquery in a CHECK; this catches the same illegality
 * arriving through a helper call instead). The cached forms exist only
 * for RLS `using`/`withCheck`, where the caching actually pays off —
 * `authUid()`/`authJwt()` are the correct, idiomatic form everywhere
 * else, and are left alone here.
 *
 * Descends into `exists(...)` subqueries via {@link someDeepExprNode}, so
 * a cached call inside a partial index predicate's or CHECK's own
 * ownership-style subquery is caught the same way it would be missed by
 * core's shallower `someExprNode`.
 */
export const rlsCachedAuthOutsideRlsValidator: Validator = (
	_snapshot,
	declarations,
) =>
	declarations
		.filter(isTableDeclaration)
		.flatMap((table) => [
			...columnDefaultDiagnostics(table),
			...checkDiagnostics(table),
			...indexPredicateDiagnostics(table),
		]);

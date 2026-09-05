import type { DriverRow } from "./contract";

/**
 * The minimal shape {@link lastRows} needs from a node-postgres-style
 * query result -- never `pg`'s own `QueryResult` type: `@hejbro/query`
 * cannot depend on a concrete driver package's types (the provider/
 * driver boundary this module already sits inside).
 */
export type QueryResultLike = {
	readonly rows: ReadonlyArray<DriverRow>;
};

/**
 * Folds a node-postgres-shaped query result to the rows a caller should
 * see (task 1.6, #892, design.md Q6): `Array.isArray(result)` is
 * node-postgres's own signal that the text carried more than one
 * command -- measured, never inferred from `rows` being present or
 * absent, since a single-command result's own `rows` is never itself an
 * array of results. The last command's rows are what the caller's own
 * text asked for last (psql's own convention); every earlier member,
 * including our own multi-statement session-setup text, is discarded.
 * An empty array is an internal-invariant failure (486/R6, measured
 * unreachable through the `sql` escape hatch against postgres:17: a
 * trailing semicolon, a comment-only text, and an empty string each
 * answer with a single, non-array result instead) -- the same shape
 * `@hejbro/neon`'s own `lastResultOf` (`http.ts`) already uses for the
 * same reasoning.
 */
/** `Array.isArray`'s own lib signature narrows to a mutable `any[]`, which never excludes a `readonly` array from the other side of a union -- this named predicate does, so {@link lastRows}'s own guard clause narrows both branches, not just the positive one. */
const isMultiCommandResult = (
	result: QueryResultLike | ReadonlyArray<QueryResultLike>,
): result is ReadonlyArray<QueryResultLike> => Array.isArray(result);

export const lastRows = (
	result: QueryResultLike | ReadonlyArray<QueryResultLike>,
): ReadonlyArray<DriverRow> => {
	if (!isMultiCommandResult(result)) {
		return result.rows;
	}
	const last: QueryResultLike | undefined = result[result.length - 1];
	if (last === undefined) {
		throw new Error(
			"a multi-command sql text resolved to zero results. Next: this is an internal invariant failure, not a user-reachable path -- file an issue.",
		);
	}
	return last.rows;
};

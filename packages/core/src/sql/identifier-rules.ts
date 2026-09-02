import { throwHejbroError } from "../error";

const SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The same D36 rule {@link assertSqlName} enforces, as a boolean query --
 * this module's own internal use only (D106 R3-B3, CI-R3-05: the lead
 * ruled a boolean predicate is not otherwise public surface `@hejbro/core`
 * needs, so it stays unexported from the package's own `index.ts`; a
 * caller elsewhere that needs the query wraps {@link assertSqlName} in a
 * `try`/`catch` instead, e.g. `packages/cli/src/infer/table.ts`'s own
 * `isExpressibleForeignKeyName`).
 */
const isSqlName = (name: string): boolean => SQL_NAME_PATTERN.test(name);

/**
 * Enforces decision D36 (2026-08-20): every final SQL name must match
 * `^[a-z][a-z0-9_]*$` so identifiers survive `--rename`/`--confirm-drop`
 * flag parsing (`.`/`=` separators) and stay quoting-free. Loosening this
 * later is non-breaking; tightening later would be breaking — so we start
 * strict.
 */
export const assertSqlName = (
	name: string,
	context: string,
	declaredAt: string | null,
): string => {
	if (isSqlName(name)) {
		return name;
	}
	return throwHejbroError(
		"invalid-sql-name",
		`${context} name ${JSON.stringify(name)} is not a valid hejbro SQL identifier — names must match ^[a-z][a-z0-9_]*$ (lower-case snake_case, no dots or symbols) so they can be referenced from --rename/--confirm-drop flags. Next: rename the ${context} to snake_case.`,
		declaredAt,
	);
};

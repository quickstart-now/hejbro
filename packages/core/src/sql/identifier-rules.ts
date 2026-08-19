import { throwHejbroError } from "../error";

const SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

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
	if (SQL_NAME_PATTERN.test(name)) {
		return name;
	}
	return throwHejbroError(
		"invalid-sql-name",
		`${context} name ${JSON.stringify(name)} is not a valid hejbro SQL identifier — names must match ^[a-z][a-z0-9_]*$ (lower-case snake_case, no dots or symbols) so they can be referenced from --rename/--confirm-drop flags. Next: rename the ${context} to snake_case.`,
		declaredAt,
	);
};

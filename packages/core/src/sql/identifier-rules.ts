import { throwHejbroError } from "../error";

const SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The same D36 rule {@link assertSqlName} enforces, as a boolean query.
 * D106 R3-B3 kept this module-private (a boolean predicate was ruled
 * not otherwise public surface `@hejbro/core` needed, so a caller
 * wrapped `assertSqlName` in a `try`/`catch` instead); D106 R5-B2
 * withdraws that ruling: a caller that must decide *whether* a name is
 * declarable (not merely assert one it already expects to be) needs
 * the same D36 rule `assertSqlName` enforces, not a second, hand-rolled
 * copy of it -- two rules for the same question is exactly the gap
 * R5-B1/R5-B2 both trace to (a round-trip predicate one layer up and
 * this pattern one layer down, kept in sync by nothing).
 */
export const isSqlName = (name: string): boolean => SQL_NAME_PATTERN.test(name);

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

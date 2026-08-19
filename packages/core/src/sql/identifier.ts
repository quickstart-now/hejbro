import { throwHejbroError } from "../error";

/**
 * Double-quotes a Postgres identifier, doubling any embedded double quotes
 * (`a"b` becomes `"a""b"`). Rejects empty names and names containing a NUL
 * byte, since Postgres cannot represent either.
 */
export const quoteIdentifier = (name: string): string => {
	if (name.length === 0) {
		return throwHejbroError(
			"invalid-identifier",
			"identifier is empty — give the object a name before declaring it.",
		);
	}
	if (name.includes("\0")) {
		return throwHejbroError(
			"invalid-identifier",
			`identifier "${name}" contains a NUL byte — remove it and use a plain name.`,
		);
	}
	return `"${name.replaceAll('"', '""')}"`;
};

/**
 * Joins a schema and object name into a schema-qualified, quoted SQL
 * reference: `qualifyName("app", "posts")` → `"app"."posts"`.
 */
export const qualifyName = (schema: string, name: string): string =>
	`${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;

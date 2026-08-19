/** Quotes and escapes a Postgres SQL string literal (single-quoted, embedded single quotes doubled). */
export const quoteStringLiteral = (value: string): string =>
	`'${value.replaceAll("'", "''")}'`;

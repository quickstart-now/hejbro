/**
 * Renders `text` (already-rendered SQL, e.g. from `columnDefault()`) as a
 * `sql.raw(...)` call (2.1, CI-G2-R1-06 Q4, lead-approved): a JSON string
 * literal, never a template -- the text may itself contain backticks or
 * `${`, and a literal makes the "no interpolation happens here" fact
 * visible in the generated source.
 */
export const sqlRawCall = (text: string): string =>
	`sql.raw(${JSON.stringify(text)})`;

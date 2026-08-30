import type { SqlTypeFamily } from "../expr/type-family";

/**
 * (declared returns family) → returned-expression families whose plpgsql
 * `RETURN` coercion fails for every value: Postgres accepts the CREATE
 * and every call then fails to convert the returned value. Probed on
 * Postgres 17 — a pair belongs here only when the source family's
 * printed form can never enter any of the declared family's input
 * grammars; a pair with any succeeding value stays out (`20260101` is a
 * valid ISO date, `{}` prints as both an empty JSON object and an empty
 * array literal, inet accepts partial addresses like `42.5`), so this
 * table never refuses what Postgres might accept.
 */
const REFUSED_RETURN_FAMILIES: Record<
	SqlTypeFamily,
	ReadonlyArray<SqlTypeFamily>
> = {
	array: ["boolean", "bytea", "datetime", "interval", "net", "numeric", "uuid"],
	boolean: ["array", "bytea", "datetime", "interval", "net", "uuid"],
	bytea: [],
	datetime: ["array", "boolean", "bytea", "net", "uuid"],
	interval: ["array", "boolean", "bytea", "net", "uuid"],
	json: ["boolean", "bytea", "datetime", "interval", "net", "uuid"],
	net: ["array", "boolean", "bytea", "interval", "uuid"],
	numeric: ["array", "boolean", "bytea", "datetime", "interval", "net", "uuid"],
	text: [],
	unknown: [],
	uuid: [
		"array",
		"boolean",
		"bytea",
		"datetime",
		"interval",
		"json",
		"net",
		"numeric",
	],
};

/** `true` when a scalar-returning declaration of `declared` family must refuse a returned expression of `returned` family. An unknown family on either side never refuses: `unknown`'s row is empty, and no row lists `unknown` as a refused source. */
export const isRefusedReturnFamily = (
	declared: SqlTypeFamily,
	returned: SqlTypeFamily,
): boolean => REFUSED_RETURN_FAMILIES[declared].includes(returned);

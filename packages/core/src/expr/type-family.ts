import { assertNever } from "../error";
import type { TypeNode } from "../types/type-node";

/** Coarse Postgres type families used for shallow compile-time expression checks (D17). */
export const sqlTypeFamilies = [
	"uuid",
	"text",
	"numeric",
	"boolean",
	"datetime",
	"interval",
	"json",
	"bytea",
	"net",
	"array",
	"unknown",
] as const;

/** @see sqlTypeFamilies */
export type SqlTypeFamily = (typeof sqlTypeFamilies)[number];

/** The JS values that auto-lift into a literal for a given family (D19 sub-decision: string/number/boolean/Date only; json/array/etc. need explicit helpers). */
export type LiftableFor<TFamily extends SqlTypeFamily> = TFamily extends
	| "text"
	| "uuid"
	? string
	: TFamily extends "numeric"
		? number
		: TFamily extends "boolean"
			? boolean
			: TFamily extends "datetime"
				? Date | string
				: never;

/** Maps a structural {@link TypeNode} to its coarse {@link SqlTypeFamily}. */
export const familyOfTypeNode = (node: TypeNode): SqlTypeFamily => {
	switch (node.typeName) {
		case "uuid":
			return "uuid";
		case "text":
		case "varchar":
		case "char":
		case "enum":
			return "text";
		case "smallint":
		case "integer":
		case "bigint":
		case "real":
		case "double precision":
		case "numeric":
		case "serial":
		case "smallserial":
		case "bigserial":
			return "numeric";
		case "boolean":
			return "boolean";
		case "date":
		case "time":
		case "timetz":
		case "timestamp":
		case "timestamptz":
			return "datetime";
		case "interval":
			return "interval";
		case "json":
		case "jsonb":
			return "json";
		case "bytea":
			return "bytea";
		case "inet":
		case "cidr":
		case "macaddr":
			return "net";
		case "array":
			return "array";
		default:
			return assertNever(node);
	}
};

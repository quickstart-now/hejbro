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

/**
 * Type-level mirror of {@link familyOfTypeNode}: narrows a literal
 * {@link TypeNode} shape (e.g. `{ typeName: "uuid" }`) to its
 * {@link SqlTypeFamily} at compile time, so `columnRef()` call sites built
 * from a literal type node get a precisely-typed `ColumnRef<TFamily>`
 * instead of the full `SqlTypeFamily` union. Distributes over `TNode` when
 * called with the wider `TypeNode` union (e.g. a `ColumnState.typeNode`
 * field), matching `familyOfTypeNode`'s runtime behavior exactly.
 */
export type FamilyOfTypeNode<TNode extends TypeNode> = TNode extends {
	readonly typeName: "uuid";
}
	? "uuid"
	: TNode extends { readonly typeName: "text" | "varchar" | "char" | "enum" }
		? "text"
		: TNode extends {
					readonly typeName:
						| "smallint"
						| "integer"
						| "bigint"
						| "real"
						| "double precision"
						| "numeric"
						| "serial"
						| "smallserial"
						| "bigserial";
				}
			? "numeric"
			: TNode extends { readonly typeName: "boolean" }
				? "boolean"
				: TNode extends {
							readonly typeName:
								| "date"
								| "time"
								| "timetz"
								| "timestamp"
								| "timestamptz";
						}
					? "datetime"
					: TNode extends { readonly typeName: "interval" }
						? "interval"
						: TNode extends { readonly typeName: "json" | "jsonb" }
							? "json"
							: TNode extends { readonly typeName: "bytea" }
								? "bytea"
								: TNode extends {
											readonly typeName: "inet" | "cidr" | "macaddr";
										}
									? "net"
									: TNode extends { readonly typeName: "array" }
										? "array"
										: "unknown";

/**
 * `TypeNode["typeName"]` → {@link SqlTypeFamily}, one entry per type name.
 * A `Record` keyed by the full `typeName` union rather than a switch: TS
 * itself enforces exhaustiveness here (a missing key is a compile error,
 * "Property ... is missing"), the same guarantee a switch's `default:
 * assertNever(node)` gives at runtime, so nothing is lost by dropping the
 * runtime check. Extracted from the CRAP report's own group A (#154 PR2)
 * — the mapping is data, not control flow, and a switch's cyclomatic
 * complexity counts every `case` label as a branch even though none of
 * them actually branch on anything but the type name itself.
 */
const TYPE_NAME_TO_FAMILY: Record<TypeNode["typeName"], SqlTypeFamily> = {
	uuid: "uuid",
	text: "text",
	varchar: "text",
	char: "text",
	enum: "text",
	smallint: "numeric",
	integer: "numeric",
	bigint: "numeric",
	real: "numeric",
	"double precision": "numeric",
	numeric: "numeric",
	serial: "numeric",
	smallserial: "numeric",
	bigserial: "numeric",
	boolean: "boolean",
	date: "datetime",
	time: "datetime",
	timetz: "datetime",
	timestamp: "datetime",
	timestamptz: "datetime",
	interval: "interval",
	json: "json",
	jsonb: "json",
	bytea: "bytea",
	inet: "net",
	cidr: "net",
	macaddr: "net",
	array: "array",
};

/** Maps a structural {@link TypeNode} to its coarse {@link SqlTypeFamily}. */
export const familyOfTypeNode = (node: TypeNode): SqlTypeFamily =>
	TYPE_NAME_TO_FAMILY[node.typeName];

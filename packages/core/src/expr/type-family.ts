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

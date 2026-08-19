import { throwHejbroError } from "../error";
import { qualifyName } from "../sql/identifier";

/** Postgres column types with no parameters and no special SQL rendering rule. */
export const simpleTypeNames = [
	"uuid",
	"text",
	"boolean",
	"smallint",
	"integer",
	"bigint",
	"real",
	"double precision",
	"date",
	"time",
	"timetz",
	"timestamp",
	"timestamptz",
	"interval",
	"json",
	"jsonb",
	"bytea",
	"inet",
	"cidr",
	"macaddr",
	"serial",
	"smallserial",
	"bigserial",
] as const;

/** @see simpleTypeNames */
export type SimpleTypeName = (typeof simpleTypeNames)[number];

/**
 * A structured Postgres column type. Discriminated by `typeName`: most
 * shapes are parameterless (see {@link SimpleTypeName}); `varchar`, `char`,
 * `numeric`, `enum`, and `array` carry parameters.
 */
export type TypeNode =
	| { readonly typeName: SimpleTypeName }
	| { readonly typeName: "varchar"; readonly length: number | null }
	| { readonly typeName: "char"; readonly length: number }
	| {
			readonly typeName: "numeric";
			readonly precision: number | null;
			readonly scale: number | null;
	  }
	| {
			readonly typeName: "enum";
			readonly enumSchema: string;
			readonly enumName: string;
	  }
	| { readonly typeName: "array"; readonly element: TypeNode };

const renderVarchar = (node: { readonly length: number | null }): string => {
	if (node.length === null) {
		return "varchar";
	}
	return `varchar(${node.length})`;
};

const renderNumeric = (node: {
	readonly precision: number | null;
	readonly scale: number | null;
}): string => {
	if (node.precision === null) {
		return "numeric";
	}
	if (node.scale === null) {
		return `numeric(${node.precision})`;
	}
	return `numeric(${node.precision},${node.scale})`;
};

const assertNever = (node: never): never =>
	throwHejbroError(
		"unreachable-type-node",
		`unexpected type node shape: ${JSON.stringify(node)}.`,
	);

/**
 * Renders a {@link TypeNode} as Postgres SQL. `timetz`/`timestamptz` render
 * in their canonical spelled-out form (`time with time zone` /
 * `timestamp with time zone`) since that is what `pg_dump` and
 * `information_schema` emit — the short internal type names stay stable in
 * snapshots, only the rendered SQL changes.
 */
export const renderTypeNode = (node: TypeNode): string => {
	switch (node.typeName) {
		case "uuid":
		case "text":
		case "boolean":
		case "smallint":
		case "integer":
		case "bigint":
		case "real":
		case "double precision":
		case "date":
		case "time":
		case "timestamp":
		case "interval":
		case "json":
		case "jsonb":
		case "bytea":
		case "inet":
		case "cidr":
		case "macaddr":
		case "serial":
		case "smallserial":
		case "bigserial":
			return node.typeName;
		case "timetz":
			return "time with time zone";
		case "timestamptz":
			return "timestamp with time zone";
		case "varchar":
			return renderVarchar(node);
		case "char":
			return `char(${node.length})`;
		case "numeric":
			return renderNumeric(node);
		case "enum":
			return qualifyName(node.enumSchema, node.enumName);
		case "array":
			return `${renderTypeNode(node.element)}[]`;
		default:
			return assertNever(node);
	}
};

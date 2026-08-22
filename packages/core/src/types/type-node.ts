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

/** The three `serial`-family pseudo-types (#23/D66) — Postgres `CREATE TABLE`/`ADD COLUMN` sugar for an owned sequence plus a `nextval(...)` default, never a real storable column type (`alter column … type serial` is rejected outright — confirmed against a real Postgres, not assumed). */
export const serialTypeNames = ["serial", "smallserial", "bigserial"] as const;

/** @see serialTypeNames */
export type SerialTypeName = (typeof serialTypeNames)[number];

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

/** True when `node` is one of the three `serial`-family pseudo-types. Takes the whole {@link TypeNode}, not a bare name, since only the simple-type variant can ever be one and every caller already has a `TypeNode` in hand. A type guard, so a caller narrows straight to `node.typeName: SerialTypeName` without an `as` cast. */
export const isSerialTypeNode = (
	node: TypeNode,
): node is { readonly typeName: SerialTypeName } =>
	(serialTypeNames as ReadonlyArray<string>).includes(node.typeName);

/**
 * The real, storable column type a `serial`-family pseudo-type decomposes
 * to (#23/D66) — confirmed against a real Postgres (`pg_dump` on a table
 * declaring all three variants: `serial` → `integer NOT NULL`, `smallserial`
 * → `smallint NOT NULL`, `bigserial` → `bigint NOT NULL`). `table-kind.ts`'s
 * `serializeColumns` always decomposes at serialize time, so a `ColumnSnapshot`
 * never stores a `serial`-family `typeName` — this is what keeps the
 * invalid `alter column … type serial` path structurally unreachable from
 * `table-kind-emit.ts`'s generic type-alter path, rather than needing a
 * runtime guard there: the snapshot simply never contains the pseudo-type
 * past this point.
 */
export const serialBaseType = (
	typeName: SerialTypeName,
): { readonly typeName: "smallint" | "integer" | "bigint" } => {
	switch (typeName) {
		case "smallserial":
			return { typeName: "smallint" };
		case "serial":
			return { typeName: "integer" };
		case "bigserial":
			return { typeName: "bigint" };
		default:
			return assertNever(typeName);
	}
};

/**
 * The backing sequence's own `as <basetype>` clause value for a
 * `serial`-family pseudo-type (#23/D66) — `null` for `bigserial`, whose
 * sequence needs no `as` clause at all (`create sequence` already defaults
 * to the `bigint` range). Confirmed against a real Postgres (see
 * `serialBaseType`'s own doc comment for the exact `pg_dump` evidence).
 */
export const serialSequenceBaseType = (
	typeName: SerialTypeName,
): "smallint" | "integer" | null => {
	switch (typeName) {
		case "smallserial":
			return "smallint";
		case "serial":
			return "integer";
		case "bigserial":
			return null;
		default:
			return assertNever(typeName);
	}
};

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

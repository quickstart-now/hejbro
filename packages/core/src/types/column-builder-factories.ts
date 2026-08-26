import type { FamilyOfTypeNode } from "../expr/type-family";
import type { ColumnBuilder } from "./column-builder";
import { createColumnBuilder } from "./column-builder";
import type { SimpleTypeName } from "./type-node";

/**
 * Builds the initial (unmodified) `ColumnBuilder` for a parameterless
 * factory. `TName` is inferred straight from the call's own `typeName`
 * string literal (mirrors `columnRef`'s own `TNode`-inference pattern in
 * `expr/ast.ts`) — no explicit type argument needed at any call site, so
 * the family and the declared type name can never drift apart the way two
 * independently hand-written type arguments could. `TFamily` is then
 * derived from `TName` via {@link FamilyOfTypeNode}, the same mapping
 * `familyOfTypeNode` uses at runtime.
 */
const initialColumnBuilder = <TName extends SimpleTypeName>(
	typeName: TName,
): ColumnBuilder<FamilyOfTypeNode<{ typeName: TName }>, { typeName: TName }> =>
	createColumnBuilder<
		FamilyOfTypeNode<{ typeName: TName }>,
		{ typeName: TName }
	>({
		typeNode: { typeName },
		notNull: false,
		primaryKey: false,
		unique: false,
		defaultValue: null,
	});

const resolveOptionalNumber = (value: number | undefined): number | null => {
	if (value === undefined) {
		return null;
	}
	return value;
};

/** `uuid` column. */
export const uuid = (): ColumnBuilder<"uuid", { typeName: "uuid" }> =>
	initialColumnBuilder("uuid");
/** `text` column. */
export const text = (): ColumnBuilder<"text", { typeName: "text" }> =>
	initialColumnBuilder("text");
/** `boolean` column. */
export const boolean = (): ColumnBuilder<"boolean", { typeName: "boolean" }> =>
	initialColumnBuilder("boolean");
/** `smallint` column. */
export const smallint = (): ColumnBuilder<
	"numeric",
	{ typeName: "smallint" }
> => initialColumnBuilder("smallint");
/** `integer` column. */
export const integer = (): ColumnBuilder<"numeric", { typeName: "integer" }> =>
	initialColumnBuilder("integer");
/** `bigint` column. */
export const bigint = (): ColumnBuilder<"numeric", { typeName: "bigint" }> =>
	initialColumnBuilder("bigint");
/** `real` column. */
export const real = (): ColumnBuilder<"numeric", { typeName: "real" }> =>
	initialColumnBuilder("real");
/** `double precision` column. */
export const doublePrecision = (): ColumnBuilder<
	"numeric",
	{ typeName: "double precision" }
> => initialColumnBuilder("double precision");
/** `date` column. */
export const date = (): ColumnBuilder<"datetime", { typeName: "date" }> =>
	initialColumnBuilder("date");
/** `time` column. */
export const time = (): ColumnBuilder<"datetime", { typeName: "time" }> =>
	initialColumnBuilder("time");
/** `time with time zone` column (short internal name `timetz`). */
export const timetz = (): ColumnBuilder<"datetime", { typeName: "timetz" }> =>
	initialColumnBuilder("timetz");
/** `timestamp` column. */
export const timestamp = (): ColumnBuilder<
	"datetime",
	{ typeName: "timestamp" }
> => initialColumnBuilder("timestamp");
/** `timestamp with time zone` column (short internal name `timestamptz`). */
export const timestamptz = (): ColumnBuilder<
	"datetime",
	{ typeName: "timestamptz" }
> => initialColumnBuilder("timestamptz");
/** `interval` column. */
export const interval = (): ColumnBuilder<
	"interval",
	{ typeName: "interval" }
> => initialColumnBuilder("interval");
/** `json` column. */
export const json = (): ColumnBuilder<"json", { typeName: "json" }> =>
	initialColumnBuilder("json");
/** `jsonb` column. */
export const jsonb = (): ColumnBuilder<"json", { typeName: "jsonb" }> =>
	initialColumnBuilder("jsonb");
/** `bytea` column. */
export const bytea = (): ColumnBuilder<"bytea", { typeName: "bytea" }> =>
	initialColumnBuilder("bytea");
/** `inet` column. */
export const inet = (): ColumnBuilder<"net", { typeName: "inet" }> =>
	initialColumnBuilder("inet");
/** `cidr` column. */
export const cidr = (): ColumnBuilder<"net", { typeName: "cidr" }> =>
	initialColumnBuilder("cidr");
/** `macaddr` column. */
export const macaddr = (): ColumnBuilder<"net", { typeName: "macaddr" }> =>
	initialColumnBuilder("macaddr");
/** `serial` column. */
export const serial = (): ColumnBuilder<"numeric", { typeName: "serial" }> =>
	initialColumnBuilder("serial");
/** `smallserial` column. */
export const smallserial = (): ColumnBuilder<
	"numeric",
	{ typeName: "smallserial" }
> => initialColumnBuilder("smallserial");
/** `bigserial` column. */
export const bigserial = (): ColumnBuilder<
	"numeric",
	{ typeName: "bigserial" }
> => initialColumnBuilder("bigserial");

/** Config accepted by {@link varchar}. */
export type VarcharConfig = { readonly length?: number };

/** `varchar` column, optionally length-bounded. */
export const varchar = (
	config: VarcharConfig = {},
): ColumnBuilder<"text", { typeName: "varchar" }> =>
	createColumnBuilder<"text", { typeName: "varchar" }>({
		typeNode: {
			typeName: "varchar",
			length: resolveOptionalNumber(config.length),
		},
		notNull: false,
		primaryKey: false,
		unique: false,
		defaultValue: null,
	});

/** Config required by {@link char}. */
export type CharConfig = { readonly length: number };

/** `char` column, always length-bounded. */
export const char = (
	config: CharConfig,
): ColumnBuilder<"text", { typeName: "char" }> =>
	createColumnBuilder<"text", { typeName: "char" }>({
		typeNode: { typeName: "char", length: config.length },
		notNull: false,
		primaryKey: false,
		unique: false,
		defaultValue: null,
	});

/** Config accepted by {@link numeric}. */
export type NumericConfig = {
	readonly precision?: number;
	readonly scale?: number;
};

/** `numeric` column, optionally precision/scale-bounded. */
export const numeric = (
	config: NumericConfig = {},
): ColumnBuilder<"numeric", { typeName: "numeric" }> =>
	createColumnBuilder<"numeric", { typeName: "numeric" }>({
		typeNode: {
			typeName: "numeric",
			precision: resolveOptionalNumber(config.precision),
			scale: resolveOptionalNumber(config.scale),
		},
		notNull: false,
		primaryKey: false,
		unique: false,
		defaultValue: null,
	});

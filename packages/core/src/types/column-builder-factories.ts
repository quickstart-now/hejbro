import type { SqlTypeFamily } from "../expr/type-family";
import type { ColumnBuilder } from "./column-builder";
import { createColumnBuilder } from "./column-builder";
import type { SimpleTypeName } from "./type-node";

const initialColumnBuilder = <TFamily extends SqlTypeFamily>(
	typeName: SimpleTypeName,
): ColumnBuilder<TFamily> =>
	createColumnBuilder<TFamily>({
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
export const uuid = (): ColumnBuilder<"uuid"> =>
	initialColumnBuilder<"uuid">("uuid");
/** `text` column. */
export const text = (): ColumnBuilder<"text"> =>
	initialColumnBuilder<"text">("text");
/** `boolean` column. */
export const boolean = (): ColumnBuilder<"boolean"> =>
	initialColumnBuilder<"boolean">("boolean");
/** `smallint` column. */
export const smallint = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("smallint");
/** `integer` column. */
export const integer = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("integer");
/** `bigint` column. */
export const bigint = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("bigint");
/** `real` column. */
export const real = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("real");
/** `double precision` column. */
export const doublePrecision = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("double precision");
/** `date` column. */
export const date = (): ColumnBuilder<"datetime"> =>
	initialColumnBuilder<"datetime">("date");
/** `time` column. */
export const time = (): ColumnBuilder<"datetime"> =>
	initialColumnBuilder<"datetime">("time");
/** `time with time zone` column (short internal name `timetz`). */
export const timetz = (): ColumnBuilder<"datetime"> =>
	initialColumnBuilder<"datetime">("timetz");
/** `timestamp` column. */
export const timestamp = (): ColumnBuilder<"datetime"> =>
	initialColumnBuilder<"datetime">("timestamp");
/** `timestamp with time zone` column (short internal name `timestamptz`). */
export const timestamptz = (): ColumnBuilder<"datetime"> =>
	initialColumnBuilder<"datetime">("timestamptz");
/** `interval` column. */
export const interval = (): ColumnBuilder<"interval"> =>
	initialColumnBuilder<"interval">("interval");
/** `json` column. */
export const json = (): ColumnBuilder<"json"> =>
	initialColumnBuilder<"json">("json");
/** `jsonb` column. */
export const jsonb = (): ColumnBuilder<"json"> =>
	initialColumnBuilder<"json">("jsonb");
/** `bytea` column. */
export const bytea = (): ColumnBuilder<"bytea"> =>
	initialColumnBuilder<"bytea">("bytea");
/** `inet` column. */
export const inet = (): ColumnBuilder<"net"> =>
	initialColumnBuilder<"net">("inet");
/** `cidr` column. */
export const cidr = (): ColumnBuilder<"net"> =>
	initialColumnBuilder<"net">("cidr");
/** `macaddr` column. */
export const macaddr = (): ColumnBuilder<"net"> =>
	initialColumnBuilder<"net">("macaddr");
/** `serial` column. */
export const serial = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("serial");
/** `smallserial` column. */
export const smallserial = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("smallserial");
/** `bigserial` column. */
export const bigserial = (): ColumnBuilder<"numeric"> =>
	initialColumnBuilder<"numeric">("bigserial");

/** Config accepted by {@link varchar}. */
export type VarcharConfig = { readonly length?: number };

/** `varchar` column, optionally length-bounded. */
export const varchar = (config: VarcharConfig = {}): ColumnBuilder<"text"> =>
	createColumnBuilder<"text">({
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
export const char = (config: CharConfig): ColumnBuilder<"text"> =>
	createColumnBuilder<"text">({
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
export const numeric = (config: NumericConfig = {}): ColumnBuilder<"numeric"> =>
	createColumnBuilder<"numeric">({
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

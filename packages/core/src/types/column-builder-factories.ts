import type { ColumnBuilder } from "./column-builder";
import { createColumnBuilder } from "./column-builder";
import type { SimpleTypeName } from "./type-node";

const initialColumnBuilder = (typeName: SimpleTypeName): ColumnBuilder =>
	createColumnBuilder({
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
export const uuid = (): ColumnBuilder => initialColumnBuilder("uuid");
/** `text` column. */
export const text = (): ColumnBuilder => initialColumnBuilder("text");
/** `boolean` column. */
export const boolean = (): ColumnBuilder => initialColumnBuilder("boolean");
/** `smallint` column. */
export const smallint = (): ColumnBuilder => initialColumnBuilder("smallint");
/** `integer` column. */
export const integer = (): ColumnBuilder => initialColumnBuilder("integer");
/** `bigint` column. */
export const bigint = (): ColumnBuilder => initialColumnBuilder("bigint");
/** `real` column. */
export const real = (): ColumnBuilder => initialColumnBuilder("real");
/** `double precision` column. */
export const doublePrecision = (): ColumnBuilder =>
	initialColumnBuilder("double precision");
/** `date` column. */
export const date = (): ColumnBuilder => initialColumnBuilder("date");
/** `time` column. */
export const time = (): ColumnBuilder => initialColumnBuilder("time");
/** `time with time zone` column (short internal name `timetz`). */
export const timetz = (): ColumnBuilder => initialColumnBuilder("timetz");
/** `timestamp` column. */
export const timestamp = (): ColumnBuilder => initialColumnBuilder("timestamp");
/** `timestamp with time zone` column (short internal name `timestamptz`). */
export const timestamptz = (): ColumnBuilder =>
	initialColumnBuilder("timestamptz");
/** `interval` column. */
export const interval = (): ColumnBuilder => initialColumnBuilder("interval");
/** `json` column. */
export const json = (): ColumnBuilder => initialColumnBuilder("json");
/** `jsonb` column. */
export const jsonb = (): ColumnBuilder => initialColumnBuilder("jsonb");
/** `bytea` column. */
export const bytea = (): ColumnBuilder => initialColumnBuilder("bytea");
/** `inet` column. */
export const inet = (): ColumnBuilder => initialColumnBuilder("inet");
/** `cidr` column. */
export const cidr = (): ColumnBuilder => initialColumnBuilder("cidr");
/** `macaddr` column. */
export const macaddr = (): ColumnBuilder => initialColumnBuilder("macaddr");
/** `serial` column. */
export const serial = (): ColumnBuilder => initialColumnBuilder("serial");
/** `smallserial` column. */
export const smallserial = (): ColumnBuilder =>
	initialColumnBuilder("smallserial");
/** `bigserial` column. */
export const bigserial = (): ColumnBuilder => initialColumnBuilder("bigserial");

/** Config accepted by {@link varchar}. */
export type VarcharConfig = { readonly length?: number };

/** `varchar` column, optionally length-bounded. */
export const varchar = (config: VarcharConfig = {}): ColumnBuilder =>
	createColumnBuilder({
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
export const char = (config: CharConfig): ColumnBuilder =>
	createColumnBuilder({
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
export const numeric = (config: NumericConfig = {}): ColumnBuilder =>
	createColumnBuilder({
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

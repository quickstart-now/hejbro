import type { FamilyOfTypeNode } from "../expr/type-family";
import type { ColumnBuilder, NumericMode } from "./column-builder";
import { createColumnBuilder } from "./column-builder";
import {
	DEFAULT_BIGINT_MODE,
	DEFAULT_NUMERIC_MODE,
} from "./numeric-mode-defaults";
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
		mode: null,
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
/**
 * Builds the initial `ColumnBuilder` for a `serial`-family factory (task
 * 3.16): typed `notNull` and `hasDefault` from the start, mirroring
 * `materializeNotNull` (`kinds/table-kind.ts:97-105`) — a `serial` column is
 * always `NOT NULL` in the generated SQL, and its `nextval(...)` default
 * lives on the synthesized sequence declaration, never on
 * `columnState.defaultValue`. The two have to move together: typing
 * `notNull` without `hasDefault` would make a bare `serial().primaryKey()`
 * a *required* insert field (3.11's rule is "notNull without a default").
 * `columnState` itself stays exactly what `initialColumnBuilder` would
 * produce — `notNull: false`, `defaultValue: null` — only the type-level
 * claim changes, so the generated SQL and snapshot are unaffected. `TMeta`
 * mirrors `materializeNotNull` (the materialized column); `columnState`
 * stays the raw declaration. **The divergence is intentional**, not a bug
 * to "fix" toward matching `columnState` — see `primaryKey()`'s own tsdoc
 * on `ColumnBuilder` for the same point.
 */
const initialSerialColumnBuilder = <TName extends SimpleTypeName>(
	typeName: TName,
): ColumnBuilder<
	FamilyOfTypeNode<{ typeName: TName }>,
	{ typeName: TName } & { notNull: true } & { hasDefault: true }
> =>
	createColumnBuilder<
		FamilyOfTypeNode<{ typeName: TName }>,
		{ typeName: TName } & { notNull: true } & { hasDefault: true }
	>({
		typeNode: { typeName },
		notNull: false,
		primaryKey: false,
		unique: false,
		defaultValue: null,
		mode: null,
	});

/** `serial` column — implicitly `NOT NULL` with a sequence-backed default (D66); see {@link initialSerialColumnBuilder}. */
export const serial = (): ColumnBuilder<
	"numeric",
	{ typeName: "serial" } & { notNull: true } & { hasDefault: true }
> => initialSerialColumnBuilder("serial");
/** `smallserial` column — see {@link serial}. */
export const smallserial = (): ColumnBuilder<
	"numeric",
	{ typeName: "smallserial" } & { notNull: true } & { hasDefault: true }
> => initialSerialColumnBuilder("smallserial");
/** `bigserial` column — see {@link serial}. */
export const bigserial = (): ColumnBuilder<
	"numeric",
	{ typeName: "bigserial" } & { notNull: true } & { hasDefault: true }
> => initialSerialColumnBuilder("bigserial");

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
		mode: null,
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
		mode: null,
	});

/** Config accepted by {@link bigint}. */
export type BigintConfig<
	TMode extends NumericMode = typeof DEFAULT_BIGINT_MODE,
> = {
	/** how a `bigint` column reads back in TypeScript (D3, mirrors Drizzle) — default `'bigint'`; `'number'` throws beyond `Number.MAX_SAFE_INTEGER` (group 4) rather than losing precision, `'string'` never loses precision. */
	readonly mode?: TMode;
};

/** `bigint` column — see {@link BigintConfig} for `mode`. */
export const bigint = <TMode extends NumericMode = typeof DEFAULT_BIGINT_MODE>(
	config: BigintConfig<TMode> = {},
): ColumnBuilder<
	"numeric",
	{ typeName: "bigint" } & { mode: NoInfer<TMode> }
> =>
	createColumnBuilder<
		"numeric",
		{ typeName: "bigint" } & { mode: NoInfer<TMode> }
	>({
		typeNode: { typeName: "bigint" },
		notNull: false,
		primaryKey: false,
		unique: false,
		defaultValue: null,
		mode: config.mode ?? DEFAULT_BIGINT_MODE,
	});

/** Config accepted by {@link numeric}. */
export type NumericConfig<
	TMode extends NumericMode = typeof DEFAULT_NUMERIC_MODE,
> = {
	readonly precision?: number;
	readonly scale?: number;
	/** how a `numeric` column reads back in TypeScript (D3, mirrors Drizzle) — default `'string'` (never loses precision); `'number'` throws beyond `Number.MAX_SAFE_INTEGER` (group 4) rather than losing precision, `'bigint'` truncates any fractional part (group 4). */
	readonly mode?: TMode;
};

/** `numeric` column, optionally precision/scale-bounded; see {@link NumericConfig} for `mode`. */
export const numeric = <
	TMode extends NumericMode = typeof DEFAULT_NUMERIC_MODE,
>(
	config: NumericConfig<TMode> = {},
): ColumnBuilder<
	"numeric",
	{ typeName: "numeric" } & { mode: NoInfer<TMode> }
> =>
	createColumnBuilder<
		"numeric",
		{ typeName: "numeric" } & { mode: NoInfer<TMode> }
	>({
		typeNode: {
			typeName: "numeric",
			precision: resolveOptionalNumber(config.precision),
			scale: resolveOptionalNumber(config.scale),
		},
		notNull: false,
		primaryKey: false,
		unique: false,
		defaultValue: null,
		mode: config.mode ?? DEFAULT_NUMERIC_MODE,
	});

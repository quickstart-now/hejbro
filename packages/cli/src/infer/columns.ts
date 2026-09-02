import type { ColumnBuilder } from "@hejbro/core";
import {
	bigint,
	boolean,
	bytea,
	char,
	cidr,
	date,
	doublePrecision,
	inet,
	integer,
	interval,
	json,
	jsonb,
	macaddr,
	numeric,
	real,
	smallint,
	sql,
	text,
	time,
	timestamp,
	timestamptz,
	timetz,
	uuid,
	varchar,
} from "@hejbro/core";

/**
 * `.generatedAlwaysAsIdentity()`'s own option type is not on `@hejbro/
 * core`'s public surface (only `ColumnBuilder` itself, `BuilderFamily`,
 * `ColumnReadType`, `ColumnState`, `NumericMode`, `OriginBrand` are --
 * CI-G1-R1-04). Derived structurally from the method's own signature
 * rather than widening the export surface for this module's convenience.
 */
type IdentityOptionsParam = NonNullable<
	Parameters<ColumnBuilder["generatedAlwaysAsIdentity"]>[0]
>;

/**
 * Facts 1.3 needs about one column, merged from `check/catalog.ts`'s
 * `ColumnRow` (schema/table/name/notNull/catalogType/baseTypeName/
 * catalogDefault) and `infer/catalog.ts`'s `ColumnDetailRow`
 * (identityKind/generatedKind), plus an identity column's
 * `IdentitySequenceOptionRow`. The merge itself is not this module's
 * job -- it belongs where a table's columns are assembled (1.4).
 */
export type InferredColumnFacts = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	/** `check/catalog.ts`'s `catalogType` (`format_type` text, e.g. `"numeric(10,2)"`) -- the only place precision/scale/length survive, and the text a loss report names. */
	readonly sqlType: string;
	/** `pg_type.typname` of the unwrapped base type (never `format_type` text) -- `null` only when the catalog itself had nothing to unwrap to (an unresolvable type). */
	readonly baseTypeName: string | null;
	readonly isArray: boolean;
	readonly notNull: boolean;
	/** `pg_get_expr` text -- a plain column's default, or (when `generatedKind === "s"`) the stored generated column's own expression (Postgres keeps both in `pg_attrdef`). */
	readonly catalogDefault: string | null;
	/** `attidentity`: `""` (not identity), `"a"` (always), `"d"` (by default). */
	readonly identityKind: string;
	/** `attgenerated`: `""` (not generated) or `"s"` (stored). */
	readonly generatedKind: string;
	readonly identityOptions: {
		readonly startValue: string;
		readonly increment: string;
		readonly minValue: string;
		readonly maxValue: string;
		readonly cache: string;
		readonly cycle: boolean;
	} | null;
};

export type ColumnLoss = {
	readonly schema: string;
	readonly table: string;
	readonly column: string;
	readonly sqlType: string;
};

export type ColumnDeclarationResult =
	| { readonly kind: "declared"; readonly builder: ColumnBuilder }
	| { readonly kind: "loss"; readonly loss: ColumnLoss };

/**
 * `pg_type.typname` to the column builder factory that expresses it --
 * every catalog-facing name among the 26 builders `@hejbro/core` exports
 * (D57 naming rule note: `serial`/`bigserial`/`smallserial` are
 * declaration-time sugar over `int4`/`int8`/`int2` plus an owned
 * sequence, never a real Postgres type, so they never appear as a
 * `typname` and are absent here by construction, not by omission).
 */
const SIMPLE_TYPE_BUILDERS: Readonly<Record<string, () => ColumnBuilder>> = {
	uuid: () => uuid(),
	text: () => text(),
	bool: () => boolean(),
	int2: () => smallint(),
	int4: () => integer(),
	int8: () => bigint(),
	float4: () => real(),
	float8: () => doublePrecision(),
	date: () => date(),
	time: () => time(),
	timetz: () => timetz(),
	timestamp: () => timestamp(),
	timestamptz: () => timestamptz(),
	interval: () => interval(),
	json: () => json(),
	jsonb: () => jsonb(),
	bytea: () => bytea(),
	inet: () => inet(),
	cidr: () => cidr(),
	macaddr: () => macaddr(),
};

const NUMERIC_PRECISION_SCALE = /numeric\((\d+),(\d+)\)/;
const VARCHAR_LENGTH = /character varying\((\d+)\)/;
const CHAR_LENGTH = /character\((\d+)\)/;

const parameterizedBuilder = (
	baseTypeName: string,
	sqlType: string,
): (() => ColumnBuilder) | null => {
	if (baseTypeName === "numeric") {
		const match = NUMERIC_PRECISION_SCALE.exec(sqlType);
		if (match === null) {
			return () => numeric();
		}
		const [, precision, scale] = match;
		return () =>
			numeric({ precision: Number(precision), scale: Number(scale) });
	}
	if (baseTypeName === "varchar") {
		const match = VARCHAR_LENGTH.exec(sqlType);
		if (match === null) {
			return () => varchar();
		}
		const [, length] = match;
		return () => varchar({ length: Number(length) });
	}
	if (baseTypeName === "bpchar") {
		const match = CHAR_LENGTH.exec(sqlType);
		if (match === null) {
			return null;
		}
		const [, length] = match;
		return () => char({ length: Number(length) });
	}
	return null;
};

const baseBuilder = (
	baseTypeName: string,
	sqlType: string,
): (() => ColumnBuilder) | null => {
	const simple = SIMPLE_TYPE_BUILDERS[baseTypeName];
	if (simple !== undefined) {
		return simple;
	}
	return parameterizedBuilder(baseTypeName, sqlType);
};

const applyArray = (
	builder: ColumnBuilder,
	isArray: boolean,
): ColumnBuilder => {
	if (isArray) {
		return builder.array();
	}
	return builder;
};

const withNotNull = (
	builder: ColumnBuilder,
	notNull: boolean,
): ColumnBuilder => {
	if (notNull) {
		return builder.notNull();
	}
	return builder;
};

/** Postgres's own default range for a `smallint`/`integer`/`bigint` identity sequence -- `integer`'s range is the fallback for any base type this map doesn't name (matches an identity column's own type constraint: Postgres only allows an integer-family column to be `GENERATED ... AS IDENTITY`). */
const INT2_IDENTITY_RANGE = { min: "1", max: "32767" };
const INT4_IDENTITY_RANGE = { min: "1", max: "2147483647" };
const INT8_IDENTITY_RANGE = { min: "1", max: "9223372036854775807" };

const identityRangeFor = (
	baseTypeName: string | null,
): { readonly min: string; readonly max: string } => {
	if (baseTypeName === "int2") {
		return INT2_IDENTITY_RANGE;
	}
	if (baseTypeName === "int8") {
		return INT8_IDENTITY_RANGE;
	}
	return INT4_IDENTITY_RANGE;
};

const diffEntry = <K extends string, V>(
	key: K,
	changed: boolean,
	value: V,
): Partial<Record<K, V>> => {
	if (changed) {
		return { [key]: value } as Partial<Record<K, V>>;
	}
	return {};
};

/**
 * The declared truth is only what differs from Postgres's own default for
 * this column's integer type (D100) -- an option the catalog reports at
 * its default is never carried into the declaration, exactly mirroring
 * `IdentitySnapshot`'s own "absent key renders nothing" rule
 * (`table-kind-emit-sql.ts`).
 */
const identityOptionsDiff = (
	facts: InferredColumnFacts,
): IdentityOptionsParam => {
	if (facts.identityOptions === null) {
		return {};
	}
	const range = identityRangeFor(facts.baseTypeName);
	const options = facts.identityOptions;
	return {
		...diffEntry(
			"startWith",
			options.startValue !== range.min,
			Number(options.startValue),
		),
		...diffEntry(
			"increment",
			options.increment !== "1",
			Number(options.increment),
		),
		...diffEntry(
			"minValue",
			options.minValue !== range.min,
			Number(options.minValue),
		),
		...diffEntry(
			"maxValue",
			options.maxValue !== range.max,
			Number(options.maxValue),
		),
		...diffEntry("cache", options.cache !== "1", Number(options.cache)),
		...diffEntry("cycle", options.cycle !== false, options.cycle),
	};
};

/**
 * Generated and identity are mutually exclusive on a real Postgres
 * column (core's own `ColumnState` rule) and are checked in that order:
 * a stored generated column's expression lives in the same
 * `pg_attrdef` row a plain default would (ci-planner CI-G1-R1-04) --
 * checking `generatedKind` first is what keeps it off `.default()`.
 */
const withGeneratedIdentityOrDefault = (
	builder: ColumnBuilder,
	facts: InferredColumnFacts,
): ColumnBuilder => {
	if (facts.generatedKind === "s" && facts.catalogDefault !== null) {
		return builder.generatedAlwaysAs(sql.raw(facts.catalogDefault));
	}
	if (facts.identityKind === "a") {
		return builder.generatedAlwaysAsIdentity(identityOptionsDiff(facts));
	}
	if (facts.identityKind === "d") {
		return builder.generatedByDefaultAsIdentity(identityOptionsDiff(facts));
	}
	if (facts.catalogDefault !== null) {
		return builder.default(sql.raw(facts.catalogDefault));
	}
	return builder;
};

/**
 * One column's facts to a real `@hejbro/core` column builder, or a loss
 * when no builder expresses `baseTypeName`/`sqlType` (catalog-inference
 * delta: "or column whose type no column builder expresses"). Builds an
 * actual `ColumnBuilder` (core's public DSL), never assembled snapshot
 * JSON -- `table()` and `generateMigration` do the rest (settled design,
 * tasks.md group 1 header).
 */
export const inferColumnDeclaration = (
	facts: InferredColumnFacts,
): ColumnDeclarationResult => {
	const loss: ColumnLoss = {
		schema: facts.schema,
		table: facts.table,
		column: facts.name,
		sqlType: facts.sqlType,
	};
	if (facts.baseTypeName === null) {
		return { kind: "loss", loss };
	}
	const factory = baseBuilder(facts.baseTypeName, facts.sqlType);
	if (factory === null) {
		return { kind: "loss", loss };
	}
	const declared = withNotNull(
		withGeneratedIdentityOrDefault(applyArray(factory(), facts.isArray), facts),
		facts.notNull,
	);
	return { kind: "declared", builder: declared };
};

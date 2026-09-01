import type { NumericMode, TypeNode } from "@hejbro/core";
import type { ContractEnumFact } from "./read-snapshot";

/**
 * A quoted TypeScript string-literal union of `values`, or `string` when
 * the referenced enum has no snapshot entry at all (a vendored contract
 * never invents a type it cannot describe — mirrors 5.9's "no relation
 * to an unmanaged target" for the enum axis).
 */
export const enumUnion = (values: ReadonlyArray<string>): string => {
	if (values.length === 0) {
		return "string";
	}
	return values.map((value) => JSON.stringify(value)).join(" | ");
};

const numericModeTsTypeValue = (mode: NumericMode): string => {
	if (mode === "bigint") {
		return "bigint";
	}
	if (mode === "string") {
		return "string";
	}
	return "number";
};

/**
 * `bigint`/`numeric`'s own resolved-mode type — the no-mode fallback
 * differs per declared type name (`@hejbro/core`'s own
 * `DefaultBigintMode`/`DefaultNumericMode`, `numeric-mode-defaults.ts`,
 * never exported publicly, so this restates the two literals rather
 * than importing them): a `bigint` column with no mode reads as
 * `bigint` (never silently narrower than the 64-bit value it holds), a
 * `numeric` column with no mode reads as `string` (a `numeric` can be
 * fractional, where a JS `number` would silently lose precision).
 */
const numericModeTsType = (
	typeName: "bigint" | "numeric",
	mode: NumericMode | null,
): string => {
	if (mode !== null) {
		return numericModeTsTypeValue(mode);
	}
	if (typeName === "bigint") {
		return "bigint";
	}
	return "string";
};

/**
 * One column's base scalar type, before array wrapping — mirrors
 * `@hejbro/core`'s own `BaseScalarTsType` (`types/ts-type-map.ts`)
 * type-level mapping, restated as runtime strings because this module
 * emits source text rather than expanding a generic (schema-vendoring
 * spec, "The contract reproduces the consumer-visible type layer").
 * `enumLookup` resolves an `enum` `TypeNode`'s declared values; a `$type`
 * brand never reaches here at all, since a `TypeNode` never carries one
 * (Requirement: "Type brands do not cross the boundary" — satisfied
 * structurally, not by a check in this function).
 */
export const baseScalarTsType = (
	node: TypeNode,
	mode: NumericMode | null,
	enumLookup: (schema: string, name: string) => ContractEnumFact | null,
): string => {
	switch (node.typeName) {
		case "enum": {
			const fact = enumLookup(node.enumSchema, node.enumName);
			if (fact === null) {
				return enumUnion([]);
			}
			return enumUnion(fact.values);
		}
		case "uuid":
		case "text":
		case "varchar":
		case "char":
		case "inet":
		case "cidr":
		case "macaddr":
		case "time":
		case "timetz":
			return "string";
		case "boolean":
			return "boolean";
		case "smallint":
		case "integer":
		case "real":
		case "double precision":
		case "serial":
		case "smallserial":
			return "number";
		case "bigint":
		case "numeric":
			return numericModeTsType(node.typeName, mode);
		case "bigserial":
			return "bigint";
		case "date":
		case "timestamp":
		case "timestamptz":
			return "Date";
		case "interval":
			// The structured `IntervalValue` shape (`@hejbro/core`) — named by
			// import in the emitted module rather than spelled out inline, so
			// the two never drift (5.4's own "each from its carried fact").
			return "IntervalValue";
		case "json":
		case "jsonb":
			return "unknown";
		case "bytea":
			return "Uint8Array";
		case "array":
			// unreachable here: array wrapping is `columnTsType`'s own job
			// (it needs `notNullElements`, which this function never sees).
			return "unknown";
		default:
			return "unknown";
	}
};

/**
 * A full column type, including array wrapping and the element
 * nullability the sidecar carries (5.4) — `notNull` is the *column's*
 * own nullability (applied by the caller, `tables.ts`, since it also
 * governs `Insert`/`Update`'s value type, not just `Row`'s).
 */
export const columnTsType = (
	node: TypeNode,
	mode: NumericMode | null,
	notNullElements: boolean,
	enumLookup: (schema: string, name: string) => ContractEnumFact | null,
): string => {
	if (node.typeName !== "array") {
		return baseScalarTsType(node, mode, enumLookup);
	}
	const element = baseScalarTsType(node.element, mode, enumLookup);
	if (notNullElements) {
		return `ReadonlyArray<${element}>`;
	}
	return `ReadonlyArray<${element} | null>`;
};

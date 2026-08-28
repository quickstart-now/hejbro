import type { ColumnBuilder } from "../types/column-builder";
import { createColumnBuilder } from "../types/column-builder";
import type { SchemaDeclaration } from "./schema";

/**
 * At least one value, captured as literals. The `const` type parameter on
 * {@link pgEnum} is what preserves them: without it the argument widens to
 * `string[]` at the call site and the values are gone before any type can
 * read them (#422).
 */
export type EnumValues = readonly [string, ...ReadonlyArray<string>];

/** A declared Postgres enum type and its allowed values, in declaration order. */
export type EnumDeclaration<TValues extends EnumValues = EnumValues> = {
	readonly declarationKind: "enum";
	readonly schema: SchemaDeclaration;
	readonly enumName: string;
	readonly values: TValues;
	/** use as a column type: `status: appStatus.column().notNull()` */
	column(): ColumnBuilder<
		"text",
		{ typeName: "enum"; enumValues: TValues[number] }
	>;
};

/** Declares a Postgres enum type, owned by `owner`, with the given `values`. */
export const pgEnum = <const TValues extends EnumValues>(
	owner: SchemaDeclaration,
	enumName: string,
	values: TValues,
): EnumDeclaration<TValues> => ({
	declarationKind: "enum",
	schema: owner,
	enumName,
	values,
	column: () =>
		createColumnBuilder<
			"text",
			{ typeName: "enum"; enumValues: TValues[number] }
		>({
			typeNode: { typeName: "enum", enumSchema: owner.schemaName, enumName },
			notNull: false,
			primaryKey: false,
			unique: false,
			defaultValue: null,
			mode: null,
		}),
});

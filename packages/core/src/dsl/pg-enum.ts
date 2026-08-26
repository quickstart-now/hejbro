import type { ColumnBuilder } from "../types/column-builder";
import { createColumnBuilder } from "../types/column-builder";
import type { SchemaDeclaration } from "./schema";

/** A declared Postgres enum type and its allowed values, in declaration order. */
export type EnumDeclaration = {
	readonly declarationKind: "enum";
	readonly schema: SchemaDeclaration;
	readonly enumName: string;
	readonly values: ReadonlyArray<string>;
	/** use as a column type: `status: appStatus.column().notNull()` */
	column(): ColumnBuilder<"text", { typeName: "enum" }>;
};

/** Declares a Postgres enum type, owned by `owner`, with the given `values`. */
export const pgEnum = (
	owner: SchemaDeclaration,
	enumName: string,
	values: ReadonlyArray<string>,
): EnumDeclaration => ({
	declarationKind: "enum",
	schema: owner,
	enumName,
	values,
	column: () =>
		createColumnBuilder<"text", { typeName: "enum" }>({
			typeNode: { typeName: "enum", enumSchema: owner.schemaName, enumName },
			notNull: false,
			primaryKey: false,
			unique: false,
			defaultValue: null,
		}),
});

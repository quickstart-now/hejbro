import { assertSqlName } from "../sql/identifier-rules";

/** A declared Postgres schema (namespace) that tables and enums live under. */
export type SchemaDeclaration = {
	readonly declarationKind: "schema";
	readonly schemaName: string;
};

/** Declares a Postgres schema by name. */
export const schema = (schemaName: string): SchemaDeclaration => ({
	declarationKind: "schema",
	schemaName: assertSqlName(schemaName, "schema", null),
});

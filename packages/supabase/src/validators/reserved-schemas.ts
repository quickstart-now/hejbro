import type { Diagnostic, Validator } from "@hejbro/core";
import { diagnostic } from "@hejbro/core";
import { declaredAtOf, schemaOf } from "./schema-of";

/** The Postgres schemas Supabase owns and manages — hejbro must never create or alter objects in them (D38). */
export const reservedSchemas: ReadonlyArray<string> = [
	"auth",
	"storage",
	"realtime",
];

const reservedSchemaMessage = (schemaName: string): string =>
	`schema "${schemaName}" is managed by Supabase — hejbro must not create or alter objects in it. Remove the declaration; to reference an existing table there, use existingTable() (e.g. @hejbro/supabase's authUsers).`;

/**
 * Hard-errors on any managed declaration (schema, table, view, function,
 * trigger, grant, RLS/policy) targeting a reserved schema (D38).
 * `existingTable()` references are exempt by construction — they never
 * enter `generateMigration`'s normalized declaration list (D41's
 * `existing-table-declared` hard error rejects them earlier).
 */
export const reservedSchemaValidator: Validator = (_snapshot, declarations) =>
	declarations.flatMap((declaration): ReadonlyArray<Diagnostic> => {
		const schemaName = schemaOf(declaration);
		if (schemaName === null || !reservedSchemas.includes(schemaName)) {
			return [];
		}
		return [
			diagnostic(
				"error",
				"reserved-schema",
				reservedSchemaMessage(schemaName),
				declaredAtOf(declaration),
			),
		];
	});

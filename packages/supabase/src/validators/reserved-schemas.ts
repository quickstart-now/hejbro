import type { Diagnostic, Validator } from "@hejbro/core";
import { diagnostic } from "@hejbro/core";
import {
	declaredAtOf,
	isManagedTableDeclaration,
	isTableDeclaration,
	schemaOf,
} from "./schema-of";

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
 * `existingTable()` references are exempt (D38/D41): this judges DDL
 * hejbro would create or alter, and an unmanaged table's is never run
 * (add-unmanaged-objects, J6-2 — before that change the exemption held
 * structurally, because `existingTable()` never reached this validator's
 * `declarations` at all; the guard that made that true is retired, so the
 * exemption moves here, explicitly).
 */
export const reservedSchemaValidator: Validator = (_snapshot, declarations) =>
	declarations.flatMap((declaration): ReadonlyArray<Diagnostic> => {
		if (
			isTableDeclaration(declaration) &&
			!isManagedTableDeclaration(declaration)
		) {
			return [];
		}
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

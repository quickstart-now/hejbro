import type {
	EnumDeclaration,
	FunctionDeclaration,
	GrantDeclaration,
	HejbroDeclaration,
	PolicyDeclaration,
	RlsDeclaration,
	SchemaDeclaration,
	TableDeclaration,
	TriggerDeclaration,
	ViewDeclaration,
} from "@hejbro/core";

/** Narrows a normalized declaration to {@link SchemaDeclaration}. */
export const isSchemaDeclaration = (
	declaration: HejbroDeclaration,
): declaration is SchemaDeclaration => declaration.declarationKind === "schema";

/** Narrows a normalized declaration to {@link TableDeclaration}. */
export const isTableDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TableDeclaration => declaration.declarationKind === "table";

/** Narrows a normalized declaration to {@link ViewDeclaration}. */
export const isViewDeclaration = (
	declaration: HejbroDeclaration,
): declaration is ViewDeclaration => declaration.declarationKind === "view";

/** Narrows a normalized declaration to {@link EnumDeclaration}. */
export const isEnumDeclaration = (
	declaration: HejbroDeclaration,
): declaration is EnumDeclaration => declaration.declarationKind === "enum";

/** Narrows a normalized declaration to {@link FunctionDeclaration}. */
export const isFunctionDeclaration = (
	declaration: HejbroDeclaration,
): declaration is FunctionDeclaration =>
	declaration.declarationKind === "function";

/** Narrows a normalized declaration to {@link TriggerDeclaration}. */
export const isTriggerDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TriggerDeclaration =>
	declaration.declarationKind === "trigger";

/** Narrows a normalized declaration to {@link RlsDeclaration}. */
export const isRlsDeclaration = (
	declaration: HejbroDeclaration,
): declaration is RlsDeclaration => declaration.declarationKind === "rls";

/** Narrows a normalized declaration to {@link PolicyDeclaration}. */
export const isPolicyDeclaration = (
	declaration: HejbroDeclaration,
): declaration is PolicyDeclaration => declaration.declarationKind === "policy";

/** Narrows a normalized declaration to {@link GrantDeclaration}. */
export const isGrantDeclaration = (
	declaration: HejbroDeclaration,
): declaration is GrantDeclaration => declaration.declarationKind === "grant";

/**
 * Resolves the Postgres schema a normalized declaration targets, per
 * `declarationKind` (shared by the reserved-schema and exposed-table
 * validators). `null` for declaration kinds with no single owning schema
 * (none exist today — every built-in kind carries one — but this keeps
 * the function total instead of throwing on a future addition).
 */
export const schemaOf = (declaration: HejbroDeclaration): string | null => {
	if (isSchemaDeclaration(declaration)) {
		return declaration.schemaName;
	}
	if (
		isTableDeclaration(declaration) ||
		isViewDeclaration(declaration) ||
		isEnumDeclaration(declaration)
	) {
		return declaration.schema.schemaName;
	}
	if (
		isFunctionDeclaration(declaration) ||
		isTriggerDeclaration(declaration) ||
		isRlsDeclaration(declaration) ||
		isPolicyDeclaration(declaration) ||
		isGrantDeclaration(declaration)
	) {
		return declaration.schemaName;
	}
	return null;
};

/**
 * Resolves a normalized declaration's `declaredAt` best-effort source
 * location, per `declarationKind`. `null` for kinds that carry none
 * (`schema`/`enum` — `schema()` and `pgEnum()` don't capture one today).
 */
export const declaredAtOf = (declaration: HejbroDeclaration): string | null => {
	if (
		isTableDeclaration(declaration) ||
		isViewDeclaration(declaration) ||
		isFunctionDeclaration(declaration) ||
		isTriggerDeclaration(declaration) ||
		isRlsDeclaration(declaration) ||
		isPolicyDeclaration(declaration) ||
		isGrantDeclaration(declaration)
	) {
		return declaration.declaredAt;
	}
	return null;
};

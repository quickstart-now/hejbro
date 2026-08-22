import { captureDeclarationSite } from "../declaration-site";
import { throwHejbroError } from "../error";
import type { Role } from "./role";
import type { SchemaDeclaration } from "./schema";

/** The table-level privileges hejbro can grant/revoke, in their canonical (deterministic) order. */
export const tablePrivileges = [
	"select",
	"insert",
	"update",
	"delete",
] as const;

/** @see tablePrivileges */
export type TablePrivilege = (typeof tablePrivileges)[number];

/** The three grant shapes the original production schema needs (D28) — per-table and per-function grants are out of scope until a real declaration needs them. Values are kebab-case (D57): they appear verbatim in snapshot identities and migration banners. */
export type GrantKind =
	| "schema-usage"
	| "all-tables-privileges"
	| "default-table-privileges";

/** A declared grant for exactly one role. Identity is `(schemaName, grantKind, role)` (D28). */
export type GrantDeclaration = {
	readonly declarationKind: "grant";
	readonly grantKind: GrantKind;
	readonly schemaName: string;
	readonly privileges: ReadonlyArray<TablePrivilege>;
	readonly role: string;
	readonly declaredAt: string | null;
};

/** `to(...roles)` output — one {@link GrantDeclaration} per role (D28 fan-out). */
export type GrantSetDeclaration = {
	readonly declarationKind: "grant-set";
	readonly grants: ReadonlyArray<GrantDeclaration>;
};

type GrantRolesStage = {
	to(...roles: ReadonlyArray<string | Role>): GrantSetDeclaration;
};

type SchemaGrantBuilder = {
	readonly usage: GrantRolesStage;
	tables(...privileges: ReadonlyArray<TablePrivilege>): GrantRolesStage;
	readonly defaultPrivileges: {
		tables(...privileges: ReadonlyArray<TablePrivilege>): GrantRolesStage;
	};
};

/** Normalizes a privilege list to canonical order, deduplicated — deterministic regardless of call order. */
const normalizePrivileges = (
	privileges: ReadonlyArray<TablePrivilege>,
): ReadonlyArray<TablePrivilege> =>
	tablePrivileges.filter((privilege) => privileges.includes(privilege));

const emptyPrivilegesMessage = (schemaName: string): string =>
	`grant("${schemaName}").tables() lists no privileges. Next: pass at least one of "select" | "insert" | "update" | "delete".`;

const missingRolesMessage = (schemaName: string, chainLabel: string): string =>
	`grant("${schemaName}").${chainLabel}.to() has no roles — Postgres requires at least one role after TO. Next: pass .to("anon") or the intended role list.`;

const buildRolesStage = (
	schemaName: string,
	grantKind: GrantKind,
	privileges: ReadonlyArray<TablePrivilege>,
	declaredAt: string | null,
	chainLabel: string,
): GrantRolesStage => ({
	to: (...roles) => {
		if (roles.length === 0) {
			return throwHejbroError(
				"grant-missing-roles",
				missingRolesMessage(schemaName, chainLabel),
				declaredAt,
			);
		}
		const grants = roles.map((role) => ({
			declarationKind: "grant" as const,
			grantKind,
			schemaName,
			privileges,
			role,
			declaredAt,
		}));
		return { declarationKind: "grant-set", grants };
	},
});

const buildTablesStage = (
	schemaName: string,
	grantKind: GrantKind,
	rawPrivileges: ReadonlyArray<TablePrivilege>,
	declaredAt: string | null,
	chainLabel: string,
): GrantRolesStage => {
	if (rawPrivileges.length === 0) {
		return throwHejbroError(
			"grant-empty-privileges",
			emptyPrivilegesMessage(schemaName),
			declaredAt,
		);
	}
	return buildRolesStage(
		schemaName,
		grantKind,
		normalizePrivileges(rawPrivileges),
		declaredAt,
		chainLabel,
	);
};

/**
 * Starts a grant declaration under `owner` (D28): `.usage` for
 * `grant usage on schema`, `.tables(...)` for
 * `grant ... on all tables in schema`, `.defaultPrivileges.tables(...)`
 * for `alter default privileges ... grant ... on tables`. Each ends with
 * `.to(...roles)`, fanning out into one `GrantDeclaration` per role.
 */
export const grant = (owner: SchemaDeclaration): SchemaGrantBuilder => {
	const schemaName = owner.schemaName;
	const declaredAt = captureDeclarationSite();
	return {
		usage: buildRolesStage(schemaName, "schema-usage", [], declaredAt, "usage"),
		tables: (...privileges) =>
			buildTablesStage(
				schemaName,
				"all-tables-privileges",
				privileges,
				declaredAt,
				"tables(...)",
			),
		defaultPrivileges: {
			tables: (...privileges) =>
				buildTablesStage(
					schemaName,
					"default-table-privileges",
					privileges,
					declaredAt,
					"defaultPrivileges.tables(...)",
				),
		},
	};
};

import type {
	HejbroError,
	JsonValue,
	KindRegistry,
	RegisteredObjectKind,
	Snapshot,
	TypeNode,
} from "@hejbro/core";
import {
	createDefaultRegistry,
	decodeExprNode,
	hejbroError,
	renderExpr,
	renderTypeNode,
	throwHejbroError,
} from "@hejbro/core";
import type { Catalog, ColumnRow } from "./catalog";

/**
 * One comparison outcome, carrying the object's identity and the
 * `HejbroError` the report renders (group 4's `fromHejbroError` already
 * takes exactly this pair) -- never a raw diff (spec: "Differences are
 * reported per object, never as a diff").
 */
export type Finding = {
	readonly identity: string;
	readonly error: HejbroError;
};

const missingFinding = (identity: string, describe: string): Finding => ({
	identity,
	error: hejbroError(
		"check-object-missing",
		`declared ${describe} "${identity}" was not found in the database. Next: apply the migration that creates it, or remove the declaration if it is no longer needed.`,
	),
});

/** `check-object-differs`'s one shape (2.1 owns it) -- exported so expression.ts (group 3) shares it instead of defining its own, which had already started to drift (m2, review round 2). */
export const differsFinding = (
	identity: string,
	message: string,
	next: string,
): Finding => ({
	identity,
	error: hejbroError("check-object-differs", `${message} Next: ${next}`),
});

/**
 * `check-not-compared`'s shape for this file (#482, task 2.4) -- a
 * comparison that should have run and could not, never a difference:
 * `expression.ts`'s own `notComparedFinding` is the same code for a
 * different unrenderable-expression cause, kept separate rather than
 * shared because the two reasons and `Next:` clauses never overlap.
 */
const notComparedFinding = (
	identity: string,
	message: string,
	next: string,
): Finding => ({
	identity,
	error: hejbroError("check-not-compared", `${message} Next: ${next}`),
});

// The kind node shapes below mirror packages/core/src/kinds/*.ts's own
// snapshot types exactly (table/column/schema/enum aren't part of core's
// public surface -- only decodeExprNode/renderExpr/renderTypeNode are,
// per proposal.md's "Affected code"). Internal invariant, same idiom core
// itself uses for its own asXSnapshot casts.
type LocalColumnSnapshot = {
	readonly name: string;
	readonly typeNode: TypeNode;
	readonly notNull?: true;
	readonly default?: JsonValue;
	readonly uniqueName?: string;
};

type LocalIndexSnapshot = { readonly name: string };
type LocalForeignKeySnapshot = { readonly name: string };
type LocalCheckSnapshot = { readonly name: string };

type LocalTableSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<LocalColumnSnapshot>;
	readonly indexes?: ReadonlyArray<LocalIndexSnapshot>;
	readonly foreignKeys?: ReadonlyArray<LocalForeignKeySnapshot>;
	readonly checks?: ReadonlyArray<LocalCheckSnapshot>;
	readonly primaryKeyName?: string;
	readonly existing?: true;
};

type LocalSchemaSnapshot = { readonly name: string };
type LocalNamedSnapshot = { readonly schema: string; readonly name: string };
type LocalTableScopedSnapshot = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
};
type LocalRlsSnapshot = { readonly schema: string; readonly table: string };
type LocalGrantSnapshot = {
	readonly schema: string;
	readonly grantKind: string;
	readonly role: string;
	readonly privileges: ReadonlyArray<string>;
};

/**
 * The #218 display-correction table (ported from
 * `scripts/check-declared-vs-catalog.mjs`, measured against a real
 * postgres:17): `renderTypeNode` and `format_type()` agree for every
 * simple type except these.
 */
const TYPE_DISPLAY_CORRECTIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[/^time$/, "time without time zone"],
	[/^timestamp$/, "timestamp without time zone"],
	[/^varchar$/, "character varying"],
	[/^varchar\((\d+)\)$/, "character varying($1)"],
	[/^char\((\d+)\)$/, "character($1)"],
	[/^numeric\((\d+)\)$/, "numeric($1,0)"],
];

const applyTypeDisplayCorrection = (rendered: string): string => {
	const correction = TYPE_DISPLAY_CORRECTIONS.find(([pattern]) =>
		pattern.test(rendered),
	);
	if (correction === undefined) {
		return rendered;
	}
	const [pattern, replacement] = correction;
	return rendered.replace(pattern, replacement);
};

/** The catalog's own display spelling `typeNode` should read as -- enum renders as its base type's schema-qualified name, never `renderTypeNode`'s quoted-identifier enum branch (that renders a SQL identifier, not the plain form `catalogTypeDisplay` compares against). */
const expectedCatalogType = (typeNode: TypeNode): string => {
	if (typeNode.typeName === "array") {
		return `${expectedCatalogType(typeNode.element)}[]`;
	}
	if (typeNode.typeName === "enum") {
		return `${typeNode.enumSchema}.${typeNode.enumName}`;
	}
	return applyTypeDisplayCorrection(renderTypeNode(typeNode));
};

/** The catalog row's own type in `expectedCatalogType`'s shape -- `format_type()`'s `catalogType` directly for a built-in type, or the base type's own schema-qualified name (never `format_type()`'s enum spelling, `search_path`-sensitive, measured) when the column is an enum. */
const catalogTypeDisplay = (row: ColumnRow): string => {
	if (
		row.baseTypeKind !== "e" ||
		row.baseTypeSchema === null ||
		row.baseTypeName === null
	) {
		return row.catalogType;
	}
	const qualified = `${row.baseTypeSchema}.${row.baseTypeName}`;
	if (row.catalogType.endsWith("[]")) {
		return `${qualified}[]`;
	}
	return qualified;
};

const WHITESPACE_RUN = /\s+/g;
const normalizeSql = (text: string): string =>
	text.trim().replace(WHITESPACE_RUN, " ");
const escapeForRegExp = (text: string): string =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `catalogText` is `declaredText` plus Postgres's own trailing `::<type>` cast on a literal default (ported, measured -- see the source script's own doc comment for the exact reproduction cases). */
const matchesWithCastSuffix = (
	declaredText: string,
	catalogText: string,
): boolean =>
	new RegExp(
		`^${escapeForRegExp(declaredText)}::[A-Za-z_][A-Za-z0-9_., \\[\\]()]*$`,
	).test(catalogText);

const NUMERIC_LITERAL = /^-?\d+(\.\d+)?$/;

/** True when `catalogText` is a bare numeric literal `declaredText` wrapped in Postgres's own quotes-plus-cast for a negative numeric default (ported, measured). */
const matchesQuotedNumericCast = (
	declaredText: string,
	catalogText: string,
): boolean => {
	if (!NUMERIC_LITERAL.test(declaredText)) {
		return false;
	}
	return new RegExp(
		`^'${escapeForRegExp(declaredText)}'::[A-Za-z_][A-Za-z0-9_., \\[\\]()]*$`,
	).test(catalogText);
};

const defaultsMatch = (declaredText: string, catalogText: string): boolean => {
	const declared = normalizeSql(declaredText);
	const actual = normalizeSql(catalogText);
	if (declared === actual) {
		return true;
	}
	if (matchesWithCastSuffix(declared, actual)) {
		return true;
	}
	return matchesQuotedNumericCast(declared, actual);
};

const declaredDefaultText = (column: LocalColumnSnapshot): string | null => {
	if (column.default === undefined) {
		return null;
	}
	return renderExpr(decodeExprNode(column.default));
};

const compareColumnNotNull = (
	identity: string,
	column: LocalColumnSnapshot,
	row: ColumnRow,
): ReadonlyArray<Finding> => {
	if (column.notNull !== true) {
		return [];
	}
	if (row.notNull) {
		return [];
	}
	return [
		differsFinding(
			identity,
			`declared column "${identity}" is not null, but the database allows null.`,
			"write a migration that adds the not-null constraint, or remove it from the declaration.",
		),
	];
};

const compareColumnType = (
	identity: string,
	column: LocalColumnSnapshot,
	row: ColumnRow,
): ReadonlyArray<Finding> => {
	const expected = expectedCatalogType(column.typeNode);
	const actual = catalogTypeDisplay(row);
	if (expected === actual) {
		return [];
	}
	return [
		differsFinding(
			identity,
			`declared column "${identity}" has type "${expected}", but the database has "${actual}".`,
			"change the declaration to match the database, or write a migration that alters the column to the declared type.",
		),
	];
};

const missingDefaultFinding = (
	identity: string,
	declared: string | null,
	catalogDefault: string | null,
): Finding => {
	if (declared !== null) {
		return differsFinding(
			identity,
			`declared column "${identity}" has a default ("${declared}"), but the database has none.`,
			"write a migration that adds the default, or remove it from the declaration.",
		);
	}
	return differsFinding(
		identity,
		`declared column "${identity}" has no default, but the database has one ("${catalogDefault}").`,
		"add the default to the declaration, or write a migration that drops it.",
	);
};

const compareColumnDefault = (
	identity: string,
	column: LocalColumnSnapshot,
	row: ColumnRow,
): ReadonlyArray<Finding> => {
	const declared = declaredDefaultText(column);
	const catalogDefault = row.catalogDefault;
	if (declared === null && catalogDefault === null) {
		return [];
	}
	if (declared === null || catalogDefault === null) {
		return [missingDefaultFinding(identity, declared, catalogDefault)];
	}
	if (defaultsMatch(declared, catalogDefault)) {
		return [];
	}
	return [
		differsFinding(
			identity,
			`declared column "${identity}" has default "${declared}", but the database has "${catalogDefault}".`,
			"change the declaration to match the database, or write a migration that alters the default.",
		),
	];
};

const findColumnRow = (
	catalog: Catalog,
	schema: string,
	table: string,
	name: string,
): ColumnRow | undefined =>
	catalog.columns.find(
		(row) => row.schema === schema && row.table === table && row.name === name,
	);

const compareColumn = (
	schema: string,
	table: string,
	column: LocalColumnSnapshot,
	catalog: Catalog,
): ReadonlyArray<Finding> => {
	const identity = `${schema}.${table}.${column.name}`;
	const row = findColumnRow(catalog, schema, table, column.name);
	if (row === undefined) {
		return [missingFinding(identity, "column")];
	}
	// Every axis this column differs on is reported from this one run
	// (spec Req1) -- never an early return after the first mismatch, which
	// would make a reader fix one difference, rerun, and meet a second one
	// the tool already knew about.
	return [
		...compareColumnNotNull(identity, column, row),
		...compareColumnType(identity, column, row),
		...compareColumnDefault(identity, column, row),
	];
};

const hasConstraint = (
	catalog: Catalog,
	schema: string,
	table: string,
	type: string,
	name: string,
): boolean =>
	catalog.constraints.some(
		(row) =>
			row.schema === schema &&
			row.table === table &&
			row.type === type &&
			row.name === name,
	);

/** Existence only, by name -- 3.4 compares a check constraint's expression, 3.2 an index's predicate; this only confirms the object itself is there. */
const compareConstraintExistence = (
	schema: string,
	table: string,
	type: string,
	describe: string,
	name: string,
	catalog: Catalog,
): ReadonlyArray<Finding> => {
	const identity = `${schema}.${table}.${name}`;
	if (hasConstraint(catalog, schema, table, type, name)) {
		return [];
	}
	return [missingFinding(identity, describe)];
};

/**
 * The four `pg_constraint` type letters `check` compares by existence
 * only -- a four-row table, not four near-identical wrapper functions
 * whose entire body was one `(type letter, description)` pair passed to
 * {@link compareConstraintExistence} (task 2.6).
 */
type ConstraintKind = "p" | "u" | "f" | "c";

const CONSTRAINT_KIND_DESCRIPTIONS: Readonly<Record<ConstraintKind, string>> = {
	p: "primary key",
	u: "unique constraint",
	f: "foreign key",
	c: "check constraint",
};

/** `[]` for an absent optional name, `[name]` otherwise -- a guard clause, not a ternary (house style), so a single name and a name list feed {@link compareConstraintsByName} the same shape. */
const optionalName = (name: string | undefined): ReadonlyArray<string> => {
	if (name === undefined) {
		return [];
	}
	return [name];
};

const compareConstraintsByName = (
	schema: string,
	table: string,
	type: ConstraintKind,
	names: ReadonlyArray<string>,
	catalog: Catalog,
): ReadonlyArray<Finding> =>
	names.flatMap((name) =>
		compareConstraintExistence(
			schema,
			table,
			type,
			CONSTRAINT_KIND_DESCRIPTIONS[type],
			name,
			catalog,
		),
	);

const compareIndexes = (
	schema: string,
	table: string,
	indexes: ReadonlyArray<LocalIndexSnapshot>,
	catalog: Catalog,
): ReadonlyArray<Finding> =>
	indexes.flatMap((index) => {
		const identity = `${schema}.${table}.${index.name}`;
		const found = catalog.indexes.some(
			(row) =>
				row.schema === schema && row.table === table && row.name === index.name,
		);
		if (found) {
			return [];
		}
		return [missingFinding(identity, "index")];
	});

const compareTable = (
	identity: string,
	node: JsonValue,
	catalog: Catalog,
): ReadonlyArray<Finding> => {
	const table = node as LocalTableSnapshot;
	// add-unmanaged-objects: an existing declaration claims a shape this
	// repository does not own -- comparing that claim against the catalog
	// is a separate, out-of-scope feature (proposal.md), and its
	// presence or absence in the database SHALL NOT affect the exit code
	// (table-declaration delta). Zero comparisons, not just a shape-diff
	// skip: this table is never even looked up in the catalog.
	if (table.existing === true) {
		return [];
	}
	const row = catalog.tables.find(
		(candidate) =>
			candidate.schema === table.schema && candidate.table === table.name,
	);
	if (row === undefined) {
		return [missingFinding(identity, "table")];
	}
	return [
		...table.columns.flatMap((column) =>
			compareColumn(table.schema, table.name, column, catalog),
		),
		...compareConstraintsByName(
			table.schema,
			table.name,
			"p",
			optionalName(table.primaryKeyName),
			catalog,
		),
		...compareConstraintsByName(
			table.schema,
			table.name,
			"u",
			table.columns.flatMap((column) => optionalName(column.uniqueName)),
			catalog,
		),
		...compareConstraintsByName(
			table.schema,
			table.name,
			"f",
			(table.foreignKeys ?? []).map((foreignKey) => foreignKey.name),
			catalog,
		),
		...compareConstraintsByName(
			table.schema,
			table.name,
			"c",
			(table.checks ?? []).map((check) => check.name),
			catalog,
		),
		...compareIndexes(table.schema, table.name, table.indexes ?? [], catalog),
	];
};

const compareSchema = (
	identity: string,
	node: JsonValue,
	catalog: Catalog,
): ReadonlyArray<Finding> => {
	const target = node as LocalSchemaSnapshot;
	const found = catalog.schemas.some((row) => row.schema === target.name);
	if (found) {
		return [];
	}
	return [missingFinding(identity, "schema")];
};

const compareNamedExistence = (
	identity: string,
	node: JsonValue,
	describe: string,
	rows: ReadonlyArray<{ readonly schema: string; readonly name: string }>,
): ReadonlyArray<Finding> => {
	const target = node as LocalNamedSnapshot;
	const found = rows.some(
		(row) => row.schema === target.schema && row.name === target.name,
	);
	if (found) {
		return [];
	}
	return [missingFinding(identity, describe)];
};

const compareTableScopedExistence = (
	identity: string,
	node: JsonValue,
	describe: string,
	rows: ReadonlyArray<{
		readonly schema: string;
		readonly table: string;
		readonly name: string;
	}>,
): ReadonlyArray<Finding> => {
	const target = node as LocalTableScopedSnapshot;
	const found = rows.some(
		(row) =>
			row.schema === target.schema &&
			row.table === target.table &&
			row.name === target.name,
	);
	if (found) {
		return [];
	}
	return [missingFinding(identity, describe)];
};

const compareRls = (
	identity: string,
	node: JsonValue,
	catalog: Catalog,
): ReadonlyArray<Finding> => {
	const target = node as LocalRlsSnapshot;
	const row = catalog.tables.find(
		(candidate) =>
			candidate.schema === target.schema && candidate.table === target.table,
	);
	if (row === undefined) {
		return [missingFinding(identity, "row-level security")];
	}
	if (row.rls) {
		return [];
	}
	return [
		differsFinding(
			identity,
			`declared row-level security on "${identity}" is not enabled in the database.`,
			"write a migration that runs `alter table ... enable row level security`, or remove the declaration.",
		),
	];
};

const hasSchemaUsage = (
	catalog: Catalog,
	schema: string,
	role: string,
): boolean =>
	catalog.schemaUsageGrants.some(
		(grant) =>
			grant.schema === schema &&
			grant.role === role &&
			grant.privilege === "USAGE",
	);

const hasTableGrant = (
	catalog: Catalog,
	schema: string,
	table: string,
	role: string,
	privilege: string,
): boolean =>
	catalog.tableGrants.some(
		(grant) =>
			grant.schema === schema &&
			grant.table === table &&
			grant.role === role &&
			grant.privilege === privilege,
	);

const hasDefaultTableGrant = (
	catalog: Catalog,
	schema: string,
	role: string,
	privilege: string,
): boolean =>
	catalog.defaultTableGrants.some(
		(grant) =>
			grant.schema === schema &&
			grant.role === role &&
			grant.privilege === privilege,
	);

const compareSchemaUsageGrant = (
	identity: string,
	schema: string,
	role: string,
	catalog: Catalog,
): ReadonlyArray<Finding> => {
	if (hasSchemaUsage(catalog, schema, role)) {
		return [];
	}
	return [missingFinding(identity, "grant")];
};

/**
 * Every table name a `table:` snapshot entry declares in `schema` --
 * `compareAllTablesPrivilegesGrant`'s own universe (spec: "compared
 * against the tables the declarations cover, not against every table the
 * schema happens to contain"). A table hejbro never declared is
 * inventory (5.1), not a finding: hejbro cannot emit a migration for it,
 * and `grant ... on all tables in schema` never covered it either --
 * that clause is a run-time snapshot (#121), not a standing rule.
 */
const declaredTableNames = (
	snapshot: Snapshot,
	schema: string,
): ReadonlySet<string> =>
	new Set(
		Object.entries(snapshot.objects)
			.filter(([key]) => kindOfKey(key) === "table")
			.map(([, node]) => node as LocalTableSnapshot)
			.filter((table) => table.schema === schema)
			.map((table) => table.name),
	);

const compareAllTablesPrivilegesGrant = (
	identity: string,
	schema: string,
	role: string,
	privileges: ReadonlyArray<string>,
	catalog: Catalog,
	snapshot: Snapshot,
): ReadonlyArray<Finding> => {
	const declaredNames = declaredTableNames(snapshot, schema);
	const tablesInSchema = catalog.tables.filter(
		(row) => row.schema === schema && declaredNames.has(row.table),
	);
	const gaps = tablesInSchema.flatMap((row) =>
		privileges
			.filter(
				(privilege) =>
					!hasTableGrant(catalog, schema, row.table, role, privilege),
			)
			.map((privilege) => `${row.table}:${privilege}`),
	);
	if (gaps.length === 0) {
		return [];
	}
	return [
		differsFinding(
			identity,
			`declared grant "${identity}" is missing on ${gaps.join(", ")} in the database.`,
			"write a migration that grants the missing privileges, or remove them from the declaration.",
		),
	];
};

const compareDefaultTablePrivilegesGrant = (
	identity: string,
	schema: string,
	role: string,
	privileges: ReadonlyArray<string>,
	catalog: Catalog,
): ReadonlyArray<Finding> => {
	const missingPrivileges = privileges.filter(
		(privilege) => !hasDefaultTableGrant(catalog, schema, role, privilege),
	);
	if (missingPrivileges.length === 0) {
		return [];
	}
	return [missingFinding(identity, "grant")];
};

const compareGrant = (
	identity: string,
	node: JsonValue,
	catalog: Catalog,
	snapshot: Snapshot,
): ReadonlyArray<Finding> => {
	const grant = node as LocalGrantSnapshot;
	const privileges = grant.privileges.map((privilege) =>
		privilege.toUpperCase(),
	);
	if (grant.grantKind === "schema-usage") {
		return compareSchemaUsageGrant(identity, grant.schema, grant.role, catalog);
	}
	if (grant.grantKind === "all-tables-privileges") {
		return compareAllTablesPrivilegesGrant(
			identity,
			grant.schema,
			grant.role,
			privileges,
			catalog,
			snapshot,
		);
	}
	return compareDefaultTablePrivilegesGrant(
		identity,
		grant.schema,
		grant.role,
		privileges,
		catalog,
	);
};

type Comparator = (
	identity: string,
	node: JsonValue,
	catalog: Catalog,
	snapshot: Snapshot,
) => ReadonlyArray<Finding>;

/**
 * Every declared kind this command compares. `table` also compares its
 * columns and, since 2.5, every declared table sub-object (primary key,
 * unique constraints, foreign keys, check constraints, indexes) by
 * existence -- see `compareTable`. A check constraint's own *expression*
 * and enforcement are group 3's (`expression.ts`), which only ever runs
 * against a constraint this comparator already found to exist (never a
 * second existence check of its own).
 */
const KIND_COMPARATORS: Readonly<Record<string, Comparator>> = {
	schema: compareSchema,
	table: compareTable,
	enum: (identity, node, catalog) =>
		compareNamedExistence(identity, node, "enum", catalog.enums),
	sequence: (identity, node, catalog) =>
		compareNamedExistence(identity, node, "sequence", catalog.sequences),
	function: (identity, node, catalog) =>
		compareNamedExistence(identity, node, "function", catalog.functions),
	view: (identity, node, catalog) =>
		compareNamedExistence(identity, node, "view", catalog.views),
	policy: (identity, node, catalog) =>
		compareTableScopedExistence(identity, node, "policy", catalog.policies),
	trigger: (identity, node, catalog) =>
		compareTableScopedExistence(identity, node, "trigger", catalog.triggers),
	rls: compareRls,
	grant: compareGrant,
};

const kindOfKey = (key: string): string => key.slice(0, key.indexOf(":"));
const identityOfKey = (key: string): string => key.slice(key.indexOf(":") + 1);

/** Every registered kind, by name -- built once per `compareCatalog` call, never per entry, so a large declaration set doesn't re-derive this on every object. */
type KindLookup = ReadonlyMap<string, RegisteredObjectKind>;

const kindLookupOf = (registry: KindRegistry): KindLookup =>
	new Map(registry.list().map((kind) => [kind.kind, kind]));

const compareEntry = (
	key: string,
	node: JsonValue,
	catalog: Catalog,
	snapshot: Snapshot,
	kinds: KindLookup,
): ReadonlyArray<Finding> => {
	const kind = kindOfKey(key);
	const identity = identityOfKey(key);
	// #482: a kind that declares it has no catalog object, ever, is
	// compared against nothing -- `check` states this in its own
	// coverage-boundary section (renderCheckReport) instead, and this is
	// not a `Finding` at all: not a difference, and not a
	// `check-not-compared` either (that code names a comparison that
	// *should* have run and could not; this kind states none ever could).
	if (kinds.get(kind)?.noCatalogObjectReason !== undefined) {
		return [];
	}
	const comparator = KIND_COMPARATORS[kind];
	if (comparator === undefined) {
		// #482: an unregistered kind was never actually compared -- stating
		// it as a difference would be a false claim about a comparison that
		// never ran. `check-not-compared` (not `check-object-differs`)
		// keeps the exit code from ever reading `0` for a run that skipped
		// this object, without claiming the database disagrees.
		return [
			notComparedFinding(
				identity,
				`declared object "${key}" has an unrecognized kind "${kind}" and could not be compared.`,
				"check for a typo in the declaration, or update hejbro if this is a new kind.",
			),
		];
	}
	return comparator(identity, node, catalog, snapshot);
};

/**
 * Compares a declared snapshot against a live database's catalog,
 * object by object -- pure, no I/O (group 1's `readCatalog` already ran).
 * Refuses an empty declaration set outright (spec: "every comparison
 * would be vacuous, which is never a real pass") rather than reporting a
 * vacuous "no differences". `registry` (#482, task 2.3) is optional and
 * additive, the same pattern as `ObjectKind`'s own optional members --
 * defaults to the core-only registry, so a caller (test or otherwise)
 * that never registers a preset kind sees no behavior change. A caller
 * that forgets to pass its real registry does not silently drop a
 * preset kind's objects from the report either (task 2.4): every one of
 * them falls to the unregistered-kind path, `check-not-compared`, which
 * forbids exit `0` -- a forgotten argument surfaces loudly as "could not
 * answer", never as a clean pass that skipped something.
 */
export const compareCatalog = (
	snapshot: Snapshot,
	catalog: Catalog,
	registry: KindRegistry = createDefaultRegistry(),
): ReadonlyArray<Finding> => {
	const entries = Object.entries(snapshot.objects);
	if (entries.length === 0) {
		return throwHejbroError(
			"check-declarations-empty",
			"hejbro check received a declaration set with 0 declared objects -- every comparison would be vacuous, which is never a real pass. Next: confirm the entry pattern in hejbro.config.ts matches real declaration files that export table()/schema()/... declarations.",
		);
	}
	const kinds = kindLookupOf(registry);
	return entries.flatMap(([key, node]) =>
		compareEntry(key, node, catalog, snapshot, kinds),
	);
};

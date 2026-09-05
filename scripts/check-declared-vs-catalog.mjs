#!/usr/bin/env node
// #212: an execution harness (scripts/roundtrip.sh, scripts/
// verify-supabase-image.sh) that only asks "did the generated SQL run
// without error?" can never catch a statement that was silently never
// emitted -- there was nothing to fail. #209's missing `add primary key`
// (dev@626c57f, the sequence-lifecycle golden case's step 6: a dropped
// primary-key column got re-added, but the emitted SQL never re-added its
// constraint) ran clean on real Postgres and only #202's own guard caught
// it later, by coincidence. This script is the missing half: after a
// harness has applied its migrations to a real database, it reads that
// same run's own `hejbro.snapshot.json` -- never the emitted SQL, which is
// exactly what the golden case shows can be silently incomplete -- and
// checks every object it declares actually exists in that database's
// catalog.
//
// Usage: node scripts/check-declared-vs-catalog.mjs <container> <database> <snapshot-path>
//
// What this DOES check, per declared object: existence, by identity
// (schema/table/column/constraint/index/policy/trigger/view/function/
// sequence name, or schema+role+privilege-word for a grant) -- plus, for
// columns specifically, whether `notNull` matches the catalog's
// `attnotnull`, whether the declared type matches the catalog's own type
// (#218), and whether a declared default expression matches the
// catalog's own default expression (#218).
//
// #218's type comparison: `column.typeNode`, rendered through
// `@hejbro/core`'s own `renderTypeNode` (the exact function that produced
// the emitted SQL), then corrected onto the catalog's own display
// spelling per the mapping table this script's own PR body records
// (measured, not assumed -- `format_type()` and `renderTypeNode()` agree
// for most of the twenty-one simple types, and disagree in a small,
// specific set: `time`/`timestamp` spell out "without time zone",
// `varchar`/`char` use their long-form names, and a precision-only
// `numeric(p)` gets an explicit `,0` scale). An enum column is compared
// by its base type's own schema-qualified name (`pg_type`/`pg_namespace`,
// resolved through `pg_type.typelem` when the column is an array of
// enums), never `format_type()`'s own enum spelling -- that string is
// session `search_path`-sensitive (measured: the same column reads
// "app.status" or bare "status" depending on what's on `search_path`),
// so it isn't a stable comparison target on its own.
//
// #218's default comparison: the declared default (a structured
// expression node, decoded and rendered the same way `@hejbro/core`
// itself would) against `pg_get_expr(adbin, adrelid)`. Compared after
// minimal, *measured* normalization only (trimming/collapsing
// whitespace, stripping a trailing `::<type>` cast Postgres adds to a
// literal default that `renderExpr` itself never emits, and -- numeric
// literals only -- also stripping a wrapping `'...'` Postgres adds
// around a *negative* numeric literal, e.g. `.default(-1)` reading back
// as `'-1'::integer`) -- never a blanket case-fold, which risked
// silently accepting a genuinely wrong string literal's content as a
// false negative with no concrete DSL-reachable case-divergent scenario
// found to justify it.
//
// What this still DOES NOT check (deliberately out of scope, honest
// non-comparison over a guessed rule that might misfire either
// direction): an index's declared column list or expression, a check
// constraint's declared expression, a function's/view's declared body, a
// trigger's declared timing/event beyond its name.
//
// A known false-gap risk in the default comparison, not a "does not
// check": a *compound* expression default (anything beyond a single
// literal or a bare function call -- e.g. `sql`'a' || 'b'`` ``) can have
// Postgres rewrite it with a per-operand cast on write (measured:
// `('a' || 'b')` comes back as `('a'::text || 'b'::text)`) -- this
// check's own cast-stripping only ever strips one trailing cast on the
// *whole* value (see matchesWithCastSuffix), not a cast Postgres
// inserted *inside* a multi-operand expression, so a column default
// like this can report a false gap. Not normalized away: the general
// rule ("Postgres may rewrite an expression's own internals on write")
// is exactly the kind of guess this script's own default-comparison
// doc comment above already declined to make for case-folding, for the
// same reason -- a real rewrite this narrow regex can't anticipate the
// exact shape of.
//
// `supabase-storage-bucket` (the one preset-only kind, `@hejbro/
// supabase`) is skipped entirely, same as verify-supabase-image.sh's own
// skip_storage_kind: storage.buckets is a row in a table the Storage API
// service owns, not this Postgres image's own migrations, so there is no
// catalog object for this script to check it against.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	decodeExprNode,
	renderExpr,
	renderTypeNode,
} from "../packages/core/dist/index.js";

const [, , container, database, snapshotPath] = process.argv;

if (!container || !database || !snapshotPath) {
	console.error(
		"usage: node scripts/check-declared-vs-catalog.mjs <container> <database> <snapshot-path>",
	);
	process.exit(2);
}

const runPsqlJson = (query) => {
	const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${query}) t;`;
	const stdout = execFileSync(
		"docker",
		[
			"exec",
			container,
			"psql",
			"-U",
			"postgres",
			"-d",
			database,
			"-v",
			"ON_ERROR_STOP=1",
			"-Atq",
			"-c",
			wrapped,
		],
		{ encoding: "utf8" },
	).trim();
	if (stdout === "") {
		return [];
	}
	return JSON.parse(stdout);
};

// One query per catalog concern. No snapshot-derived value is ever
// interpolated into any of these -- each fetches its entire inventory
// unfiltered, and the declared-vs-catalog comparison below is done in
// JS -- so there is no identifier/literal-escaping concern to get wrong.
const catalog = {
	schemas: runPsqlJson(`select nspname as schema from pg_namespace`),
	tables: runPsqlJson(`
		select n.nspname as schema, c.relname as name, c.relrowsecurity as rls
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where c.relkind in ('r','p')
	`),
	// #218: "catalogType" is format_type()'s own display string --
	// search-path-independent for every built-in type, but NOT for an
	// enum's own name (measured: the same enum column reads "app.status"
	// or bare "status" depending on what's on search_path). "baseTypeKind"/
	// "baseTypeSchema"/"baseTypeName" resolve the column's *scalar* type
	// regardless of whether it's wrapped in an array (pg_type.typcategory
	// = 'A' unwraps through typelem) -- 'e' means enum, and the schema/name
	// pair is this script's own, session-independent way to identify one,
	// used instead of trusting catalogType's enum spelling. "catalogDefault"
	// is pg_get_expr() over the column's own pg_attrdef row, null when the
	// column has none.
	columns: runPsqlJson(`
		select n.nspname as schema, c.relname as "table", a.attname as name,
			a.attnotnull as "notNull",
			format_type(a.atttypid, a.atttypmod) as "catalogType",
			bt.typtype as "baseTypeKind",
			btn.nspname as "baseTypeSchema",
			bt.typname as "baseTypeName",
			pg_get_expr(ad.adbin, ad.adrelid) as "catalogDefault"
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		join pg_attribute a on a.attrelid = c.oid
		join pg_type t on t.oid = a.atttypid
		left join pg_type bt
			on bt.oid = (case when t.typcategory = 'A' then t.typelem else t.oid end)
		left join pg_namespace btn on btn.oid = bt.typnamespace
		left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
		where c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped
	`),
	constraints: runPsqlJson(`
		select n.nspname as schema, c.relname as "table", con.conname as name,
			con.contype as type,
			coalesce((
				select json_agg(att.attname order by ord.n)
				from unnest(con.conkey) with ordinality as ord(attnum, n)
				join pg_attribute att
					on att.attrelid = con.conrelid and att.attnum = ord.attnum
			), '[]'::json) as columns
		from pg_constraint con
		join pg_class c on c.oid = con.conrelid
		join pg_namespace n on n.oid = c.relnamespace
		where con.contype in ('p','u','f','c')
	`),
	indexes: runPsqlJson(`
		select n.nspname as schema, c.relname as "table", ic.relname as name
		from pg_index ix
		join pg_class c on c.oid = ix.indrelid
		join pg_class ic on ic.oid = ix.indexrelid
		join pg_namespace n on n.oid = c.relnamespace
	`),
	enums: runPsqlJson(`
		select n.nspname as schema, t.typname as name
		from pg_type t
		join pg_namespace n on n.oid = t.typnamespace
		where t.typtype = 'e'
	`),
	sequences: runPsqlJson(`
		select n.nspname as schema, c.relname as name
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where c.relkind = 'S'
	`),
	functions: runPsqlJson(`
		select n.nspname as schema, p.proname as name
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
	`),
	views: runPsqlJson(`
		select n.nspname as schema, c.relname as name
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where c.relkind in ('v','m')
	`),
	policies: runPsqlJson(`
		select schemaname as schema, tablename as "table", policyname as name
		from pg_policies
	`),
	triggers: runPsqlJson(`
		select n.nspname as schema, c.relname as "table", t.tgname as name
		from pg_trigger t
		join pg_class c on c.oid = t.tgrelid
		join pg_namespace n on n.oid = c.relnamespace
		where not t.tgisinternal
	`),
	tableGrants: runPsqlJson(`
		select table_schema as schema, table_name as "table", grantee as role,
			privilege_type as privilege
		from information_schema.role_table_grants
	`),
	schemaUsage: runPsqlJson(`
		select n.nspname as schema,
			case when g.grantee = 0 then 'public' else g.grantee::regrole::text end as role,
			g.privilege_type as privilege
		from pg_namespace n
		cross join lateral aclexplode(n.nspacl) as g
	`),
	defaultTableGrants: runPsqlJson(`
		select n.nspname as schema,
			case when g.grantee = 0 then 'public' else g.grantee::regrole::text end as role,
			g.privilege_type as privilege
		from pg_default_acl d
		join pg_namespace n on n.oid = d.defaclnamespace
		cross join lateral aclexplode(d.defaclacl) as g
		where d.defaclobjtype = 'r'
	`),
};

// The one recurring shape every check below reduces to: "is this declared
// thing present?" -- present, no gap; absent, exactly one gap message.
// Centralized so no individual check spells its own `cond ? [] : [msg]`.
const missing = (found, message) => {
	if (found) {
		return [];
	}
	return [message];
};

const findTable = (schema, table) =>
	catalog.tables.find((t) => t.schema === schema && t.name === table);

const findColumn = (schema, table, name) =>
	catalog.columns.find(
		(c) => c.schema === schema && c.table === table && c.name === name,
	);

const findConstraint = (schema, table, type, predicate) =>
	catalog.constraints.find(
		(c) =>
			c.schema === schema &&
			c.table === table &&
			c.type === type &&
			predicate(c),
	);

const findIndex = (schema, table, name) =>
	catalog.indexes.find(
		(i) => i.schema === schema && i.table === table && i.name === name,
	);

const hasTableGrant = (schema, table, role, privilege) =>
	catalog.tableGrants.some(
		(g) =>
			g.schema === schema &&
			g.table === table &&
			g.role === role &&
			g.privilege === privilege,
	);

const hasSchemaUsage = (schema, role) =>
	catalog.schemaUsage.some(
		(g) => g.schema === schema && g.role === role && g.privilege === "USAGE",
	);

const hasDefaultTableGrant = (schema, role, privilege) =>
	catalog.defaultTableGrants.some(
		(g) => g.schema === schema && g.role === role && g.privilege === privilege,
	);

// #218 type-mapping table (measured against a real postgres:17 -- see this
// script's own PR body for the full per-typeName table this corrects
// against): renderTypeNode() and format_type() agree for every simple
// type except these. `numeric(p)` (precision given, scale omitted) is
// the one case handled by regex rather than a literal substring, since
// its corrected form still carries the caller's own precision digits.
const TYPE_DISPLAY_CORRECTIONS = [
	[/^time$/, "time without time zone"],
	[/^timestamp$/, "timestamp without time zone"],
	[/^varchar$/, "character varying"],
	[/^varchar\((\d+)\)$/, "character varying($1)"],
	[/^char\((\d+)\)$/, "character($1)"],
	[/^numeric\((\d+)\)$/, "numeric($1,0)"],
];

/**
 * The catalog's own display spelling for `typeNode`, mirroring
 * `@hejbro/core`'s `renderTypeNode` (the exact function that rendered
 * the emitted `create`/`alter` SQL) with the #218 correction table
 * applied. `enum` renders schema-qualified (`schema.name`) directly from
 * the node's own fields -- never through `renderTypeNode`, whose enum
 * branch renders an *identifier* (quoted where needed for SQL), not the
 * plain, unquoted form `catalogTypeDisplay` below compares against.
 */
const expectedCatalogType = (typeNode) => {
	if (typeNode.typeName === "array") {
		return `${expectedCatalogType(typeNode.element)}[]`;
	}
	if (typeNode.typeName === "enum") {
		return `${typeNode.enumSchema}.${typeNode.enumName}`;
	}
	const rendered = renderTypeNode(typeNode);
	const correction = TYPE_DISPLAY_CORRECTIONS.find(([pattern]) =>
		pattern.test(rendered),
	);
	if (correction === undefined) {
		return rendered;
	}
	const [pattern, replacement] = correction;
	return rendered.replace(pattern, replacement);
};

/**
 * The catalog row's own type, in the same shape `expectedCatalogType`
 * produces -- `format_type()` directly for a built-in base type, or the
 * base type's own schema-qualified name (never `format_type()`'s enum
 * spelling, which is session `search_path`-sensitive, measured) when the
 * column (or its array's element) is an enum.
 */
const catalogTypeDisplay = (row) => {
	if (row.baseTypeKind !== "e") {
		return row.catalogType;
	}
	const qualified = `${row.baseTypeSchema}.${row.baseTypeName}`;
	if (row.catalogType.endsWith("[]")) {
		return `${qualified}[]`;
	}
	return qualified;
};

const columnTypeGap = (schema, table, column, row) => {
	const expected = expectedCatalogType(column.typeNode);
	const actual = catalogTypeDisplay(row);
	return missing(
		expected === actual,
		`declared column "${schema}.${table}.${column.name}" has type "${expected}", but the catalog shows "${actual}"`,
	);
};

const WHITESPACE_RUN = /\s+/g;
const normalizeSql = (text) => text.trim().replace(WHITESPACE_RUN, " ");

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when `catalogText` is exactly `declaredText` plus Postgres's own
 * trailing `::<type>` cast on a literal default -- measured directly
 * (`'member'::text`, `'foo'::character varying`, `'a'::app.status`, even
 * `'foo'::bpchar` for a `char` column, whose cast target doesn't match
 * that same column's own `format_type()` spelling at all). `renderExpr`
 * never emits this cast itself (`renderLiteral`'s string case renders
 * bare `'member'`), so it's always Postgres's own addition, safe to
 * strip without separately validating the cast's own spelling -- a wrong
 * *type* is already caught by `columnTypeGap`, independently. The cast
 * target's own character class also allows `[`/`]`/`(`/`)`/`,` -- measured
 * for the brackets: an array-column literal default casts to its own
 * array type (`'{}'::text[]`, `'{1.5,2.5}'::numeric[]`), and those
 * brackets are the array-cast's own syntax, not a value this check
 * re-validates (a wrong element type is still `columnTypeGap`'s job).
 * Parens/comma widen the same way for a parameterized cast target
 * (e.g. `numeric(10,2)`) if Postgres ever emits one on a literal default
 * -- not reproduced directly (every numeric literal measured either
 * needed no cast at all or cast to bare `numeric`, see this PR's own
 * body), kept as defensive width for a shape this check should not
 * false-gap on if it does occur, at no cost: nothing about the
 * surrounding anchors changes, and a wrong type is still independently
 * caught by `columnTypeGap`.
 */
const matchesWithCastSuffix = (declaredText, catalogText) =>
	new RegExp(
		`^${escapeForRegExp(declaredText)}::[A-Za-z_][A-Za-z0-9_., \\[\\]()]*$`,
	).test(catalogText);

const NUMERIC_LITERAL = /^-?\d+(\.\d+)?$/;

/**
 * True when `catalogText` is `declaredText` -- a bare numeric literal,
 * matched only when it has that exact shape -- wrapped in single quotes
 * plus Postgres's own trailing `::<type>` cast. Measured directly:
 * `.default(-1)` on an `integer` column reads back as `'-1'::integer`;
 * `.default(-1.5)` on `numeric` reads back as `'-1.5'::numeric`. A
 * *positive* literal default doesn't get this treatment (`.default(1)`
 * stays bare `1` in the catalog too), so this only ever fires for a
 * negative (or otherwise unusual) numeric default. Restricted to a
 * numeric-literal-shaped `declaredText` on purpose: `renderExpr` always
 * quotes a *string* literal already (`'member'`), so a string default
 * never reaches this branch to begin with, and widening the match
 * beyond digits/sign/decimal-point would risk a false match like
 * `'abc'::text` against some other bare, unquoted declared text that
 * was never the case this needed to cover.
 */
const matchesQuotedNumericCast = (declaredText, catalogText) => {
	if (!NUMERIC_LITERAL.test(declaredText)) {
		return false;
	}
	return new RegExp(
		`^'${escapeForRegExp(declaredText)}'::[A-Za-z_][A-Za-z0-9_., \\[\\]()]*$`,
	).test(catalogText);
};

const defaultsMatch = (declaredText, catalogText) => {
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

const columnDefaultGap = (schema, table, column, row) => {
	const hasDeclaredDefault = column.default !== undefined;
	const hasCatalogDefault =
		row.catalogDefault !== null && row.catalogDefault !== undefined;
	if (!hasDeclaredDefault && !hasCatalogDefault) {
		return [];
	}
	if (hasDeclaredDefault && !hasCatalogDefault) {
		return [
			`declared column "${schema}.${table}.${column.name}" has a default in the declaration, but the catalog has none`,
		];
	}
	if (!hasDeclaredDefault && hasCatalogDefault) {
		return [
			`declared column "${schema}.${table}.${column.name}" has no default in the declaration, but the catalog has one ("${row.catalogDefault}")`,
		];
	}
	const declaredText = renderExpr(decodeExprNode(column.default));
	return missing(
		defaultsMatch(declaredText, row.catalogDefault),
		`declared column "${schema}.${table}.${column.name}" default "${declaredText}" does not match the catalog's default "${row.catalogDefault}"`,
	);
};

const columnGap = (schema, table, column) => {
	const row = findColumn(schema, table, column.name);
	if (!row) {
		return [
			`declared column "${schema}.${table}.${column.name}" not found in catalog`,
		];
	}
	if (column.notNull === true && row.notNull !== true) {
		return [
			`declared column "${schema}.${table}.${column.name}" is nullable in catalog, but declared not null`,
		];
	}
	return [
		...columnTypeGap(schema, table, column, row),
		...columnDefaultGap(schema, table, column, row),
	];
};

const primaryKeyGap = (schema, table, columns) => {
	const declaresPrimaryKey = (columns ?? []).some((c) => c.primaryKey === true);
	if (!declaresPrimaryKey) {
		return [];
	}
	return missing(
		findConstraint(schema, table, "p", () => true) !== undefined,
		`declared primary key on "${schema}.${table}" not found in catalog`,
	);
};

const uniqueGap = (schema, table, column) => {
	if (column.unique !== true) {
		return [];
	}
	const found = findConstraint(
		schema,
		table,
		"u",
		(c) => c.columns.length === 1 && c.columns[0] === column.name,
	);
	return missing(
		found !== undefined,
		`declared unique constraint on "${schema}.${table}.${column.name}" not found in catalog`,
	);
};

const foreignKeyGap = (schema, table, fk) =>
	missing(
		findConstraint(schema, table, "f", (c) => c.name === fk.name) !== undefined,
		`declared foreign key "${fk.name}" on "${schema}.${table}" not found in catalog`,
	);

const checkConstraintGap = (schema, table, chk) =>
	missing(
		findConstraint(schema, table, "c", (c) => c.name === chk.name) !==
			undefined,
		`declared check constraint "${chk.name}" on "${schema}.${table}" not found in catalog`,
	);

const indexGap = (schema, table, idx) =>
	missing(
		findIndex(schema, table, idx.name) !== undefined,
		`declared index "${idx.name}" on "${schema}.${table}" not found in catalog`,
	);

const checkTable = (schema, name, node) => {
	const table = findTable(schema, name);
	if (!table) {
		return [`declared table "${schema}.${name}" not found in catalog`];
	}
	const columns = node.columns ?? [];
	const columnGaps = columns.flatMap((column) =>
		columnGap(schema, name, column),
	);
	const uniqueGaps = columns.flatMap((column) =>
		uniqueGap(schema, name, column),
	);
	const foreignKeyGaps = (node.foreignKeys ?? []).flatMap((fk) =>
		foreignKeyGap(schema, name, fk),
	);
	const checkGaps = (node.checks ?? []).flatMap((chk) =>
		checkConstraintGap(schema, name, chk),
	);
	const indexGaps = (node.indexes ?? []).flatMap((idx) =>
		indexGap(schema, name, idx),
	);
	return [
		...columnGaps,
		...primaryKeyGap(schema, name, columns),
		...uniqueGaps,
		...foreignKeyGaps,
		...checkGaps,
		...indexGaps,
	];
};

const schemaUsageGap = (schema, node) =>
	missing(
		hasSchemaUsage(schema, node.role),
		`declared schema-usage grant to "${node.role}" on schema "${schema}" not found in catalog`,
	);

const allTablesPrivilegesGap = (schema, node, privileges) => {
	const tablesInSchema = catalog.tables.filter((t) => t.schema === schema);
	return tablesInSchema.flatMap((t) =>
		privileges.flatMap((privilege) =>
			missing(
				hasTableGrant(schema, t.name, node.role, privilege),
				`declared all-tables-privileges grant (${privilege.toLowerCase()}) to "${node.role}" on schema "${schema}": table "${schema}.${t.name}" is missing that privilege in catalog`,
			),
		),
	);
};

const defaultTablePrivilegesGap = (schema, node, privileges) =>
	privileges.flatMap((privilege) =>
		missing(
			hasDefaultTableGrant(schema, node.role, privilege),
			`declared default-table-privileges grant (${privilege.toLowerCase()}) to "${node.role}" on schema "${schema}" not found in catalog`,
		),
	);

const checkGrant = (schema, node) => {
	const privileges = (node.privileges ?? []).map((p) => p.toUpperCase());
	if (node.grantKind === "schema-usage") {
		return schemaUsageGap(schema, node);
	}
	if (node.grantKind === "all-tables-privileges") {
		return allTablesPrivilegesGap(schema, node, privileges);
	}
	if (node.grantKind === "default-table-privileges") {
		return defaultTablePrivilegesGap(schema, node, privileges);
	}
	return [`declared grant has unknown grantKind "${node.grantKind}"`];
};

const checkRls = (schema, table) => {
	const found = findTable(schema, table);
	if (!found) {
		return [
			`declared row-level security on "${schema}.${table}" not found in catalog (table missing)`,
		];
	}
	return missing(
		found.rls === true,
		`declared row-level security on "${schema}.${table}" is not enabled in catalog`,
	);
};

const checkObject = (kind, identity, node) => {
	switch (kind) {
		case "schema":
			return missing(
				catalog.schemas.some((s) => s.schema === node.name),
				`declared schema "${node.name}" not found in catalog`,
			);
		case "table":
			// #674: a table declared with `existingTable()` is owned by the
			// platform, not by this chain -- the migrations never create it,
			// and `hejbro check`'s own coverage rule keeps its presence or
			// absence out of the exit code. Presence is still asserted here
			// (the seed must provide it, or every FK onto it is vacuous);
			// its columns are the declaration's own reading of a shape it
			// does not manage, so they are not compared against the seed.
			if (node.existing === true) {
				console.log(
					`check-declared-vs-catalog: skip: "${node.schema}.${node.name}" is declared with existingTable() -- presence checked, columns not compared (platform-owned)`,
				);
				return missing(
					findTable(node.schema, node.name) !== undefined,
					`declared existing table "${node.schema}.${node.name}" not found in catalog -- the seed must create it`,
				);
			}
			return checkTable(node.schema, node.name, node);
		case "enum":
			return missing(
				catalog.enums.some(
					(e) => e.schema === node.schema && e.name === node.name,
				),
				`declared enum "${node.schema}.${node.name}" not found in catalog`,
			);
		case "sequence":
			return missing(
				catalog.sequences.some(
					(s) => s.schema === node.schema && s.name === node.name,
				),
				`declared sequence "${node.schema}.${node.name}" not found in catalog`,
			);
		case "function":
			return missing(
				catalog.functions.some(
					(f) => f.schema === node.schema && f.name === node.name,
				),
				`declared function "${node.schema}.${node.name}" not found in catalog`,
			);
		case "view":
			return missing(
				catalog.views.some(
					(v) => v.schema === node.schema && v.name === node.name,
				),
				`declared view "${node.schema}.${node.name}" not found in catalog`,
			);
		case "policy":
			return missing(
				catalog.policies.some(
					(p) =>
						p.schema === node.schema &&
						p.table === node.table &&
						p.name === node.name,
				),
				`declared policy "${node.name}" on "${node.schema}.${node.table}" not found in catalog`,
			);
		case "trigger":
			return missing(
				catalog.triggers.some(
					(t) =>
						t.schema === node.schema &&
						t.table === node.table &&
						t.name === node.name,
				),
				`declared trigger "${node.name}" on "${node.schema}.${node.table}" not found in catalog`,
			);
		case "rls":
			return checkRls(node.schema, node.table);
		case "grant":
			return checkGrant(node.schema, node);
		case "supabase-storage-bucket":
			return [];
		default:
			return [`declared object "${kind}:${identity}" has an unrecognized kind`];
	}
};

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const entries = Object.entries(snapshot.objects ?? {});

// A snapshot that declares nothing would otherwise "pass" vacuously --
// every check below is declared-object-driven, so zero declared objects
// means zero gaps can ever be reported, even against a catalog missing
// every table this project actually needs. That is never a real green
// result; it is almost always the wrong file path. Refusing loudly
// (exit 2, distinct from a real gap's exit 1) instead of reporting
// "0 gaps" -- reproduced directly with a `{"objects":{}}` snapshot file.
if (entries.length === 0) {
	console.error(
		`check-declared-vs-catalog: ${snapshotPath} declares 0 objects -- refusing to report "0 gaps" against an empty declared set (that would trivially pass no matter what the catalog is missing). Next: confirm ${snapshotPath} is the real, populated snapshot for this run, not an empty or wrong-path one.`,
	);
	process.exit(2);
}

console.log(
	`check-declared-vs-catalog: comparing ${entries.length} declared object(s) in ${snapshotPath} against ${container}/${database}`,
);
console.log(
	"check-declared-vs-catalog: skip: supabase-storage-bucket is not checked -- storage.buckets is created by Supabase's Storage API service, not by this database's own migrations (same reason as verify-supabase-image.sh's skip_storage_kind)",
);

const gaps = entries.flatMap(([key, node]) => {
	const separator = key.indexOf(":");
	const kind = key.slice(0, separator);
	const identity = key.slice(separator + 1);
	return checkObject(kind, identity, node);
});

if (gaps.length > 0) {
	console.error(
		`check-declared-vs-catalog: ${gaps.length} declared object(s) missing or differing in the catalog:`,
	);
	console.error(gaps.map((gap) => `  ${gap}`).join("\n"));
	process.exit(1);
}

console.log(
	`check-declared-vs-catalog: ok -- every declared object (excluding supabase-storage-bucket) exists in the catalog`,
);

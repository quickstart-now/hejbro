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
// `attnotnull`.
//
// What this DOES NOT check (deliberately out of scope for this first
// pass, #212's checkpoint decision -- a follow-up issue, filed as a
// sub-issue of #9, covers closing this gap): a column's declared type
// against the catalog's actual type, a column's declared default
// expression against the catalog's actual default, an index's declared
// column list or expression, a check constraint's declared expression, a
// function's/view's declared body, a trigger's declared timing/event
// beyond its name. All of these could exist under the right name while
// still being wrong in a way this script cannot see.
//
// `supabase-storage-bucket` (the one preset-only kind, `@hejbro/
// supabase`) is skipped entirely, same as verify-supabase-image.sh's own
// skip_storage_kind: storage.buckets is a row in a table the Storage API
// service owns, not this Postgres image's own migrations, so there is no
// catalog object for this script to check it against.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
	columns: runPsqlJson(`
		select n.nspname as schema, c.relname as "table", a.attname as name,
			a.attnotnull as "notNull"
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		join pg_attribute a on a.attrelid = c.oid
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
	return [];
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

import { throwHejbroError } from "@hejbro/core";
import type { DriverRow, DriverSession } from "@hejbro/query";
import { z } from "zod";

const schemaRow = z.object({ schema: z.string() });
export type SchemaRow = z.infer<typeof schemaRow>;

const tableRow = z.object({
	schema: z.string(),
	table: z.string(),
	rls: z.boolean(),
});
export type TableRow = z.infer<typeof tableRow>;

/**
 * `baseTypeKind`/`baseTypeSchema`/`baseTypeName` resolve the column's
 * scalar type regardless of array wrapping (`pg_type.typcategory = 'A'`
 * unwraps through `typelem`) -- `'e'` means enum, and the schema/name pair
 * is how an enum's own type is identified without trusting `catalogType`'s
 * enum spelling, which is `search_path`-sensitive (ported from
 * `scripts/check-declared-vs-catalog.mjs`, measured against a real
 * postgres:17, #218).
 */
const columnRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
	notNull: z.boolean(),
	catalogType: z.string(),
	baseTypeKind: z.string().nullable(),
	baseTypeSchema: z.string().nullable(),
	baseTypeName: z.string().nullable(),
	catalogDefault: z.string().nullable(),
});
export type ColumnRow = z.infer<typeof columnRow>;

const constraintRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
	type: z.string(),
	columns: z.array(z.string()),
});
export type ConstraintRow = z.infer<typeof constraintRow>;

const indexRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
});
export type IndexRow = z.infer<typeof indexRow>;

const namedObjectRow = z.object({ schema: z.string(), name: z.string() });
export type EnumRow = z.infer<typeof namedObjectRow>;
export type SequenceRow = z.infer<typeof namedObjectRow>;
export type FunctionRow = z.infer<typeof namedObjectRow>;
export type ViewRow = z.infer<typeof namedObjectRow>;

const tableScopedObjectRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
});
export type PolicyRow = z.infer<typeof tableScopedObjectRow>;
export type TriggerRow = z.infer<typeof tableScopedObjectRow>;

const tableGrantRow = z.object({
	schema: z.string(),
	table: z.string(),
	role: z.string(),
	privilege: z.string(),
});
export type TableGrantRow = z.infer<typeof tableGrantRow>;

const schemaGrantRow = z.object({
	schema: z.string(),
	role: z.string(),
	privilege: z.string(),
});
export type SchemaUsageGrantRow = z.infer<typeof schemaGrantRow>;
export type DefaultTableGrantRow = z.infer<typeof schemaGrantRow>;

/**
 * One query per catalog concern, ported from
 * `scripts/check-declared-vs-catalog.mjs` (measured against a real
 * postgres:17, #212/#218) -- no declared value is ever interpolated into
 * any of these; each fetches its entire inventory unfiltered, and the
 * declared-vs-catalog comparison happens in TypeScript (group 2), so
 * there is no identifier/literal-escaping question to get wrong. Exported
 * so the test that pins "parameterless, read-only statements only" can
 * assert against the exact text sent to the driver.
 */
export const CHECK_CATALOG_QUERIES = {
	schemas: `select nspname as schema from pg_namespace`,
	tables: `
		select n.nspname as schema, c.relname as "table", c.relrowsecurity as rls
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where c.relkind in ('r','p')
	`,
	columns: `
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
	`,
	constraints: `
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
	`,
	indexes: `
		select n.nspname as schema, c.relname as "table", ic.relname as name
		from pg_index ix
		join pg_class c on c.oid = ix.indrelid
		join pg_class ic on ic.oid = ix.indexrelid
		join pg_namespace n on n.oid = c.relnamespace
	`,
	enums: `
		select n.nspname as schema, t.typname as name
		from pg_type t
		join pg_namespace n on n.oid = t.typnamespace
		where t.typtype = 'e'
	`,
	sequences: `
		select n.nspname as schema, c.relname as name
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where c.relkind = 'S'
	`,
	functions: `
		select n.nspname as schema, p.proname as name
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
	`,
	views: `
		select n.nspname as schema, c.relname as name
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where c.relkind in ('v','m')
	`,
	policies: `
		select schemaname as schema, tablename as "table", policyname as name
		from pg_policies
	`,
	triggers: `
		select n.nspname as schema, c.relname as "table", t.tgname as name
		from pg_trigger t
		join pg_class c on c.oid = t.tgrelid
		join pg_namespace n on n.oid = c.relnamespace
		where not t.tgisinternal
	`,
	// Not information_schema.role_table_grants (1.4): that view shows only
	// the grants the connected role is party to (grantor/grantee/
	// membership), so a limited role would read a real grant as absent.
	// aclexplode reads pg_class.relacl directly -- role-independent, like
	// its two neighbours below. A null relacl means "the owner's default
	// privileges", not "no privileges", and aclexplode(NULL) returns zero
	// rows, so it is read through acldefault('r', relowner) to expand
	// that default explicitly (the view being replaced already does this
	// expansion internally).
	tableGrants: `
		select n.nspname as schema, c.relname as "table",
			case when g.grantee = 0 then 'public' else pg_get_userbyid(g.grantee) end as role,
			g.privilege_type as privilege
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as g
		where c.relkind in ('r','p')
	`,
	schemaUsageGrants: `
		select n.nspname as schema,
			case when g.grantee = 0 then 'public' else pg_get_userbyid(g.grantee) end as role,
			g.privilege_type as privilege
		from pg_namespace n
		cross join lateral aclexplode(n.nspacl) as g
	`,
	defaultTableGrants: `
		select n.nspname as schema,
			case when g.grantee = 0 then 'public' else pg_get_userbyid(g.grantee) end as role,
			g.privilege_type as privilege
		from pg_default_acl d
		join pg_namespace n on n.oid = d.defaclnamespace
		cross join lateral aclexplode(d.defaclacl) as g
		where d.defaclobjtype = 'r'
	`,
} as const satisfies Readonly<Record<string, string>>;

export type Catalog = {
	readonly schemas: ReadonlyArray<SchemaRow>;
	readonly tables: ReadonlyArray<TableRow>;
	readonly columns: ReadonlyArray<ColumnRow>;
	readonly constraints: ReadonlyArray<ConstraintRow>;
	readonly indexes: ReadonlyArray<IndexRow>;
	readonly enums: ReadonlyArray<EnumRow>;
	readonly sequences: ReadonlyArray<SequenceRow>;
	readonly functions: ReadonlyArray<FunctionRow>;
	readonly views: ReadonlyArray<ViewRow>;
	readonly policies: ReadonlyArray<PolicyRow>;
	readonly triggers: ReadonlyArray<TriggerRow>;
	readonly tableGrants: ReadonlyArray<TableGrantRow>;
	readonly schemaUsageGrants: ReadonlyArray<SchemaUsageGrantRow>;
	readonly defaultTableGrants: ReadonlyArray<DefaultTableGrantRow>;
};

/** Runs one catalog query and validates every row against `rowSchema` -- the system-boundary check for data arriving from a live database, never trusted as pre-shaped. */
const runCatalogQuery = async <T>(
	session: DriverSession,
	sql: string,
	rowSchema: z.ZodType<T>,
): Promise<ReadonlyArray<T>> => {
	const rows: ReadonlyArray<DriverRow> = await session.execute({
		sql,
		params: [],
		kind: "sql",
	});
	return rows.map((row) => rowSchema.parse(row));
};

/** The `Promise.all`-driven read itself, unwrapped -- {@link readCatalog} is the try/caught public entry point. */
const readCatalogRows = async (session: DriverSession): Promise<Catalog> => {
	const [
		schemas,
		tables,
		columns,
		constraints,
		indexes,
		enums,
		sequences,
		functions,
		views,
		policies,
		triggers,
		tableGrants,
		schemaUsageGrants,
		defaultTableGrants,
	] = await Promise.all([
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.schemas, schemaRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.tables, tableRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.columns, columnRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.constraints, constraintRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.indexes, indexRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.enums, namedObjectRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.sequences, namedObjectRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.functions, namedObjectRow),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.views, namedObjectRow),
		runCatalogQuery(
			session,
			CHECK_CATALOG_QUERIES.policies,
			tableScopedObjectRow,
		),
		runCatalogQuery(
			session,
			CHECK_CATALOG_QUERIES.triggers,
			tableScopedObjectRow,
		),
		runCatalogQuery(session, CHECK_CATALOG_QUERIES.tableGrants, tableGrantRow),
		runCatalogQuery(
			session,
			CHECK_CATALOG_QUERIES.schemaUsageGrants,
			schemaGrantRow,
		),
		runCatalogQuery(
			session,
			CHECK_CATALOG_QUERIES.defaultTableGrants,
			schemaGrantRow,
		),
	]);
	return {
		schemas,
		tables,
		columns,
		constraints,
		indexes,
		enums,
		sequences,
		functions,
		views,
		policies,
		triggers,
		tableGrants,
		schemaUsageGrants,
		defaultTableGrants,
	};
};

/** True for a plain `Error`-like value with a `message`, the shape every read failure this function must not lose (a coded driver error, a plain network error, or a zod validation error alike) -- narrower than `instanceof Error` would need to be, but every real case reaching here already has this shape. */
const messageOf = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

/**
 * Reads the whole catalog inventory this command's comparison (group 2)
 * needs, as fourteen independent, parameterless read-only statements run
 * concurrently over one already-open session. A read that fails outright
 * (a permission error, a dropped connection, a malformed row) SHALL NOT
 * be read as "the objects it would have returned do not exist" (spec:
 * "What the catalog says does not depend on who is asking") -- it stops
 * the whole command with a coded error instead.
 */
export const readCatalog = async (session: DriverSession): Promise<Catalog> => {
	try {
		return await readCatalogRows(session);
	} catch (error) {
		return throwHejbroError(
			"check-catalog-unreadable",
			`hejbro check could not read the database catalog: ${messageOf(error)}. Next: confirm the connected role can read pg_catalog (the standard grant for any login role), and that --url/DATABASE_URL points at a reachable database.`,
		);
	}
};

import type { DriverRow, DriverSession } from "@hejbro/query";
import { z } from "zod";

/**
 * Facts `check`'s own `CHECK_CATALOG_QUERIES` never reads (measured
 * against the current `check/catalog.ts`, #604 CI-G1-R1-01 B1): column
 * physical position, `attidentity`/`attgenerated`, a foreign key's
 * target and actions, a CHECK constraint's expression text, an index's
 * columns/uniqueness/access method/partial predicate, enum labels, and
 * an identity column's owned-sequence options. Inference needs all of
 * these on top of the shared `readCatalog` inventory (catalog-inference
 * delta) -- read here, never by editing `check/catalog.ts`.
 */
const columnDetailRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
	position: z.number(),
	identityKind: z.string(),
	generatedKind: z.string(),
});
export type ColumnDetailRow = z.infer<typeof columnDetailRow>;

const foreignKeyDetailRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
	targetSchema: z.string(),
	targetTable: z.string(),
	targetColumns: z.array(z.string()),
	onDelete: z.string(),
	onUpdate: z.string(),
});
export type ForeignKeyDetailRow = z.infer<typeof foreignKeyDetailRow>;

const checkExpressionRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
	expression: z.string(),
});
export type CheckExpressionRow = z.infer<typeof checkExpressionRow>;

/** `columns` carries `null` for an expression-index element (no matching `pg_attribute` row). */
const indexDetailRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
	isUnique: z.boolean(),
	method: z.string(),
	columns: z.array(z.string().nullable()),
	predicate: z.string().nullable(),
});
export type IndexDetailRow = z.infer<typeof indexDetailRow>;

const enumLabelRow = z.object({
	schema: z.string(),
	name: z.string(),
	label: z.string(),
	sortOrder: z.number(),
});
export type EnumLabelRow = z.infer<typeof enumLabelRow>;

/** `pg_sequence`'s own bigint columns arrive as text (node-postgres's int8 default), never a JS `number`. */
const identitySequenceOptionRow = z.object({
	schema: z.string(),
	table: z.string(),
	column: z.string(),
	startValue: z.string(),
	increment: z.string(),
	minValue: z.string(),
	maxValue: z.string(),
	cache: z.string(),
	cycle: z.boolean(),
});
export type IdentitySequenceOptionRow = z.infer<
	typeof identitySequenceOptionRow
>;

/**
 * One query per detail concern, parameterless and read-only like
 * `CHECK_CATALOG_QUERIES` -- no declared value is ever interpolated,
 * each fetches its entire inventory unfiltered, and every read-only
 * check this module owns (`infer-catalog-read.test.ts`) derives its
 * expectations from this constant rather than a second copy of the SQL
 * text.
 */
export const INFER_CATALOG_QUERIES = {
	columnDetails: `
		select n.nspname as schema, c.relname as "table", a.attname as name,
			a.attnum as position,
			a.attidentity as "identityKind",
			a.attgenerated as "generatedKind"
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		join pg_attribute a on a.attrelid = c.oid
		where c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped
	`,
	foreignKeyDetails: `
		select n.nspname as schema, c.relname as "table", con.conname as name,
			tn.nspname as "targetSchema", tc.relname as "targetTable",
			coalesce((
				select json_agg(att.attname order by ord.n)
				from unnest(con.confkey) with ordinality as ord(attnum, n)
				join pg_attribute att
					on att.attrelid = con.confrelid and att.attnum = ord.attnum
			), '[]'::json) as "targetColumns",
			con.confdeltype as "onDelete",
			con.confupdtype as "onUpdate"
		from pg_constraint con
		join pg_class c on c.oid = con.conrelid
		join pg_namespace n on n.oid = c.relnamespace
		join pg_class tc on tc.oid = con.confrelid
		join pg_namespace tn on tn.oid = tc.relnamespace
		where con.contype = 'f'
	`,
	checkExpressions: `
		select n.nspname as schema, c.relname as "table", con.conname as name,
			pg_get_expr(con.conbin, con.conrelid) as expression
		from pg_constraint con
		join pg_class c on c.oid = con.conrelid
		join pg_namespace n on n.oid = c.relnamespace
		where con.contype = 'c'
	`,
	indexDetails: `
		select n.nspname as schema, c.relname as "table", ic.relname as name,
			ix.indisunique as "isUnique",
			am.amname as method,
			coalesce((
				select json_agg(att.attname order by ord.n)
				from unnest(ix.indkey) with ordinality as ord(attnum, n)
				left join pg_attribute att
					on att.attrelid = ix.indrelid and att.attnum = ord.attnum
			), '[]'::json) as columns,
			pg_get_expr(ix.indpred, ix.indrelid) as predicate
		from pg_index ix
		join pg_class c on c.oid = ix.indrelid
		join pg_class ic on ic.oid = ix.indexrelid
		join pg_namespace n on n.oid = c.relnamespace
		join pg_am am on am.oid = ic.relam
	`,
	enumLabels: `
		select n.nspname as schema, t.typname as name, e.enumlabel as label,
			e.enumsortorder as "sortOrder"
		from pg_enum e
		join pg_type t on t.oid = e.enumtypid
		join pg_namespace n on n.oid = t.typnamespace
	`,
	identitySequenceOptions: `
		select n.nspname as schema, c.relname as "table", a.attname as "column",
			seq.seqstart as "startValue",
			seq.seqincrement as increment,
			seq.seqmin as "minValue",
			seq.seqmax as "maxValue",
			seq.seqcache as cache,
			seq.seqcycle as cycle
		from pg_attribute a
		join pg_class c on c.oid = a.attrelid
		join pg_namespace n on n.oid = c.relnamespace
		join pg_depend dep
			on dep.refobjid = c.oid and dep.refobjsubid = a.attnum and dep.deptype = 'i'
		join pg_class seqc on seqc.oid = dep.objid and seqc.relkind = 'S'
		join pg_sequence seq on seq.seqrelid = seqc.oid
		where a.attidentity <> ''
	`,
} as const satisfies Readonly<Record<string, string>>;

export type InferenceCatalog = {
	readonly columnDetails: ReadonlyArray<ColumnDetailRow>;
	readonly foreignKeyDetails: ReadonlyArray<ForeignKeyDetailRow>;
	readonly checkExpressions: ReadonlyArray<CheckExpressionRow>;
	readonly indexDetails: ReadonlyArray<IndexDetailRow>;
	readonly enumLabels: ReadonlyArray<EnumLabelRow>;
	readonly identitySequenceOptions: ReadonlyArray<IdentitySequenceOptionRow>;
};

/** Runs one inference-catalog query and validates every row against `rowSchema` -- the system-boundary check for data arriving from a live database (mirrors `check/catalog.ts`'s `runCatalogQuery`). */
const runInferQuery = async <T>(
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

/**
 * Reads inference's own detail queries, run concurrently over one
 * already-open session -- the caller supplies `check`'s shared
 * `readCatalog` inventory separately (catalog-inference delta: "through
 * read-only catalog queries: `check`'s own inventory queries plus the
 * column-, constraint-, index- and enum-detail queries inference needs
 * on top of them").
 */
export const readInferenceCatalog = async (
	session: DriverSession,
): Promise<InferenceCatalog> => {
	const [
		columnDetails,
		foreignKeyDetails,
		checkExpressions,
		indexDetails,
		enumLabels,
		identitySequenceOptions,
	] = await Promise.all([
		runInferQuery(
			session,
			INFER_CATALOG_QUERIES.columnDetails,
			columnDetailRow,
		),
		runInferQuery(
			session,
			INFER_CATALOG_QUERIES.foreignKeyDetails,
			foreignKeyDetailRow,
		),
		runInferQuery(
			session,
			INFER_CATALOG_QUERIES.checkExpressions,
			checkExpressionRow,
		),
		runInferQuery(session, INFER_CATALOG_QUERIES.indexDetails, indexDetailRow),
		runInferQuery(session, INFER_CATALOG_QUERIES.enumLabels, enumLabelRow),
		runInferQuery(
			session,
			INFER_CATALOG_QUERIES.identitySequenceOptions,
			identitySequenceOptionRow,
		),
	]);
	return {
		columnDetails,
		foreignKeyDetails,
		checkExpressions,
		indexDetails,
		enumLabels,
		identitySequenceOptions,
	};
};

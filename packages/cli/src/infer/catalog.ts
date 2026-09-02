import type { DriverRow, DriverSession } from "@hejbro/query";
import { z } from "zod";

/**
 * Facts `check`'s own `CHECK_CATALOG_QUERIES` never reads (measured
 * against the current `check/catalog.ts`, #604 CI-G1-R1-01 B1): column
 * physical position, `attidentity`/`attgenerated`, a foreign key's
 * target and actions, a CHECK constraint's expression text, an index's
 * key columns (expression elements included)/uniqueness/access
 * method/partial predicate/operator class/sort options, enum labels,
 * and an identity column's owned-sequence options. Inference needs all
 * of these on top of the shared `readCatalog` inventory
 * (catalog-inference delta) -- read here, never by editing
 * `check/catalog.ts`. The index widening (B6) is load-bearing:
 * `examples/postgres` declares an expression index, a partial unique
 * index, a GIN index with a non-default operator class, and a
 * descending/nulls-first index column, and group 5's witness reads
 * exactly that database.
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

/**
 * One key column of an index. `text` is `pg_get_indexdef(indexrelid, n,
 * true)`'s deparse of this position -- Postgres's own decoder for "the
 * n-th zero in `indkey` is the n-th expression in `indexprs`", so this
 * module never re-walks that mapping by hand. `column` carries the
 * `pg_attribute` name when this position is a real column (`indkey[n] !=
 * 0`) and is `null` for an expression element (B6: `lower(email)`) --
 * 1.4 needs this split to tell "reference an existing column" apart from
 * "wrap raw text in `sql.raw`". `opclassIsDefault` matters because the
 * snapshot's compact form only records a non-default operator class
 * (B6: `jsonb_path_ops` on a GIN index, `jsonb_ops` is the default).
 * `descending`/`nullsFirst` decode `pg_index.indoption`'s two low bits.
 */
const indexColumnRow = z.object({
	text: z.string(),
	column: z.string().nullable(),
	opclass: z.string(),
	opclassIsDefault: z.boolean(),
	descending: z.boolean(),
	nullsFirst: z.boolean(),
});
export type IndexColumnRow = z.infer<typeof indexColumnRow>;

const indexDetailRow = z.object({
	schema: z.string(),
	table: z.string(),
	name: z.string(),
	isUnique: z.boolean(),
	method: z.string(),
	predicate: z.string().nullable(),
	columns: z.array(indexColumnRow),
});
export type IndexDetailRow = z.infer<typeof indexDetailRow>;

const enumLabelRow = z.object({
	schema: z.string(),
	name: z.string(),
	label: z.string(),
	sortOrder: z.number(),
});
export type EnumLabelRow = z.infer<typeof enumLabelRow>;

/**
 * A sequence's own facts, plus who owns it and how (CI-G1-R1-10 (D) --
 * the lead's three-way split): `ownership` is `pg_depend.deptype`,
 * `"i"` (identity, `.generatedAlwaysAsIdentity()`/
 * `.generatedByDefaultAsIdentity()` already express it) or `"a"`
 * (a `serial`-family column's own auto dependency -- the DSL
 * synthesizes this sequence from `serial()`/`bigserial()`/
 * `smallserial()`, D66). A sequence absent from this array (present in
 * `check/catalog.ts`'s shared `sequences` inventory but not here) owns
 * no column and is standalone -- not inferred (no `defineSequence()`
 * in the public DSL). `pg_sequence`'s own bigint columns arrive as
 * text (node-postgres's int8 default), never a JS `number`.
 */
const sequenceOwnershipRow = z.object({
	sequenceSchema: z.string(),
	sequenceName: z.string(),
	schema: z.string(),
	table: z.string(),
	column: z.string(),
	ownership: z.enum(["i", "a"]),
	startValue: z.string(),
	increment: z.string(),
	minValue: z.string(),
	maxValue: z.string(),
	cache: z.string(),
	cycle: z.boolean(),
});
export type SequenceOwnershipRow = z.infer<typeof sequenceOwnershipRow>;

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
			pg_get_expr(ix.indpred, ix.indrelid) as predicate,
			coalesce((
				select json_agg(
					json_build_object(
						'text', pg_get_indexdef(ix.indexrelid, ord.n::int, true),
						'column', att.attname,
						'opclass', opc.opcname,
						'opclassIsDefault', opc.opcdefault,
						'descending', (ix.indoption[ord.n - 1] & 1) = 1,
						'nullsFirst', (ix.indoption[ord.n - 1] & 2) = 2
					) order by ord.n
				)
				from generate_series(1, ix.indnkeyatts) as ord(n)
				left join pg_attribute att
					on att.attrelid = ix.indrelid
					and att.attnum = ix.indkey[ord.n - 1]
					and ix.indkey[ord.n - 1] <> 0
				left join pg_opclass opc on opc.oid = ix.indclass[ord.n - 1]
			), '[]'::json) as columns
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
	sequenceOwnership: `
		select sn.nspname as "sequenceSchema", seqc.relname as "sequenceName",
			n.nspname as schema, c.relname as "table", a.attname as "column",
			dep.deptype as ownership,
			seq.seqstart as "startValue",
			seq.seqincrement as increment,
			seq.seqmin as "minValue",
			seq.seqmax as "maxValue",
			seq.seqcache as cache,
			seq.seqcycle as cycle
		from pg_class seqc
		join pg_namespace sn on sn.oid = seqc.relnamespace
		join pg_depend dep
			on dep.objid = seqc.oid and dep.deptype in ('i','a')
		join pg_class c on c.oid = dep.refobjid
		join pg_namespace n on n.oid = c.relnamespace
		join pg_attribute a
			on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
		join pg_sequence seq on seq.seqrelid = seqc.oid
		where seqc.relkind = 'S' and dep.refobjsubid > 0
	`,
} as const satisfies Readonly<Record<string, string>>;

export type InferenceCatalog = {
	readonly columnDetails: ReadonlyArray<ColumnDetailRow>;
	readonly foreignKeyDetails: ReadonlyArray<ForeignKeyDetailRow>;
	readonly checkExpressions: ReadonlyArray<CheckExpressionRow>;
	readonly indexDetails: ReadonlyArray<IndexDetailRow>;
	readonly enumLabels: ReadonlyArray<EnumLabelRow>;
	readonly sequenceOwnership: ReadonlyArray<SequenceOwnershipRow>;
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
		sequenceOwnership,
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
			INFER_CATALOG_QUERIES.sequenceOwnership,
			sequenceOwnershipRow,
		),
	]);
	return {
		columnDetails,
		foreignKeyDetails,
		checkExpressions,
		indexDetails,
		enumLabels,
		sequenceOwnership,
	};
};

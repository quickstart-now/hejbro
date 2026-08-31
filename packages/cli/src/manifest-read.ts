import type { DriverRow, DriverSession } from "@hejbro/query";
import { z } from "zod";

/**
 * One row of `hejbro.schema_manifest`, the shape both `sync` (group 5)
 * and the startup freshness check (group 6) read -- kept here, and only
 * here, because two readers of the same table would be free to disagree
 * about the row they both parse (schema-sync delta). `seq`/`applied_at`
 * are what make "the newest" true; neither is part of what a caller
 * reads, so neither appears here.
 */
const manifestRowSchema = z.object({
	// `.int()` (reader hardening): a non-integer format column is not a
	// format this or any reader was ever going to recognize, so it fails
	// validation here rather than comparing successfully against nothing.
	manifestFormat: z.number().int(),
	snapshotFormat: z.number().int(),
	snapshotHash: z.string(),
	manifest: z.string(),
});

export type ManifestRow = z.infer<typeof manifestRowSchema>;

/** {@link ManifestRow} plus the identity column that orders it among every other row -- `seq` is never part of {@link ManifestRow} itself (5.11's own boundary: it is what makes "the newest" true, not part of what a caller reads), but a caller comparing a stamp against the *whole* table needs it to tell rows apart and count distance between them. */
const manifestRowWithSeqSchema = manifestRowSchema.extend({
	seq: z.number().int(),
});

export type ManifestRowWithSeq = z.infer<typeof manifestRowWithSeqSchema>;

/**
 * `node:*`-free by construction: this module sits on the CLI's startup
 * import path (`assert-schema.ts`), which `assert-schema-imports.test.ts`
 * keeps free of the filesystem, `citty`, and the rest of `node:*` -- a
 * session's own `execute` is the only I/O this file performs.
 */
const NEWEST_MANIFEST_ROW_QUERY = {
	sql: [
		"select",
		'\t"manifest_format" as "manifestFormat",',
		'\t"snapshot_format" as "snapshotFormat",',
		'\t"snapshot_hash" as "snapshotHash",',
		'\t"manifest" as "manifest"',
		'from "hejbro"."schema_manifest"',
		'order by "seq" desc',
		"limit 1",
	].join("\n"),
	params: [],
	kind: "sql" as const,
};

/**
 * The newest row of `hejbro.schema_manifest`, or `null` when the table
 * has no rows -- distinguishing "empty" from "missing entirely" (and
 * naming either as a coded failure) is a caller concern, not this
 * reader's: this function reads the newest row and nothing else.
 */
export const readNewestManifestRow = async (
	session: DriverSession,
): Promise<ManifestRow | null> => {
	const rows: ReadonlyArray<DriverRow> = await session.execute(
		NEWEST_MANIFEST_ROW_QUERY,
	);
	const [row] = rows;
	if (row === undefined) {
		return null;
	}
	return manifestRowSchema.parse(row);
};

/**
 * The row whose `snapshot_hash` matches `stamp`, or `null` when none does
 * -- targeted (`where`, not a full-table fetch), because the manifest is
 * an append-only history with no row-count ceiling: a reader comparing a
 * consumer's own stamp against it has no reason to ever hold more than
 * the one row it's looking for in memory at once. `seq` travels with
 * this row (unlike {@link readNewestManifestRow}'s) because a caller that
 * searches by stamp is exactly the caller that goes on to ask how many
 * rows follow it ({@link countManifestRowsAfter}).
 */
const MANIFEST_ROW_BY_STAMP_QUERY = (stamp: string) => ({
	sql: [
		"select",
		'\t"seq" as "seq",',
		'\t"manifest_format" as "manifestFormat",',
		'\t"snapshot_format" as "snapshotFormat",',
		'\t"snapshot_hash" as "snapshotHash",',
		'\t"manifest" as "manifest"',
		'from "hejbro"."schema_manifest"',
		'where "snapshot_hash" = $1',
	].join("\n"),
	params: [stamp],
	kind: "sql" as const,
});

export const findManifestRowByStamp = async (
	session: DriverSession,
	stamp: string,
): Promise<ManifestRowWithSeq | null> => {
	const rows: ReadonlyArray<DriverRow> = await session.execute(
		MANIFEST_ROW_BY_STAMP_QUERY(stamp),
	);
	const [row] = rows;
	if (row === undefined) {
		return null;
	}
	return manifestRowWithSeqSchema.parse(row);
};

const manifestRowCountSchema = z.object({
	// Postgres's own `count(*)` returns `bigint`, which node-postgres
	// hands back as a numeric string rather than a JS `number` (a bigint
	// can exceed `Number.MAX_SAFE_INTEGER`) -- accepted as either here and
	// coerced, since a manifest's own row count is never in that range.
	count: z.union([z.number(), z.string()]),
});

/** How many rows come after `seq` -- a `count`, never a fetch of the rows themselves, for the same append-only-history reason {@link findManifestRowByStamp} is targeted rather than a full-table read. */
export const countManifestRowsAfter = async (
	session: DriverSession,
	seq: number,
): Promise<number> => {
	const rows: ReadonlyArray<DriverRow> = await session.execute({
		sql: 'select count(*) as "count" from "hejbro"."schema_manifest" where "seq" > $1',
		params: [seq],
		kind: "sql",
	});
	const [row] = rows;
	const parsed = manifestRowCountSchema.parse(row);
	return Number(parsed.count);
};

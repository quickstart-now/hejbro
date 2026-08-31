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

/** Same table, ordered oldest-first by `seq` -- for a caller that needs to search for a specific row (by stamp) among every row, or count how many rows follow one, neither of which "the newest row" alone can answer. Throws (never swallows) both when the table itself doesn't exist (a real driver error, e.g. Postgres's `42P01`) and when a row's own columns don't validate (zod) -- distinguishing "no table", "no rows", and "a row this reader cannot make sense of" is a caller concern, same as {@link readNewestManifestRow}'s own boundary. */
const ALL_MANIFEST_ROWS_QUERY = {
	sql: [
		"select",
		'\t"seq" as "seq",',
		'\t"manifest_format" as "manifestFormat",',
		'\t"snapshot_format" as "snapshotFormat",',
		'\t"snapshot_hash" as "snapshotHash",',
		'\t"manifest" as "manifest"',
		'from "hejbro"."schema_manifest"',
		'order by "seq" asc',
	].join("\n"),
	params: [],
	kind: "sql" as const,
};

export const readManifestRows = async (
	session: DriverSession,
): Promise<ReadonlyArray<ManifestRowWithSeq>> => {
	const rows: ReadonlyArray<DriverRow> = await session.execute(
		ALL_MANIFEST_ROWS_QUERY,
	);
	return rows.map((row) => manifestRowWithSeqSchema.parse(row));
};

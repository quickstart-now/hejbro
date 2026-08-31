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
	manifestFormat: z.number(),
	snapshotFormat: z.number(),
	snapshotHash: z.string(),
	manifest: z.string(),
});

export type ManifestRow = z.infer<typeof manifestRowSchema>;

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

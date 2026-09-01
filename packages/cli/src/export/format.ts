import type { Snapshot } from "@hejbro/core";

/**
 * The export description's own format version — independent of the
 * embedded snapshot's `formatVersion` (schema-export spec, "The export
 * records the formats it is written in": the two move independently, so
 * a reader that cannot tell them apart would misjudge one when the
 * other changed). Bump this when `ExportDescription`'s own shape
 * changes, never when the snapshot format changes underneath it.
 */
export const EXPORT_DESCRIPTION_FORMAT = 1;

/**
 * The third export file's own content: both format numbers, as a value
 * a consumer's toolchain reads before it commits to parsing the
 * description or the SQL at all.
 */
export type ExportFormatRecord = {
	readonly descriptionFormat: number;
	readonly snapshotFormat: number;
};

export const buildExportFormatRecord = (
	snapshot: Snapshot,
): ExportFormatRecord => ({
	descriptionFormat: EXPORT_DESCRIPTION_FORMAT,
	snapshotFormat: snapshot.formatVersion,
});

import type { Snapshot } from "@hejbro/core";

/**
 * The export description's own format version — independent of the
 * embedded snapshot's `formatVersion` (schema-export spec, "The export
 * records the formats it is written in": the two move independently, so
 * a reader that cannot tell them apart would misjudge one when the
 * other changed). Bump this when an older reader would misread the
 * description, never merely when a field is added: `validate-export.ts`'s
 * reader refuses a newer format wholesale, so bumping for a purely
 * additive field would refuse an older toolchain an export it could
 * actually still read past. Never bump for the snapshot format changing
 * underneath it, either — that is `snapshotFormat`'s own field.
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

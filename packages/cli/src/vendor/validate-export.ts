import { parseSnapshot, throwHejbroError } from "@hejbro/core";
import { z } from "zod";
import type { ExportFormatRecord } from "../export/format";
import { EXPORT_DESCRIPTION_FORMAT } from "../export/format";
import type { ExportPayload } from "../export/write";

/** Mirrors `export/description.ts`'s own `ExportColumnFact` — the sidecar facts a description carries per column. */
const columnFactSchema = z.object({
	key: z.string(),
	mode: z.enum(["bigint", "number", "string"]).nullable(),
	notNullElements: z.boolean(),
});

const tableFactSchema = z.object({
	schemaName: z.string(),
	tableName: z.string(),
	exportName: z.string().nullable(),
	columns: z.record(z.string(), columnFactSchema),
});

const functionArgFactSchema = z.object({
	key: z.string(),
	sqlName: z.string(),
});

/** `null` for a trigger-synthesized function's return — neither a scalar value nor a row (schema-export delta). */
const functionReturnsFactSchema = z
	.union([
		z.object({ kind: z.literal("scalar") }),
		z.object({
			kind: z.literal("table"),
			schemaName: z.string(),
			tableName: z.string(),
		}),
	])
	.nullable();

const functionFactSchema = z.object({
	schemaName: z.string(),
	functionName: z.string(),
	exportName: z.string().nullable(),
	args: z.array(functionArgFactSchema),
	returns: functionReturnsFactSchema,
});

/**
 * `ExportDescription`'s own top-level shape (`tables`/`functions`/
 * `roles`), plus the embedded `snapshot` — validated separately below
 * via `parseSnapshot` (the one function that already knows that shape's
 * own rules) rather than restated here as a second copy that could
 * drift from core's own.
 */
const descriptionShapeSchema = z.object({
	tables: z.array(tableFactSchema),
	functions: z.array(functionFactSchema),
	roles: z.array(z.string()),
	snapshot: z.unknown(),
});

const formatSchema = z.object({
	descriptionFormat: z.number(),
	snapshotFormat: z.number(),
});

/**
 * Refuses a `format.json` newer than this toolchain knows, naming both
 * versions and the upgrade command (schema-vendoring spec, member 6 of
 * the eleven — "A description format newer than the reader is refused").
 * An older format is read as-is (the description schema below has only
 * ever grown by additive fields since format 1 shipped, `EXPORT_
 * DESCRIPTION_FORMAT`'s own history — there is no earlier shape yet to
 * tolerate; this branch exists so the asymmetry is structural now, not
 * added the day format 2 ships).
 */
const assertDescriptionFormatSupported = (format: ExportFormatRecord): void => {
	if (format.descriptionFormat <= EXPORT_DESCRIPTION_FORMAT) {
		return;
	}
	throwHejbroError(
		"vendor-export-format-unsupported",
		`the vendored export declares description format ${format.descriptionFormat}, newer than this toolchain's ${EXPORT_DESCRIPTION_FORMAT}. Next: run \`npm install -g hejbro@latest\` (or your package manager's equivalent) to read it.`,
	);
};

export type ValidatedExport = {
	readonly format: ExportFormatRecord;
	readonly payload: ExportPayload;
};

/**
 * Validates `format.json`'s own shape and version (member 6), then
 * `schema.json`'s shape against what that format promises (member 5,
 * "The export is present but does not answer its own format") — never
 * a blind cast (`fetch.ts`'s own prior behavior). The embedded
 * `snapshot` field is validated by `@hejbro/core`'s own `parseSnapshot`,
 * re-serialized to text first so this reuses that real validation
 * rather than restating it (the same "one parser, not two" reasoning
 * `stableJson` serialization already follows elsewhere in this
 * codebase).
 */
export const validateExport = (
	formatText: string,
	schemaText: string,
): ValidatedExport => {
	// D106 M3: a format.json that fails its own shape parse is "the
	// export does not answer its own format" (member 5) -- distinct from
	// member 6's "the format this toolchain knows is older than the one
	// declared", which only applies once the shape parses and its
	// version number can actually be read. Coding this branch as member
	// 6 sent readers to upgrade their own hejbro for a problem that
	// lives in the schema repository -- the delta's own stated harm.
	const formatParsed = formatSchema.safeParse(JSON.parse(formatText));
	if (!formatParsed.success) {
		return throwHejbroError(
			"vendor-export-invalid",
			"the vendored export's format.json does not answer its own format (schema-export spec) -- hand-edited, truncated, or written by something else. Next: ask the owner of the schema repository to regenerate it with `hejbro generate --export`.",
		);
	}
	assertDescriptionFormatSupported(formatParsed.data);

	const descriptionParsed = descriptionShapeSchema.safeParse(
		JSON.parse(schemaText),
	);
	if (!descriptionParsed.success) {
		return throwHejbroError(
			"vendor-export-invalid",
			"the vendored export's schema.json does not answer its own format (schema-export spec) -- hand-edited, truncated, or written by something else. Next: ask the owner of the schema repository to regenerate it with `hejbro generate --export`.",
		);
	}
	// Re-parses the embedded snapshot through core's own real validator --
	// `descriptionParsed.data` only proved `snapshot` is *some* JSON value.
	parseSnapshot(JSON.stringify(descriptionParsed.data.snapshot));

	return {
		format: formatParsed.data,
		payload: descriptionParsed.data as unknown as ExportPayload,
	};
};

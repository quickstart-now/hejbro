import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "@hejbro/core";
import { stableJson } from "@hejbro/core";
import type { ExportDescription } from "./description";
import { serializeExportDescription } from "./description";
import { buildExportFormatRecord } from "./format";

/** The export directory, relative to the repository root — never inside
 * `config.migrationsDir` (schema-export spec, "This file SHALL NOT be
 * written where migrations are collected"), so a tool that reads a
 * directory of `.sql` files never meets `snapshot.sql` there. */
export const EXPORT_DIR_NAME = ".hejbro/export";

export const EXPORT_DESCRIPTION_FILE = "schema.json";
export const EXPORT_SQL_FILE = "snapshot.sql";
export const EXPORT_FORMAT_FILE = "format.json";

/** An {@link ExportDescription} plus the snapshot of the declared schema
 * it was built alongside — the description alone says what the snapshot
 * cannot; a reader needs both together (schema-export spec, "The schema
 * description SHALL carry the snapshot of the declared schema plus the
 * declaration-time choices"). */
export type ExportPayload = ExportDescription & {
	readonly snapshot: Snapshot;
};

/**
 * Writes the three export files into {@link EXPORT_DIR_NAME}, creating
 * the directory if needed. `squashedSql` is the caller's own
 * responsibility to produce (`generateMigration` against an empty
 * snapshot) — this function only places it on disk, next to the
 * description and the format record it was written alongside.
 * Deterministic by construction: every value here comes from
 * `stableJson` or from `squashedSql` (itself deterministic,
 * `generate-command.test.ts`'s own guarantee), so two calls with the
 * same inputs write byte-identical files.
 */
export const writeExport = (
	cwd: string,
	payload: ExportPayload,
	squashedSql: string,
): void => {
	const dir = join(cwd, EXPORT_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, EXPORT_DESCRIPTION_FILE),
		serializeExportDescription(payload),
	);
	writeFileSync(join(dir, EXPORT_SQL_FILE), `${squashedSql}\n`);
	writeFileSync(
		join(dir, EXPORT_FORMAT_FILE),
		stableJson(buildExportFormatRecord(payload.snapshot)),
	);
};

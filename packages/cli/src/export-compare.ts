import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	HejbroInput,
	KindRegistry,
	Snapshot,
	Validator,
} from "@hejbro/core";
import { stableJson } from "@hejbro/core";
import {
	buildExportDescription,
	serializeExportDescription,
} from "./export/description";
import { buildExportFormatRecord } from "./export/format";
import { buildSquashedSql } from "./export/squash";
import type { ExportPayload } from "./export/write";
import {
	EXPORT_DESCRIPTION_FILE,
	EXPORT_DIR_NAME,
	EXPORT_FORMAT_FILE,
	EXPORT_SQL_FILE,
} from "./export/write";

export type ExportCompareResult = "absent" | "current" | "stale";

/**
 * Compares a committed export against what regenerating it right now
 * would write, by regenerating in memory and comparing bytes (R2-G3,
 * 3.1) — the checker and `generate --export` share every builder
 * (`buildExportDescription`, `buildSquashedSql`, `buildExportFormatRecord`,
 * `serializeExportDescription`), so the two can never disagree about
 * what "matching" means. `"absent"` when any of the three files is
 * missing: a repository that has never opted into the export is not
 * stale (schema-export spec, "A repository without the export is
 * unchanged" is the write-side twin of this read-side guarantee).
 */
export const compareExport = (
	cwd: string,
	declarations: ReadonlyArray<HejbroInput>,
	exportNames: ReadonlyMap<HejbroInput, string>,
	snapshot: Snapshot,
	registry: KindRegistry,
	validators: ReadonlyArray<Validator>,
): ExportCompareResult => {
	const dir = join(cwd, EXPORT_DIR_NAME);
	const descriptionPath = join(dir, EXPORT_DESCRIPTION_FILE);
	const sqlPath = join(dir, EXPORT_SQL_FILE);
	const formatPath = join(dir, EXPORT_FORMAT_FILE);
	if (![descriptionPath, sqlPath, formatPath].every(existsSync)) {
		return "absent";
	}

	const description = buildExportDescription(declarations, exportNames);
	const payload: ExportPayload = { ...description, snapshot };
	const expectedDescriptionText = serializeExportDescription(payload);
	const expectedSqlText = `${buildSquashedSql(declarations, registry, validators)}\n`;
	const expectedFormatText = stableJson(buildExportFormatRecord(snapshot));

	const matches =
		expectedDescriptionText === readFileSync(descriptionPath, "utf8") &&
		expectedSqlText === readFileSync(sqlPath, "utf8") &&
		expectedFormatText === readFileSync(formatPath, "utf8");
	if (matches) {
		return "current";
	}
	return "stale";
};

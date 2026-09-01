import type { HejbroInput } from "@hejbro/core";
import { emptySnapshot, generateMigration } from "@hejbro/core";
import { buildExportDescription } from "../../src/export/description";
import type { ExportPayload } from "../../src/export/write";

/**
 * Builds a real {@link ExportPayload} in-process, the same two calls
 * `generate --export` itself makes (`commands/generate.ts`), skipping
 * the CLI subprocess and the filesystem entirely — contract emission is
 * a pure function of this payload, so a unit test only needs the
 * payload, never a real repository.
 */
export const buildFixturePayload = (
	declarations: ReadonlyArray<HejbroInput>,
	exportNames: ReadonlyMap<HejbroInput, string> = new Map(),
): ExportPayload => {
	const { snapshot } = generateMigration({
		declarations,
		previousSnapshot: emptySnapshot,
	});
	const description = buildExportDescription(declarations, exportNames);
	return { ...description, snapshot };
};

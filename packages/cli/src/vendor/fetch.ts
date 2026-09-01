import { throwHejbroError } from "@hejbro/core";
import type { ExportFormatRecord } from "../export/format";
import {
	EXPORT_DESCRIPTION_FILE,
	EXPORT_DIR_NAME,
	EXPORT_FORMAT_FILE,
	EXPORT_SQL_FILE,
} from "../export/write";
import {
	readFileAtRemoteCommit,
	resolveRemoteHead,
	resolveRemoteRef,
} from "../git";

export type FetchedExport = {
	readonly ref: string;
	readonly commit: string;
	readonly schemaText: string;
	readonly sqlText: string;
	readonly format: ExportFormatRecord;
};

const exportPath = (name: string): string => `${EXPORT_DIR_NAME}/${name}`;

/** Reads the description, the squashed SQL and the format record at
 * `commit` of `source` — the three files `generate --export` writes,
 * read back exactly as committed (never transformed here; R2-G5 layers
 * the contract on top of this). Refuses when any is absent: a commit
 * with no export at all, named so the reader knows to ask the *other*
 * repository for it. */
const readExportAt = (
	source: string,
	ref: string,
	commit: string,
): FetchedExport => {
	const schemaBytes = readFileAtRemoteCommit(
		source,
		commit,
		exportPath(EXPORT_DESCRIPTION_FILE),
	);
	const sqlBytes = readFileAtRemoteCommit(
		source,
		commit,
		exportPath(EXPORT_SQL_FILE),
	);
	const formatBytes = readFileAtRemoteCommit(
		source,
		commit,
		exportPath(EXPORT_FORMAT_FILE),
	);
	if (schemaBytes === null || sqlBytes === null || formatBytes === null) {
		return throwHejbroError(
			"vendor-export-missing",
			`commit ${commit} of "${source}" carries no schema export at "${EXPORT_DIR_NAME}/". Next: ask the owner of that repository to run \`hejbro generate --export\` and commit the result, or link a different source.`,
		);
	}
	return {
		ref,
		commit,
		schemaText: schemaBytes.toString("utf8"),
		sqlText: sqlBytes.toString("utf8"),
		format: JSON.parse(formatBytes.toString("utf8")) as ExportFormatRecord,
	};
};

/**
 * Resolves `source` to a commit — its default branch unless `refOverride`
 * is given (4.6's `--ref`, which overrides one run and is never persisted
 * by the caller) — and reads the export there. `cwd` is only the
 * subprocess's own working directory; `source` need not be reachable
 * from it.
 */
export const resolveExport = (
	cwd: string,
	source: string,
	refOverride: string | undefined,
): FetchedExport => {
	if (refOverride !== undefined) {
		const commit = resolveRemoteRef(cwd, source, refOverride);
		if (commit === undefined) {
			return throwHejbroError(
				"vendor-ref-not-found",
				`"${refOverride}" does not resolve to anything on "${source}". Next: check the ref name, or omit --ref to use the default branch.`,
			);
		}
		return readExportAt(source, refOverride, commit);
	}
	const head = resolveRemoteHead(cwd, source);
	return readExportAt(source, head.branch, head.commit);
};

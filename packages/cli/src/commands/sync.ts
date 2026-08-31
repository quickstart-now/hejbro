import { existsSync, readFileSync } from "node:fs";
import { HEJBRO_SNAPSHOT_VERSION, throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";
import { identityFromMessage } from "../identity";
import { loadConfig } from "../loader";
import type { SyncDriverImporter } from "../sync/connection";
import { withSyncConnection } from "../sync/connection";
import type { ManifestDocument } from "../sync/emit";
import { buildSyncedModuleSource } from "../sync/emit";
import type { ManifestState } from "../sync/manifest-state";
import {
	READER_MANIFEST_FORMAT,
	readManifestState,
} from "../sync/manifest-state";
import { writeSyncedModule } from "../sync/write";

const SYNC_DESCRIPTION =
	"Read the newest manifest row from a database and write one TypeScript module describing that schema.";

// The `args` block exists only so `--help` renders these descriptions
// (mirrors check.ts's own CHECK_ARGS) -- runSync reads the values by
// hand from `ctx.rawArgs`.
const SYNC_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
	out: {
		type: "string",
		description:
			'destination file path (default: hejbro.config.ts\'s "entry", when it names exactly one file)',
	},
	force: {
		type: "boolean",
		description:
			"overwrite a destination that isn't a file `hejbro sync` wrote",
	},
	check: {
		type: "boolean",
		description:
			"compare without writing; exits non-zero when the destination differs from what sync would write now",
	},
	schema: {
		type: "string",
		description:
			"reserved for a future release -- passing it refuses rather than silently syncing the whole manifest",
	},
} as const;

const lastFlagValue = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): string | undefined => {
	const values = rawArgs.flatMap((token, index) => {
		if (token !== flagName) {
			return [];
		}
		const value = rawArgs[index + 1];
		if (value === undefined) {
			return [];
		}
		return [value];
	});
	return values.at(-1);
};

export type SyncResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const FALLBACK_IDENTITY = "hejbro sync";

/**
 * `--out`, else the config's single-file `entry`, else a coded refusal
 * (`DESIGN-5.1-FINAL`) -- an `entry` naming more than one file has no
 * single destination `sync` could pick without guessing which one is
 * meant to hold a synced schema.
 */
const resolveDestination = (
	outFlag: string | undefined,
	entry: ReadonlyArray<string>,
): string => {
	if (outFlag !== undefined && outFlag !== "") {
		return outFlag;
	}
	const [onlyEntry] = entry;
	if (entry.length === 1 && onlyEntry !== undefined) {
		return onlyEntry;
	}
	return throwHejbroError(
		"sync-destination-required",
		`hejbro sync needs one destination file, but --out wasn't passed and hejbro.config.ts's "entry" doesn't name exactly one file (it names ${entry.length}). Next: pass --out <path>, or point "entry" at a single file to sync into.`,
	);
};

/** `--schema` is parsed but never consulted for anything but this refusal (schema-sync delta, "The schema filter is reserved, not silently ignored") -- accepting it silently would let a caller believe a filter applied when the whole manifest was written regardless. Checked before any I/O, so passing it never even opens a connection. */
const refuseSchemaFilter = (schemaFlag: string | undefined): void => {
	if (schemaFlag === undefined) {
		return;
	}
	throwHejbroError(
		"sync-schema-filter-unsupported",
		`--schema is not supported yet -- this release of hejbro sync always reads the whole manifest. Next: drop --schema and rerun, or split into separate databases if you need separate schemas synced independently.`,
	);
};

type SyncOutcome =
	| { readonly mode: "wrote" }
	| { readonly mode: "check-current" }
	| { readonly mode: "check-differs" };

/**
 * `--check`'s own comparison (schema-sync delta, "The command can check
 * without writing"): the module `sync` would write is built exactly as a
 * real run would, then compared byte-for-byte against what is already at
 * `destination` -- never hashed, and never loaded as code. This answers
 * "would running `sync` right now produce something different", which is
 * a **different** question from freshness-by-stamp (group 6's own): the
 * same manifest row can render differently across a hejbro version that
 * changed the emitter's own output, with no schema change at all, so a
 * byte difference here is never reported as the schema having moved --
 * only that this destination isn't what a sync would write right now.
 * Absent entirely counts as differing: there is nothing yet to match.
 */
const compareToDestination = (
	destination: string,
	source: string,
): SyncOutcome => {
	if (existsSync(destination) && readFileSync(destination, "utf8") === source) {
		return { mode: "check-current" };
	}
	return { mode: "check-differs" };
};

const formatUnsupportedRowFormatText = (rowFormat: number | null): string => {
	if (rowFormat === null) {
		return "an unrecognized value";
	}
	return String(rowFormat);
};

const embeddedSnapshotFormatText = (
	embeddedFormatVersion: number | null,
): string => {
	if (embeddedFormatVersion === null) {
		return "in an unrecognized form";
	}
	return String(embeddedFormatVersion);
};

/** `MANIFEST-STATE-FINAL` (raise the five 5.6 owns): a manifest row's own SQLSTATE-driven absence, its emptiness, an unmatched stamp, a format higher than this reader knows, and a payload that doesn't answer its own format -- each named separately (schema-sync delta, "Each way a manifest can fail a reader is named separately"), because each sends its reader to a different remedy. The two situations this command does *not* raise here (a matched stamp with newer rows after it; a refused embedded snapshot format) are format-skew's own -- `snapshot-format-refused` still gets its own code below, since parsing the payload is this command's own job even though the *requirement* it fails under is format-skew's, not this one's. */
const throwForManifestState = (state: ManifestState): ManifestDocument => {
	if (state.situation === "found") {
		return state.document;
	}
	if (state.situation === "missing") {
		return throwHejbroError(
			"sync-manifest-missing",
			'hejbro sync found no "hejbro"."schema_manifest" table in this database -- no migration has ever emitted a manifest row. Next: in the repository that owns this schema, enable manifest emission (`hejbro generate --manifest`) and apply the resulting migration.',
		);
	}
	if (state.situation === "empty") {
		return throwHejbroError(
			"sync-manifest-empty",
			'hejbro sync found "hejbro"."schema_manifest", but it holds no row -- manifest emission was enabled, but no migration carrying one has been applied yet. Next: in the repository that owns this schema, apply a migration generated with `hejbro generate --manifest`.',
		);
	}
	if (state.situation === "stamp-unmatched") {
		return throwHejbroError(
			"sync-manifest-stamp-unmatched",
			"hejbro sync's own stamp doesn't match any row in this database's manifest -- this looks like a different database, or one whose manifest rows were removed. Next: confirm this is the right database, then rerun `hejbro sync` (without --check) if adopting its current state is what you want -- re-syncing here is a decision, not a repair.",
		);
	}
	if (state.situation === "format-unsupported") {
		const rowFormatText = formatUnsupportedRowFormatText(state.rowFormat);
		return throwHejbroError(
			"sync-manifest-format-unsupported",
			`hejbro sync's newest manifest row declares manifest format ${rowFormatText}, which this build (knows format ${READER_MANIFEST_FORMAT}) does not support. Next: upgrade hejbro to a version that supports this manifest format.`,
		);
	}
	if (state.situation === "payload-invalid") {
		return throwHejbroError(
			"sync-manifest-payload-invalid",
			`hejbro sync's newest manifest row declares a manifest format this build knows, but ${state.detail}. Next: in the repository that owns this schema, regenerate the migration that wrote this row, or check whether some other tool wrote it.`,
		);
	}
	// state.situation === "snapshot-format-refused"
	//
	// A distinct noun from "sync-manifest-format-unsupported" (#4) on
	// purpose (ps-planner review): the manifest's own format and the
	// snapshot it embeds are two different formats that move
	// independently, and a shared noun would read as two variants of the
	// same problem rather than two different ones. The message states
	// only the embedded version and this build's own, never core's raw
	// `unsupported-snapshot-version` text (that message tells a reader to
	// `hejbro init`/delete a snapshot *file on disk*, which this consumer
	// doesn't have) -- and names both repositories, since either one's
	// hejbro could be the one that needs to move.
	return throwHejbroError(
		"sync-snapshot-format-unsupported",
		`hejbro sync's newest manifest row embeds a snapshot format ${embeddedSnapshotFormatText(state.embeddedFormatVersion)}, which this build (knows format ${HEJBRO_SNAPSHOT_VERSION}) does not support. Next: match this consumer's hejbro to the one that generated the migration in the repository that owns this schema, or regenerate that migration with this build's hejbro.`,
	);
};

/**
 * `hejbro sync`'s own thin orchestration: resolve the destination,
 * connect, read every manifest row and classify the result
 * (`sync/manifest-state.ts`, atop `manifest-read.ts`'s shared reader),
 * rebuild the module source (`sync/emit.ts`) once a row is actually
 * found, then either write it (`sync/write.ts`) or, under `--check`,
 * only compare.
 */
export const runSync = async (
	cwd: string,
	rawArgs: ReadonlyArray<string> = [],
	importer?: SyncDriverImporter,
): Promise<SyncResult> => {
	const normalized = normalizeEqualsFlags(rawArgs);
	const urlFlag = lastFlagValue(normalized, "--url");
	const outFlag = lastFlagValue(normalized, "--out");
	const schemaFlag = lastFlagValue(normalized, "--schema");
	const force = rawArgs.includes("--force");
	const check = rawArgs.includes("--check");
	try {
		refuseSchemaFilter(schemaFlag);
		const { config } = await loadConfig(cwd, undefined);
		const destination = resolveDestination(outFlag, config.entry);
		const outcome = await withSyncConnection(
			urlFlag,
			process.env,
			async (driver): Promise<SyncOutcome> => {
				const state = await readManifestState(driver, null);
				const document = throwForManifestState(state);
				const source = buildSyncedModuleSource(document);
				if (check) {
					return compareToDestination(destination, source);
				}
				writeSyncedModule(destination, source, force);
				return { mode: "wrote" };
			},
			importer,
		);
		if (outcome.mode === "check-differs") {
			return {
				exitCode: 1,
				stdout: [
					`"${destination}" is not what \`hejbro sync\` would write right now -- rerun without --check to update it.`,
				],
				stderr: null,
			};
		}
		if (outcome.mode === "check-current") {
			return {
				exitCode: 0,
				stdout: [`"${destination}" is current.`],
				stderr: null,
			};
		}
		return {
			exitCode: 0,
			stdout: [`hejbro sync wrote "${destination}".`],
			stderr: null,
		};
	} catch (error) {
		const hejbroErr = asHejbroError(error);
		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics(
				[
					fromHejbroError(
						hejbroErr,
						identityFromMessage(hejbroErr.message, FALLBACK_IDENTITY),
					),
				],
				null,
			),
		};
	}
};

/** The `hejbro sync` citty subcommand -- see {@link runSync}. */
export const syncCommand = defineCommand({
	meta: {
		name: "sync",
		description: SYNC_DESCRIPTION,
	},
	args: SYNC_ARGS,
	run: async (ctx) => {
		const result = await runSync(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});

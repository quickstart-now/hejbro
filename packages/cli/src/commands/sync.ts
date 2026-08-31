import { existsSync, readFileSync } from "node:fs";
import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";
import { identityFromMessage } from "../identity";
import { loadConfig } from "../loader";
import { readNewestManifestRow } from "../manifest-read";
import type { SyncDriverImporter } from "../sync/connection";
import { withSyncConnection } from "../sync/connection";
import type { ManifestDocument } from "../sync/emit";
import { buildSyncedModuleSource } from "../sync/emit";
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
			"compare without writing; exits non-zero when the destination is stale",
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
	| { readonly mode: "check-stale" };

/**
 * `--check`'s own comparison (schema-sync delta, "The command can check
 * without writing"): the module `sync` would write is built exactly as a
 * real run would, then compared byte-for-byte against what is already at
 * `destination` -- never hashed, and never derived from the destination
 * file's own exported stamp (which would need loading it as code; a
 * synced module is proven byte-identical for the same manifest row
 * (5.5), so a plain text comparison already answers the same question a
 * stamp comparison would, without executing anything at `destination`).
 * Absent entirely counts as stale: there is nothing yet to be current
 * with.
 */
const compareToDestination = (
	destination: string,
	source: string,
): SyncOutcome => {
	if (existsSync(destination) && readFileSync(destination, "utf8") === source) {
		return { mode: "check-current" };
	}
	return { mode: "check-stale" };
};

/**
 * `hejbro sync`'s own thin orchestration: resolve the destination,
 * connect, read the newest manifest row (`manifest-read.ts`, the one
 * reader groups 5 and 6 share), rebuild the module source
 * (`sync/emit.ts`), then either write it (`sync/write.ts`) or, under
 * `--check`, only compare. What a manifest row's absence, an unmatched
 * stamp, or a format the reader doesn't know each mean is not yet
 * classified here -- that is group 5's own `[design]` task (5.6/5.7),
 * not this one's; today those surface as an uncaught failure rather
 * than a hejbro-coded diagnostic. Likewise, `row.manifest` is parsed
 * with no shape validation of its own (5.6's own debt: a matching
 * manifest_format with a corrupted payload is not yet its own coded
 * refusal).
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
				const row = await readNewestManifestRow(driver);
				if (row === null) {
					throw new Error(
						"hejbro sync found no manifest row in this database -- no migration has emitted one yet.",
					);
				}
				const payload = JSON.parse(row.manifest) as Omit<
					ManifestDocument,
					"snapshotHash"
				>;
				const document: ManifestDocument = {
					...payload,
					snapshotHash: row.snapshotHash,
				};
				const source = buildSyncedModuleSource(document);
				if (check) {
					return compareToDestination(destination, source);
				}
				writeSyncedModule(destination, source, force);
				return { mode: "wrote" };
			},
			importer,
		);
		if (outcome.mode === "check-stale") {
			return {
				exitCode: 1,
				stdout: [
					`"${destination}" is stale -- rerun \`hejbro sync\` without --check to update it.`,
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

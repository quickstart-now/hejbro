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

/**
 * `hejbro sync`'s own thin orchestration: resolve the destination,
 * connect, read the newest manifest row (`manifest-read.ts`, the one
 * reader groups 5 and 6 share), rebuild the module source
 * (`sync/emit.ts`) and write it (`sync/write.ts`). What a manifest row's
 * absence, an unmatched stamp, or a format the reader doesn't know each
 * mean is not yet classified here -- that is group 5's own `[design]`
 * task (5.6/5.7), not this one's; today those surface as an uncaught
 * failure rather than a hejbro-coded diagnostic.
 */
export const runSync = async (
	cwd: string,
	rawArgs: ReadonlyArray<string> = [],
	importer?: SyncDriverImporter,
): Promise<SyncResult> => {
	const normalized = normalizeEqualsFlags(rawArgs);
	const urlFlag = lastFlagValue(normalized, "--url");
	const outFlag = lastFlagValue(normalized, "--out");
	const force = rawArgs.includes("--force");
	try {
		const { config } = await loadConfig(cwd, undefined);
		const destination = resolveDestination(outFlag, config.entry);
		await withSyncConnection(
			urlFlag,
			process.env,
			async (driver) => {
				const row = await readNewestManifestRow(driver);
				if (row === null) {
					throw new Error(
						"hejbro sync found no manifest row in this database -- no migration has emitted one yet.",
					);
				}
				const document = JSON.parse(row.manifest) as ManifestDocument;
				const source = buildSyncedModuleSource(document);
				writeSyncedModule(destination, source, force);
			},
			importer,
		);
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

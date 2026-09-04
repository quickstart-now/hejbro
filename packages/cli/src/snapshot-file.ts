import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { throwHejbroError } from "@hejbro/core";
import type { HejbroConfig } from "./config";
import type { ConfigCommand } from "./config-required";
import { requireConfigFields } from "./config-required";
import { stripTrailingSeparators } from "./path-probe";

type SnapshotFsOutcome = "present" | "directory" | "absent";

/** `statSync`'s three outcomes at `path` -- a directory kept separate from
 * "present" (#766 second ask): `existsSync` alone is `true` for a
 * directory too, and the `readFileSync` that used to follow it died with
 * a raw `EISDIR`. Any stat failure other than `ENOENT` rethrows raw, same
 * as today (#767's class -- not coded here). */
const snapshotFsOutcome = (path: string): SnapshotFsOutcome => {
	try {
		const stat = statSync(path);
		if (stat.isDirectory()) {
			return "directory";
		}
		return "present";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return "absent";
		}
		throw error;
	}
};

/** Every `.sql` filename in `migrationsDirPath`, sorted — `[]` if the directory doesn't exist. */
export const listMigrationFiles = (
	migrationsDirPath: string,
): ReadonlyArray<string> => {
	if (!existsSync(migrationsDirPath)) {
		return [];
	}
	return readdirSync(migrationsDirPath)
		.filter((name) => name.endsWith(".sql"))
		.sort();
};

/**
 * Reads the checked-in snapshot's raw text, or throws `snapshot-not-found`
 * (never initialized) / `snapshot-lost` (migrations exist but the
 * checked-in snapshot is missing — recover from git, never regenerate)
 * depending on whether the migrations directory already has `.sql` files
 * (owner-approved texts, decision ⑥). Paths in the message stay exactly as
 * given in `hejbro.config.ts` (not resolved to absolute paths). Shared by
 * `generate` (Task 13), `verify` (Task 17, reviewer M2) and `check` (group
 * 3) so all three commands report the identical branch and text for a
 * missing snapshot — duplicating this logic risks them drifting apart.
 * `config.snapshotPath` is required by every caller (the type parameter
 * says so); `config.migrationsDir` is needed only on the path where no
 * snapshot file exists yet, which is exactly the field `check` alone
 * doesn't otherwise require (cli-commands delta) — so that one field is
 * guarded here, at the point it's actually read, rather than upfront for
 * every caller.
 */
export const readSnapshotFileText = (
	cwd: string,
	config: HejbroConfig & { readonly snapshotPath: string },
	command: ConfigCommand,
): string => {
	const snapshotFsPath = join(cwd, config.snapshotPath);
	const outcome = snapshotFsOutcome(stripTrailingSeparators(snapshotFsPath));
	if (outcome === "directory") {
		return throwHejbroError(
			"snapshot-not-a-file",
			`"${config.snapshotPath}" is named by snapshotPath, but a directory is there — the snapshot is a file hejbro writes. Next: move or remove that directory, then rerun \`hejbro init\` to scaffold an empty snapshot (or restore the file from version control if migrations already exist).`,
		);
	}
	if (outcome === "present") {
		return readFileSync(snapshotFsPath, "utf8");
	}
	requireConfigFields(config, command, ["migrationsDir"]);
	const migrationsDirPath = join(cwd, config.migrationsDir);
	const priorMigrationCount = listMigrationFiles(migrationsDirPath).length;
	if (priorMigrationCount === 0) {
		return throwHejbroError(
			"snapshot-not-found",
			`no snapshot file was found at "${config.snapshotPath}", and the migrations directory has no prior migrations either — this looks like a project that hasn't been initialized yet. Next: run \`hejbro init\` to scaffold an empty snapshot (and the migrations directory, if missing), then rerun \`hejbro generate\`.`,
		);
	}
	return throwHejbroError(
		"snapshot-lost",
		`no snapshot file was found at "${config.snapshotPath}", but ${priorMigrationCount} prior migration(s) already exist in "${config.migrationsDir}" — the snapshot is a derived, checked-in file (declarations are the source of truth), so this looks lost rather than never created. Next: recover it from version control (git log -- ${config.snapshotPath}; git restore ${config.snapshotPath}); do not just rerun \`hejbro generate\` to "fix" this — with no previous snapshot, hejbro treats every declared object as brand new and emits a migration that recreates everything, which is destructive against a database that's already been migrated.`,
	);
};

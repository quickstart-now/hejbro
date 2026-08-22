import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { throwHejbroError } from "@hejbro/core";
import type { HejbroConfig } from "./config";

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
 * `generate` (Task 13) and `verify` (Task 17, reviewer M2) so both
 * commands report the identical branch and text for a missing snapshot —
 * duplicating this logic risks the two commands drifting apart.
 */
export const readSnapshotFileText = (
	cwd: string,
	config: HejbroConfig,
): string => {
	const snapshotFsPath = join(cwd, config.snapshotPath);
	if (existsSync(snapshotFsPath)) {
		return readFileSync(snapshotFsPath, "utf8");
	}
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

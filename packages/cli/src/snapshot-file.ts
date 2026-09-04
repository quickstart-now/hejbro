import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { throwHejbroError } from "@hejbro/core";
import type { HejbroConfig } from "./config";
import type { ConfigCommand } from "./config-required";
import { requireConfigFields } from "./config-required";
import { errorCode, probePath, stripTrailingSeparators } from "./path-probe";

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
	const strippedFsPath = stripTrailingSeparators(snapshotFsPath);
	const outcome = probePath(cwd, strippedFsPath);
	if (outcome.kind === "present" && outcome.actualKind === "directory") {
		return throwHejbroError(
			"snapshot-not-a-file",
			`"${config.snapshotPath}" is named by snapshotPath, but a directory is there — the snapshot is a file hejbro writes. Next: move or remove that directory, then rerun \`hejbro init\` to scaffold an empty snapshot (or restore the file from version control if migrations already exist).`,
		);
	}
	if (outcome.kind === "dangling") {
		return throwHejbroError(
			"snapshot-not-a-file",
			`"${config.snapshotPath}" is named by snapshotPath, but a dangling symbolic link is there, pointing at "${outcome.target}" — the snapshot is a file hejbro writes. Next: remove the link or create its target, then rerun.`,
		);
	}
	if (outcome.kind === "ancestor-file") {
		const culprit = relative(cwd, outcome.path);
		return throwHejbroError(
			"snapshot-unreadable",
			`"${config.snapshotPath}" is named by snapshotPath, but "${culprit}" is a file and cannot hold it. Next: move or remove the file at "${culprit}", then rerun.`,
		);
	}
	if (outcome.kind === "ancestor-dangling") {
		const culprit = relative(cwd, outcome.path);
		return throwHejbroError(
			"snapshot-unreadable",
			`"${config.snapshotPath}" is named by snapshotPath, but "${culprit}" is a dangling symbolic link, pointing at "${outcome.target}". Next: remove the link or create its target, then rerun.`,
		);
	}
	if (outcome.kind === "blocked") {
		const culprit = relative(cwd, outcome.culprit);
		return throwHejbroError(
			"snapshot-unreadable",
			`"${config.snapshotPath}" is named by snapshotPath, but it could not be checked (${outcome.code}): "${culprit}" does not let this process look inside it. Next: check permissions on "${culprit}", then rerun.`,
		);
	}
	if (outcome.kind === "stat-failed") {
		const failedPath = relative(cwd, outcome.path);
		return throwHejbroError(
			"snapshot-unreadable",
			`"${config.snapshotPath}" is named by snapshotPath, but it could not be checked (${outcome.code}). Next: check what "${failedPath}" points at, then rerun.`,
		);
	}
	if (outcome.kind === "present") {
		try {
			return readFileSync(strippedFsPath, "utf8");
		} catch (error) {
			const code = errorCode(error);
			return throwHejbroError(
				"snapshot-unreadable",
				`"${config.snapshotPath}" is named by snapshotPath, but this process cannot read it (${code}). Next: check permissions on "${config.snapshotPath}", then rerun.`,
			);
		}
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

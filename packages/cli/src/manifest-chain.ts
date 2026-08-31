import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBannerManifestFormat, throwHejbroError } from "@hejbro/core";

const carriesManifest = (fileContent: string): boolean =>
	parseBannerManifestFormat(fileContent) !== null;

/**
 * `generate`'s own forward gate (schema-manifest delta, "A chain that
 * carries manifests keeps carrying them"): reads the chain's LAST
 * migration only. A violation earlier in the chain is `verify`'s own
 * full-chain audit to catch (this file's other export) — reading every
 * migration here, on every `generate` run, would duplicate that cost
 * for no new information, since this gate only needs to know whether
 * emission must continue from where the chain currently stands.
 */
export const assertManifestMonotonic = (
	migrationsDirPath: string,
	fileNames: ReadonlyArray<string>,
	manifestEnabled: boolean,
): void => {
	if (manifestEnabled) {
		return;
	}
	const lastFileName = fileNames.at(-1);
	if (lastFileName === undefined) {
		return;
	}
	const content = readFileSync(join(migrationsDirPath, lastFileName), "utf8");
	if (!carriesManifest(content)) {
		return;
	}
	throwHejbroError(
		"manifest-emission-required",
		`"${lastFileName}" already carries a schema manifest, and once a migration chain starts carrying manifests every later migration must keep carrying one — generating without one now would leave the database's newest manifest row describing an older schema while every freshness check downstream reports agreement. Next: pass --manifest to keep emitting manifest statements for this chain.`,
	);
};

/**
 * `verify`'s own audit, over the same migration files its chain checks
 * already read: once any migration starts carrying a manifest, every
 * migration after it must too. Returns the file name of the first one
 * that doesn't, or `null` if the chain never started carrying manifests
 * or has kept carrying them ever since — no database involved, so a
 * hand-edited chain is caught the same way whether or not one is
 * reachable.
 */
export const firstMigrationThatStoppedCarryingManifest = (
	migrationsDirPath: string,
	fileNames: ReadonlyArray<string>,
): string | null => {
	const contents = fileNames.map((fileName) =>
		readFileSync(join(migrationsDirPath, fileName), "utf8"),
	);
	const startedAt = contents.findIndex(carriesManifest);
	if (startedAt === -1) {
		return null;
	}
	const relativeViolationIndex = contents
		.slice(startedAt)
		.findIndex((content) => !carriesManifest(content));
	if (relativeViolationIndex === -1) {
		return null;
	}
	return fileNames[startedAt + relativeViolationIndex] ?? null;
};

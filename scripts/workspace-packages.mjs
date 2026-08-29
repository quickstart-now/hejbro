// #484: gate scripts derive their package lists from the workspace
// instead of hand-maintaining them -- a new published package is covered
// the moment its directory exists, and only *exclusions* are
// hand-written, each carrying its reason. (Motivating observation, from
// the neon-preset review: with the crap list's registration line
// reverted, a planted CRAP-30 defect in the new package scanned clean --
// a demonstrated counterfactual, not a suffered incident; neon's own
// landing commit updated all three lists.)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every non-private package under packages/, name + repo-relative dir, sorted by name. */
export const publishedPackages = () =>
	readdirSync(join(REPO_ROOT, "packages"))
		.map((entry) => ({
			dir: `packages/${entry}`,
			manifestPath: join(REPO_ROOT, "packages", entry, "package.json"),
		}))
		.filter(({ manifestPath }) => existsSync(manifestPath))
		.map(({ dir, manifestPath }) => ({
			dir,
			manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
		}))
		.filter(({ manifest }) => manifest.private !== true)
		.map(({ dir, manifest }) => ({ name: manifest.name, dir }))
		.sort((a, b) => a.name.localeCompare(b.name));

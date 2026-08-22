import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJsonShape = {
	readonly version?: unknown;
};

const FALLBACK_VERSION = "0.0.0";

/**
 * Reads this package's own `version` field from its own `package.json`,
 * located relative to *this module's own file* rather than `cwd` (a
 * `hejbro` command always runs from the user's project directory, never
 * this package's own). The relative shape is identical whether this
 * module is `src/version.ts` (vitest, one directory below
 * `packages/cli/`) or the built, bundled `dist/cli.js` (one directory
 * below `packages/cli/` too, and again one directory below whatever
 * directory `hejbro` is installed into as a dependency) — one level up
 * from this module's own directory always lands on `package.json`.
 * Falls back to `"0.0.0"` (this package's own pre-publication version)
 * on any read/parse failure, or a `version` field that isn't a string,
 * rather than crashing the whole CLI over a version string.
 */
const readOwnVersion = (): string => {
	try {
		const moduleDir = dirname(fileURLToPath(import.meta.url));
		const packageJsonPath = join(moduleDir, "..", "package.json");
		const raw = readFileSync(packageJsonPath, "utf8");
		const parsed = JSON.parse(raw) as PackageJsonShape;
		if (typeof parsed.version !== "string") {
			return FALLBACK_VERSION;
		}
		return parsed.version;
	} catch {
		return FALLBACK_VERSION;
	}
};

/**
 * The running `hejbro` build's own version — read once, at import time,
 * from this package's own `package.json` (not hardcoded). Feeds
 * `main.ts`'s `--version` output and the migration banner's
 * `-- hejbro: <version>` line (#229); `hejbro restore`'s own
 * `restore-state-mismatch` message (#130) reads this same constant for
 * its "this build is X" branch.
 */
export const CLI_VERSION = readOwnVersion();

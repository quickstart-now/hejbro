import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CORE_PACKAGE_ROOT = join(import.meta.dirname, "..", "..");
const CORE_DIST_ENTRY = join(CORE_PACKAGE_ROOT, "dist", "index.js");

/**
 * Copies this package's own built `dist/index.js` to a fresh temp file and
 * dynamically imports it, producing a second, physically distinct module
 * instance of `@hejbro/core` — every `Symbol("...")`-based identity
 * (`tableMeta`, `triggerRowMeta`) it creates is a genuinely different
 * `Symbol()` value than this package's own, even though the descriptions
 * match. This is what actually reproduces "two copies of core installed"
 * (e.g. a version-conflict-driven nested `node_modules`) — confirmed the
 * naive alternative (two symlinks pointing at the *same* physical file)
 * does **not** reproduce it, since Node's module cache dedupes by resolved
 * real path, not by import specifier or symlink path.
 *
 * Requires `dist/index.js` to already be built —
 * `packages/core/turbo.json` declares `test: { dependsOn: ["build"] }` so
 * this holds under `turbo run test`; running `vitest` directly without a
 * prior `pnpm build` fails here with a plain `ENOENT` on the copy, not a
 * confusing symbol-identity failure.
 */
export const withDuplicateCoreInstance = async <T>(
	run: (duplicateCore: typeof import("../../src/index")) => Promise<T> | T,
): Promise<T> => {
	const scratchDir = mkdtempSync(join(tmpdir(), "hejbro-core-dup-"));
	try {
		const duplicateEntry = join(scratchDir, "index.js");
		cpSync(CORE_DIST_ENTRY, duplicateEntry);
		const duplicateCore = await import(pathToFileURL(duplicateEntry).href);
		return await run(duplicateCore);
	} finally {
		rmSync(scratchDir, { recursive: true, force: true });
	}
};

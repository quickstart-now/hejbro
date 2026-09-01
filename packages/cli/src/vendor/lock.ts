import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableJson, throwHejbroError } from "@hejbro/core";
import { assertVendorDestinationWritable, isVendorLockText } from "./write";

/** The consumer-side vendor directory for the two raw, byte-identical
 * copies — symmetric to the schema repository's own `.hejbro/export/`
 * (`export/write.ts`). The lock itself is NOT here (see {@link
 * LOCK_FILE_NAME}): it belongs at the repository root, the same place
 * `package-lock.json`/`go.sum` sit, so a reviewer sees a schema move in
 * a pull request's own file list rather than inside a hidden directory
 * (owner decision). */
export const VENDOR_DIR_NAME = ".hejbro/vendor";
export const VENDOR_SCHEMA_FILE = "schema.json";
export const VENDOR_SQL_FILE = "snapshot.sql";

/** Truth, at the repository root — resolved from `hejbro.config.ts`'s
 * `schemaSource` (intent) every time `vendor` runs. Intent and truth are
 * two different files on purpose (owner decision): deleting the lock
 * must not lose where the schema came from. */
export const LOCK_FILE_NAME = "hejbro.lock";

export const vendorDirPath = (cwd: string): string =>
	join(cwd, VENDOR_DIR_NAME);
export const vendorSchemaPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_SCHEMA_FILE);
export const vendorSqlPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_SQL_FILE);
export const lockPath = (cwd: string): string => join(cwd, LOCK_FILE_NAME);

/**
 * `vendor`'s own resolution record — never the source (that is
 * `hejbro.config.ts`'s `schemaSource`, committed intent; this is
 * resolved truth). Rewritten every `vendor` run with the commit, the
 * ref it was resolved from, the description's format version, and both
 * vendored files' content hashes — the hashes are what let `vendor
 * --check` compare against the lock with no network at all (schema-
 * vendoring spec, "Checking needs no network").
 */
export type VendorLock = {
	readonly generatedBy: "hejbro vendor";
	readonly commit: string;
	readonly resolvedFrom: string;
	readonly descriptionFormat: number;
	readonly schemaHash: string;
	readonly sqlHash: string;
};

/** `vendor`'s own guard: refuses to write over `hejbro.lock` when it
 * already exists and isn't one this tool wrote, unless `force`. */
export const assertLockWritable = (cwd: string, force: boolean): void =>
	assertVendorDestinationWritable(lockPath(cwd), force);

/**
 * `null` when nothing has been vendored yet. Refuses (never silently
 * trusts) a `hejbro.lock` that exists but doesn't carry this tool's own
 * mark — the same guard {@link assertLockWritable} applies before a
 * write, applied here before a read ever treats foreign content as a
 * real lock. Reclaim the file with `hejbro vendor --force` first if
 * that's genuinely what's wanted; there is no force-to-read here, only
 * force-to-overwrite.
 */
export const readLock = (cwd: string): VendorLock | null => {
	const path = lockPath(cwd);
	if (!existsSync(path)) {
		return null;
	}
	const text = readFileSync(path, "utf8");
	if (!isVendorLockText(text)) {
		return throwHejbroError(
			"vendor-destination-not-vendored",
			`"${path}" already exists and doesn't look like a file \`hejbro vendor\` wrote. Next: remove it, or pass --force to \`hejbro vendor\` if overwriting it is what you want.`,
		);
	}
	return JSON.parse(text) as VendorLock;
};

export const writeLock = (
	cwd: string,
	lock: Omit<VendorLock, "generatedBy">,
): void => {
	const full: VendorLock = { generatedBy: "hejbro vendor", ...lock };
	writeFileSync(lockPath(cwd), stableJson(full));
};

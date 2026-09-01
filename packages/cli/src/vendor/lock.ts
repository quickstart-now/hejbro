import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableJson, throwHejbroError } from "@hejbro/core";
import { assertVendorDestinationWritable, isVendorLockText } from "./write";

/** The consumer-side vendor directory — symmetric to the schema
 * repository's own `.hejbro/export/` (`export/write.ts`). */
export const VENDOR_DIR_NAME = ".hejbro/vendor";
export const VENDOR_SCHEMA_FILE = "schema.json";
export const VENDOR_SQL_FILE = "snapshot.sql";
export const VENDOR_LOCK_FILE = "lock.json";

export const vendorDirPath = (cwd: string): string =>
	join(cwd, VENDOR_DIR_NAME);
export const vendorSchemaPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_SCHEMA_FILE);
export const vendorSqlPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_SQL_FILE);
export const vendorLockPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_LOCK_FILE);

/**
 * `link`'s own record: the source repository, and nothing else (schema-
 * vendoring spec, "Linking records the repository alone"). `vendor`
 * rewrites this same file with `ref`/`commit`/`descriptionFormat` and
 * both content hashes added, every run — the hashes are what let
 * `vendor --check` compare the vendored files against the lock with no
 * network at all (schema-vendoring spec, "Checking needs no network").
 */
export type VendorLock = {
	readonly generatedBy: "hejbro vendor";
	readonly source: string;
	readonly ref?: string;
	readonly commit?: string;
	readonly descriptionFormat?: number;
	readonly schemaHash?: string;
	readonly sqlHash?: string;
};

/** `link`'s own guard: refuses to claim the vendor directory when it
 * already holds a `lock.json` this tool did not write, unless `force`. */
export const assertVendorLockWritable = (cwd: string, force: boolean): void =>
	assertVendorDestinationWritable(vendorLockPath(cwd), force);

/**
 * `null` when nothing is linked yet. Refuses (never silently trusts) a
 * `lock.json` that exists but doesn't carry this tool's own mark — the
 * same guard `assertVendorLockWritable` applies before a write, applied
 * here before a read ever treats foreign content as a real source to
 * vendor from. Reclaim the directory with `hejbro link --force` first if
 * that's genuinely what's wanted; there is no force-to-read here, only
 * force-to-overwrite.
 */
export const readVendorLock = (cwd: string): VendorLock | null => {
	const path = vendorLockPath(cwd);
	if (!existsSync(path)) {
		return null;
	}
	const text = readFileSync(path, "utf8");
	if (!isVendorLockText(text)) {
		return throwHejbroError(
			"vendor-destination-not-vendored",
			`"${path}" already exists and doesn't look like a file \`hejbro vendor\` wrote. Next: remove it, or run \`hejbro link --force <repository>\` if overwriting it is what you want.`,
		);
	}
	return JSON.parse(text) as VendorLock;
};

export const writeVendorLock = (
	cwd: string,
	lock: Omit<VendorLock, "generatedBy">,
): void => {
	mkdirSync(vendorDirPath(cwd), { recursive: true });
	const full: VendorLock = { generatedBy: "hejbro vendor", ...lock };
	writeFileSync(vendorLockPath(cwd), stableJson(full));
};
